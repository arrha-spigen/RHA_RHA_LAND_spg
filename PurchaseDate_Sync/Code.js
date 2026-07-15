/********************************
 * PurchaseDate_Sync — Zendesk → monday.com "Purchase Date" bridge
 *
 * WHY THIS EXISTS
 * The native monday↔Zendesk integration on board 18421346787 (Galaxy Z8
 * Case+CP) cannot map Zendesk CUSTOM fields to board columns — its date
 * dropdown only offers the system fields (Created at / Due at / Updated at).
 * "Purchase Date" (Zendesk custom field 360019586172) therefore never
 * reaches the board's Purchase Date column.
 *
 * HOW IT WORKS
 * A Zendesk Trigger (condition: Purchase Date changed) calls this Web App
 * via a webhook with {"ticket_id": N}. The script:
 *   1. Fetches the ticket from Zendesk and reads the raw Purchase Date
 *      custom field value (already YYYY-MM-DD — no locale parsing needed).
 *   2. Finds the board item whose "Zendesk Ticket" integration column holds
 *      that ticket id (the native recipe stores {"entity_id": <ticket_id>}).
 *      Retries a few times because the recipe may not have created the
 *      item yet when the trigger fires on ticket creation.
 *   3. Writes the date to the "Purchase Date" date column via monday API.
 *
 * backfillPurchaseDates() can be run manually from the GAS editor to fill
 * the date for all existing items that have a linked ticket but no date.
 ********************************/

const ZENDESK_EMAIL = 'kjw@spigen.com';
const ZENDESK_TOKEN = 'QhM2AiBYwTZTSb04Qjor918PHtttxp8xAzCFfFsg';
const ZENDESK_SUBDOMAIN = 'spigenhelp';
const ZD_PURCHASE_DATE_FIELD = 360019586172; // custom ticket field "Purchase Date" (type: date)

const MONDAY_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU0ODE3MjIzOSwiYWFpIjoxMSwidWlkIjozMTE0NDEyMSwiaWFkIjoiMjAyNS0wOC0wOFQwNToyMTozNS40ODdaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTExNjU5NTcsInJnbiI6InVzZTEifQ._Z9iAbMMY9bvJnCG3jFwdUIHMaw8aihN2pcRNnkFUVM';
const MONDAY_BOARD_ID = 18421346787;
const MONDAY_DATE_COL = 'date_mm59ejfp';          // "Purchase Date" (date)
const MONDAY_TICKET_COL = 'integration_mm0fzmv0'; // "Zendesk Ticket" (integration)

// Shared secret the Zendesk webhook must send back as the `?secret=` query param.
const WEBHOOK_SECRET = '8GD3uY_vYU5N9GJlD0T1y1b9jJylrPnv21QmeqBSsKU';

// The native recipe creates the board item asynchronously — if the trigger
// fires before the item exists, wait and look again.
const FIND_RETRIES = 4;
const FIND_RETRY_SLEEP_MS = 20000;

// ── Zendesk helpers ───────────────────────────────────────────────────────────

function zdAuthHeader_() {
  return 'Basic ' + Utilities.base64Encode(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`);
}

function zdGetTicket_(ticketId) {
  const resp = UrlFetchApp.fetch(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}.json`,
    { headers: { Authorization: zdAuthHeader_() }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) {
    throw new Error(`Zendesk GET ticket ${ticketId} -> ${resp.getResponseCode()}: ${resp.getContentText()}`);
  }
  return JSON.parse(resp.getContentText()).ticket;
}

function zdPurchaseDate_(ticket) {
  const f = (ticket.custom_fields || []).find(cf => cf.id === ZD_PURCHASE_DATE_FIELD);
  return f && f.value ? String(f.value) : null; // raw value is YYYY-MM-DD
}

// ── monday helpers ────────────────────────────────────────────────────────────

function mondayGql_(query) {
  const resp = UrlFetchApp.fetch('https://api.monday.com/v2', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: MONDAY_TOKEN },
    payload: JSON.stringify({ query }),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200 || body.errors) {
    throw new Error('monday API: ' + resp.getContentText());
  }
  return body.data;
}

// Walks the whole board and returns { itemId, dateText } for the item whose
// "Zendesk Ticket" integration column holds the given ticket id, else null.
function findItemByTicketId_(ticketId) {
  let cursor = null;
  do {
    const cursorArg = cursor ? `cursor: "${cursor}"` : 'limit: 100';
    const data = mondayGql_(`query {
      boards(ids: [${MONDAY_BOARD_ID}]) {
        items_page(${cursorArg}) {
          cursor
          items {
            id
            column_values(ids: ["${MONDAY_TICKET_COL}", "${MONDAY_DATE_COL}"]) { id value text }
          }
        }
      }
    }`);
    const page = data.boards[0].items_page;
    for (const item of page.items) {
      const tickCol = item.column_values.find(c => c.id === MONDAY_TICKET_COL);
      if (!tickCol || !tickCol.value) continue;
      let entityId;
      try { entityId = JSON.parse(tickCol.value).entity_id; } catch (e) { continue; }
      if (Number(entityId) === Number(ticketId)) {
        const dateCol = item.column_values.find(c => c.id === MONDAY_DATE_COL);
        return { itemId: item.id, dateText: dateCol ? dateCol.text : '' };
      }
    }
    cursor = page.cursor;
  } while (cursor);
  return null;
}

function setItemPurchaseDate_(itemId, isoDate) {
  const colVals = JSON.stringify({ [MONDAY_DATE_COL]: { date: isoDate } })
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  mondayGql_(`mutation {
    change_multiple_column_values(board_id: ${MONDAY_BOARD_ID}, item_id: ${itemId}, column_values: "${colVals}") { id }
  }`);
}

// ── Core sync ─────────────────────────────────────────────────────────────────

function syncTicketPurchaseDate_(ticketId, allowRetry) {
  const ticket = zdGetTicket_(ticketId);
  const isoDate = zdPurchaseDate_(ticket);
  if (!isoDate) return { ticketId, skipped: 'Purchase Date is empty on the ticket' };

  let found = null;
  const attempts = allowRetry ? FIND_RETRIES : 1;
  for (let i = 0; i < attempts && !found; i++) {
    if (i > 0) Utilities.sleep(FIND_RETRY_SLEEP_MS);
    found = findItemByTicketId_(ticketId);
  }
  if (!found) return { ticketId, skipped: 'no board item linked to this ticket (yet)' };

  setItemPurchaseDate_(found.itemId, isoDate);
  Logger.log(`Ticket #${ticketId} → item ${found.itemId}: Purchase Date = ${isoDate}`);
  return { ticketId, itemId: found.itemId, date: isoDate, ok: true };
}

// ── Web App entry point (Zendesk webhook) ─────────────────────────────────────

function doPost(e) {
  const out = obj =>
    ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  try {
    if (!e || !e.parameter || e.parameter.secret !== WEBHOOK_SECRET) {
      return out({ error: 'bad secret' });
    }
    const ticketId = Number(JSON.parse(e.postData.contents).ticket_id);
    if (!ticketId) return out({ error: 'no ticket_id in payload' });
    return out(syncTicketPurchaseDate_(ticketId, true));
  } catch (err) {
    Logger.log(err);
    return out({ error: String(err) });
  }
}

// ── Manual backfill (run from the GAS editor) ─────────────────────────────────

// Fills Purchase Date for every board item that has a linked Zendesk ticket
// but an empty date column. Safe to re-run; already-dated items are skipped.
function backfillPurchaseDates() {
  let cursor = null;
  let updated = 0, skipped = 0;
  do {
    const cursorArg = cursor ? `cursor: "${cursor}"` : 'limit: 100';
    const data = mondayGql_(`query {
      boards(ids: [${MONDAY_BOARD_ID}]) {
        items_page(${cursorArg}) {
          cursor
          items {
            id
            column_values(ids: ["${MONDAY_TICKET_COL}", "${MONDAY_DATE_COL}"]) { id value text }
          }
        }
      }
    }`);
    const page = data.boards[0].items_page;
    for (const item of page.items) {
      const dateCol = item.column_values.find(c => c.id === MONDAY_DATE_COL);
      if (dateCol && dateCol.text) { skipped++; continue; } // already has a date
      const tickCol = item.column_values.find(c => c.id === MONDAY_TICKET_COL);
      if (!tickCol || !tickCol.value) { skipped++; continue; }
      let entityId;
      try { entityId = JSON.parse(tickCol.value).entity_id; } catch (e) { skipped++; continue; }
      try {
        const isoDate = zdPurchaseDate_(zdGetTicket_(entityId));
        if (!isoDate) { skipped++; continue; }
        setItemPurchaseDate_(item.id, isoDate);
        updated++;
        Logger.log(`backfill: ticket #${entityId} → item ${item.id}: ${isoDate}`);
      } catch (err) {
        Logger.log(`backfill: item ${item.id} (ticket #${entityId}) failed: ${err}`);
      }
    }
    cursor = page.cursor;
  } while (cursor);
  Logger.log(`backfill done — updated ${updated}, skipped ${skipped}`);
}

// ── Smoke test (run from the GAS editor) ──────────────────────────────────────

function testSyncOneTicket() {
  const TICKET_ID = 1000153779; // Jane's test ticket (item "1010101010")
  Logger.log(JSON.stringify(syncTicketPurchaseDate_(TICKET_ID, false)));
}

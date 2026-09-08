/********************************
 * SETTINGS
 ********************************/
const ZENDESK_EMAIL = 'kjw@spigen.com';
const ZENDESK_TOKEN = 'QhM2AiBYwTZTSb04Qjor918PHtttxp8xAzCFfFsg';
const ZENDESK_SUBDOMAIN = 'spigenhelp';
const SPREADSHEET_ID = '10VYnysCGztKWMXfvXIWBVcE2_zENnRxvXUr9nicHkpo';

/********************************
 * COMMON HELPERS
 ********************************/
// How many times each Zendesk API call is retried on a transient failure
// ("Address unavailable" / DNS blips, HTTP 429, HTTP 5xx, bad JSON).
const ZENDESK_FETCH_ATTEMPTS   = 3;
const ZENDESK_FETCH_BACKOFF_MS = [0, 2000, 4000];

// GET a Zendesk API path (relative, e.g. "/api/v2/views/123/tickets.json") and
// return the parsed JSON. Retries transient failures ("Address unavailable" /
// DNS blips, HTTP 429, HTTP 5xx, unparseable JSON); non-transient 4xx fail fast.
function zendeskApiGet_(path) {
  const headers = {
    "Authorization": "Basic " + Utilities.base64Encode(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`)
  };
  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com${path}`;

  let lastErr = null;
  for (let attempt = 1; attempt <= ZENDESK_FETCH_ATTEMPTS; attempt++) {
    const wait = ZENDESK_FETCH_BACKOFF_MS[Math.min(attempt - 1, ZENDESK_FETCH_BACKOFF_MS.length - 1)];
    if (wait) Utilities.sleep(wait);
    try {
      const response = UrlFetchApp.fetch(url, { method: 'get', headers, muteHttpExceptions: true });
      const code = response.getResponseCode();

      if (code === 429 || code >= 500) {          // transient -> retry
        lastErr = new Error(`Zendesk GET ${path} HTTP ${code}`);
        Logger.log(`WARN ${lastErr.message} (attempt ${attempt}/${ZENDESK_FETCH_ATTEMPTS})`);
        continue;
      }
      if (code < 200 || code >= 300) {            // 4xx (auth/not-found) -> not transient, fail fast
        throw new Error(`Zendesk GET ${path} HTTP ${code}: ${response.getContentText().slice(0, 200)}`);
      }

      return JSON.parse(response.getContentText());   // bad JSON -> caught below, retried
    } catch (e) {
      lastErr = e;
      Logger.log(`WARN Zendesk GET ${path} failed (attempt ${attempt}/${ZENDESK_FETCH_ATTEMPTS}): ${(e && e.message) || e}`);
    }
  }
  throw new Error(`Zendesk GET ${path} failed after ${ZENDESK_FETCH_ATTEMPTS} attempts: ${(lastErr && lastErr.message) || lastErr}`);
}

function getZendeskTicketsByView(viewId) {
  return zendeskApiGet_(`/api/v2/views/${viewId}/tickets.json`).tickets || [];
}

// Build a { rawValue: "Display Name" } map for a tagger custom field, so raw
// option values (e.g. "galaxy_s26_ultra") can be shown the way the agent UI does
// ("Galaxy S26 Ultra"). Returns {} if the field has no options.
function getZendeskFieldOptionMap_(fieldId) {
  const field = zendeskApiGet_(`/api/v2/ticket_fields/${fieldId}.json`).ticket_field || {};
  const map = {};
  (field.custom_field_options || []).forEach(o => { map[o.value] = o.name; });
  return map;
}

function removeDuplicatesByTicketID(sheet) {
  const dataRange = sheet.getDataRange();
  const data = dataRange.getValues();
  const seen = new Set();
  const deduped = [data[0]]; // Keep headers
  for (let i = 1; i < data.length; i++) {
    const ticketId = data[i][0];
    if (!seen.has(ticketId)) {
      seen.add(ticketId);
      deduped.push(data[i]);
    }
  }
  sheet.clearContents();
  sheet.getRange(1, 1, deduped.length, deduped[0].length).setValues(deduped);
}

/********************************
 * 1. Fetch Multiple Views → Zendesk_Daily
 ********************************/
function fetchZendeskViewToSheet() {
  const viewIds = [
    '360102672972',
    '360121546552',
    '360121545992',
    '360108214671',
    '28990066416793',
    '360096790151',
    '19940259463705',
    '360103290632',
    '37502606662809'
  ];

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Zendesk_Daily');
  sheet.clearContents();

  const headersRow = [
    'Ticket ID', 'Status', 'Subject', 'Priority',
    'Created At', 'Updated At', 'Assignee ID', 'Requester ID', 'Tags'
  ];
  sheet.getRange(1, 1, 1, headersRow.length).setValues([headersRow]);

  let allRows = [];

  for (const viewId of viewIds) {
    const tickets = getZendeskTicketsByView(viewId);
    if (tickets.length === 0) {
      Logger.log(`No tickets found in view ${viewId}`);
      continue;
    }
    const rows = tickets.map(t => [
      t.id || '',
      t.status || '',
      t.subject || '',
      t.priority || '',
      t.created_at || '',
      t.updated_at || '',
      t.assignee_id || '',
      t.requester_id || '',
      (t.tags || []).join(', ')
    ]);
    allRows = allRows.concat(rows);
  }

  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, headersRow.length).setValues(allRows);
    removeDuplicatesByTicketID(sheet);
  } else {
    Logger.log("No tickets found in any of the views.");
  }

  SpreadsheetApp.flush(); // make sure the writes land before appendZendeskDailyStatus() counts them
}

/********************************
 * 2. Fetch Ksheet View → K_시트
 ********************************/
// Zendesk custom field IDs used for the K_시트 table
const KSHEET_BRAND_FIELD_ID    = 5495572594201; // Brand(상세)
const KSHEET_COUNTRY_FIELD_ID  = 4513936822297; // Country
const KSHEET_CATEGORY_FIELD_ID = 900006613446;  // Category
const KSHEET_DEVICE_FIELD_ID   = 360022185671;  // Device
const KSHEET_REASON_FIELD_ID   = 360022182831;  // 1차 Defect Reason or Inquiries

function fetchZendeskViewToKsheet() {
  const viewId = '49523632520985';
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('K_시트');

  // Clear B~I from row 5 to bottom (B seq, C country, D brand, E category,
  // F qty, G owner, H device, I 1차 reason)
  const maxRows = sheet.getMaxRows();
  if (maxRows > 4) {
    sheet.getRange(5, 2, maxRows - 4, 8).clearContent();
  }
  // Make sure the two added columns are labelled (idempotent)
  sheet.getRange(4, 8, 1, 2).setValues([['Device', '1차 Defect Reason or Inquiries']]);

  const tickets = getZendeskTicketsByView(viewId);
  if (tickets.length === 0) {
    Logger.log("No tickets found in view.");
    updateB3DateBanner(sheet);
    return;
  }

  // Raw option value -> display name, so "galaxy_s26_ultra" shows as "Galaxy S26 Ultra"
  const deviceMap = getZendeskFieldOptionMap_(KSHEET_DEVICE_FIELD_ID);
  const reasonMap = getZendeskFieldOptionMap_(KSHEET_REASON_FIELD_ID);
  const prettyOption = (map, raw) => raw ? (map[raw] || String(raw).replace(/_/g, ' ').trim()) : '';

  // Format helpers
  const formatBrandCode = raw => ({
    'spigen_case_': 'Spigen(CASE)',
    'spigen_steinheil_': 'Spigen(Steinheil)',
    'spigen_odm_': 'Spigen(ODM)',
    'spigen_pacc._': 'Spigen(PAcc.)',
    'spigen_new_biz_': 'Spigen(New Biz)',
    'n/a': 'n/a'
  }[raw] || raw);

  const formatCategoryCode = raw => ({
    '1._invoice': '1. Invoice',
    '2._delivery': '2. Delivery',
    '3._exchange': '3. Exchange',
    '4._issue': '4. Product Issue',
    '5._fbm': '5. FBM',
    '6._product_inquiry': '6. Product Inquiry',
    '7._other_inquiry': '7. Other Inquiry',
    '8._문의_사항_파악_불가': '8. 문의 사항 파악 불가'
  }[raw] || raw);

  const getPIC = country => {
    const groupA = ['DE', 'FR', 'IT', 'UK', 'ES'];

    // Base date: Monday, 2025-08-11 00:00 KST
    const baseDateKST = new Date('2025-08-11T00:00:00+09:00');

    // Current date/time in KST
    const nowKST = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })
    );

    // Weeks since base date
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weekIndex = Math.floor((nowKST - baseDateKST) / msPerWeek);

    // Even week index → LYS, Odd week index → KJW for Group A (switched 2026-06-29)
    const assignKJWThisWeek = (weekIndex % 2 === 0);

    return groupA.includes(country)
      ? (assignKJWThisWeek ? 'LYS' : 'KJW')
      : (assignKJWThisWeek ? 'KJW' : 'LYS');
  };

  // Process rows
  const rawRows = tickets
    .filter(t => t.status && t.status.toLowerCase() === 'pending')
    .map(t => {
      const cf = t.custom_fields || [];
      const brandRaw = cf.find(f => f.id === KSHEET_BRAND_FIELD_ID)?.value || '';
      const countryRaw = cf.find(f => f.id === KSHEET_COUNTRY_FIELD_ID)?.value || '';
      const categoryRaw = cf.find(f => f.id === KSHEET_CATEGORY_FIELD_ID)?.value || '';
      const deviceRaw = cf.find(f => f.id === KSHEET_DEVICE_FIELD_ID)?.value || '';
      const reasonRaw = cf.find(f => f.id === KSHEET_REASON_FIELD_ID)?.value || '';
      return [
        (countryRaw || '').toUpperCase(),
        formatBrandCode(brandRaw),
        formatCategoryCode(categoryRaw),
        prettyOption(deviceMap, deviceRaw),
        prettyOption(reasonMap, reasonRaw)
      ];
    });

  // Group by country + brand + category + device + reason
  const grouped = new Map(); // JSON([...]) -> { fields, count }
  rawRows.forEach(fields => {
    if (!fields[0]) return; // no country
    const key = JSON.stringify(fields);
    const hit = grouped.get(key);
    if (hit) hit.count++;
    else grouped.set(key, { fields: fields, count: 1 });
  });

  // Final rows: [country, brand, category, count, PIC, device, reason] -> written to C:I
  const finalRows = Array.from(grouped.values()).map(({ fields, count }) => {
    const [country, brand, category, device, reason] = fields;
    return [country, brand, category, count, getPIC(country), device, reason];
  });

  if (finalRows.length > 0) {
    sheet.getRange(5, 3, finalRows.length, 7).setValues(finalRows);
    const seq = Array.from({ length: finalRows.length }, (_, i) => [i + 1]);
    sheet.getRange(5, 2, finalRows.length, 1).setValues(seq);
  }

  updateB3DateBanner(sheet);
}

/********************************
 * Banner Date Helper
 ********************************/
function updateB3DateBanner(sheet) {
  const now = new Date();
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "MM/dd");
  const dayName = now.toLocaleDateString('en-US', { weekday: 'short' });
  sheet.getRange('B3').setValue(`${dateStr} (${dayName}) T2 업무시작 Pending Ticket 수`);
}

/***** ========= BACKFILL CONFIG ========= *****/
// Adjust these if your sheet layout changes.
var BF_SHEET_NAME  = 'MCF 발송 로그';
var BF_START_ROW   = 4;    // first data row (skip headers)
var BF_COL_REGION  = 2;    // B — "JP" triggers FE-first, anything else EU-first
var BF_COL_ORDER   = 17;   // Q — sellerFulfillmentOrderId
var BF_COL_SENT    = 16;   // P — MCF sent date (yyyy-mm-dd)
var BF_COL_RESULT  = 26;   // Z — static tracking number
                            //     replace =AMZTK(Q…) formula with =IF(Z…="","",HYPERLINK(…Z…,Z…))
var BF_COL_FEE     = 25;   // Y — Transportation Fee (€, ¥, £) written by backfillMCFFees()

/**
 * Writes tracking numbers as static values into BF_COL_RESULT.
 * - Skips rows that already have a valid (non-error) tracking number.
 * - Retries rows whose result cell contains an error string ("EU ERR:…", "ERR:…", etc.).
 * - On 429 / transient error, writes the error back to the cell so the next run retries it.
 *
 * Run manually or set a daily time-based trigger on this function.
 */
function backfillTrackingNumbers() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  _warmLwaTokens(); // fetch EU+JP tokens once before the loop to avoid per-row rate-limit 401s

  var lastRow = sheet.getLastRow();
  if (lastRow < BF_START_ROW) return;

  var numRows  = lastRow - BF_START_ROW + 1;
  var orderIds = sheet.getRange(BF_START_ROW, BF_COL_ORDER,  numRows, 1).getValues();
  var regions  = sheet.getRange(BF_START_ROW, BF_COL_REGION, numRows, 1).getValues();
  var existing = sheet.getRange(BF_START_ROW, BF_COL_RESULT, numRows, 1).getValues();

  for (var i = 0; i < numRows; i++) {
    var orderId = String(orderIds[i][0] || '').trim();
    if (!orderId) continue;

    var current = existing[i][0];
    // Already has a valid tracking number — never overwrite.
    if (current && !_isErrorValue(current)) continue;

    var isJP      = String(regions[i][0] || '').trim().toUpperCase() === 'JP';
    var endpoints = isJP ? ['FE', 'EU'] : ['EU', 'FE'];

    var tn = '';
    var retries429b = 0;
    var fetchOkB = false;
    while (!fetchOkB) {
      try {
        var tracks = _tracksWithFallbacks(orderId, endpoints);
        tn = (tracks && tracks.length && (tracks[0].trackingNumber || '').trim())
          ? tracks[0].trackingNumber.trim() : '';
        Utilities.sleep(400);
        fetchOkB = true;
      } catch (e) {
        if (_isRateLimit429(e) && retries429b < 3) {
          retries429b++;
          Logger.log('Row ' + (BF_START_ROW + i) + ': 429 — waiting 45 s (retry ' + retries429b + '/3)');
          Utilities.sleep(45000);
        } else {
          var errMsg = (isJP ? 'JP' : 'EU') + ' ERR: ' + (e.message || e);
          sheet.getRange(BF_START_ROW + i, BF_COL_RESULT).setValue(errMsg);
          Logger.log('Row ' + (BF_START_ROW + i) + ': ' + errMsg);
          fetchOkB = true; // stop retrying, move on
        }
      }
    }

    if (tn) {
      sheet.getRange(BF_START_ROW + i, BF_COL_RESULT).setValue(tn);
      Logger.log('Row ' + (BF_START_ROW + i) + ': wrote ' + tn);
    }
  }
}

/***** ========= RETRY 429 ERRORS IN COL R ========= *****/
var RETRY_R_START_ROW        = 1108; // only rows from here down — matches the reported error range
var RETRY_R_COL              = 18;   // R — live =AMZTK()/=AMZTK_JP() tracking formula
var RETRY_R_MAX_ROWS_PER_RUN = 40;   // hard cap so one execution can't hammer SP-API across hundreds of rows
var RETRY_R_MAX_CONSEC_429   = 5;    // abort the run early if quota is clearly still exhausted

/**
 * Finds cells in col R (MCF 발송 로그, row RETRY_R_START_ROW+) whose live =AMZTK()/=AMZTK_JP()
 * formula is currently showing a 429 QuotaExceeded error, and re-fetches those specific orders
 * directly.
 *
 * - Found a tracking number: freezes the cell to a static =HYPERLINK(...) (same URL format the
 *   live formula produces). This is deliberate, not just a recalc trick — confirmed live that
 *   Sheets' custom-function engine does NOT reliably re-run AMZTK()/AMZTK_JP() just because
 *   Apps Script rewrites the identical formula text via the API (cache was primed correctly but
 *   the cell kept showing the stale 429 text), so writing the final known-correct value directly
 *   is the only way to guarantee the sheet actually displays it — and it also means the row won't
 *   match the 429 filter on the next run, so later runs progress to new rows instead of
 *   re-fetching the same already-resolved orders every hour.
 * - No tracking number yet (order genuinely not ready, no error): primes the cache AMZTK reads
 *   from, then forces a real recalculation by writing a placeholder formula and then the original
 *   formula back — two distinct writes, since Sheets only re-triggers custom functions on an
 *   actual content change — so the stale error clears to blank instead of sitting there forever.
 *
 * Bounded two ways so a single run can never call the API forever:
 *   1) stops after RETRY_R_MAX_ROWS_PER_RUN rows
 *   2) aborts the whole run after RETRY_R_MAX_CONSEC_429 consecutive rows still come back 429 —
 *      quota is clearly still exhausted, so this run stops instead of hammering it; the next
 *      hourly trigger picks up where this one left off
 *
 * Run manually, or via the hourly trigger already installed on the live script
 * (Apps Script editor → Triggers).
 */
function retryR429Errors() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < RETRY_R_START_ROW) return;

  var numRows   = lastRow - RETRY_R_START_ROW + 1;
  var rValues   = sheet.getRange(RETRY_R_START_ROW, RETRY_R_COL, numRows, 1).getDisplayValues();
  var rFormulas = sheet.getRange(RETRY_R_START_ROW, RETRY_R_COL, numRows, 1).getFormulas();
  var regions   = sheet.getRange(RETRY_R_START_ROW, BF_COL_REGION, numRows, 1).getValues();
  var orderIds  = sheet.getRange(RETRY_R_START_ROW, BF_COL_ORDER,  numRows, 1).getValues();

  _warmLwaTokens();

  var cache = CacheService.getScriptCache();
  var processed = 0, fixed = 0, cleared = 0, stillFailing = 0, consec429 = 0;

  for (var i = 0; i < numRows; i++) {
    if (processed >= RETRY_R_MAX_ROWS_PER_RUN) {
      Logger.log('retryR429Errors: hit per-run cap (' + RETRY_R_MAX_ROWS_PER_RUN + ' rows) — remaining rows retried next hour.');
      break;
    }

    if (!_is429ErrorValue(rValues[i][0])) continue;

    var formula = rFormulas[i][0];
    if (!formula) continue; // not a live formula cell — nothing to retry

    var orderId = String(orderIds[i][0] || '').trim();
    if (!orderId) continue;

    var row       = RETRY_R_START_ROW + i;
    var isJP      = String(regions[i][0] || '').trim().toUpperCase() === 'JP';
    var endpoints = isJP ? ['FE', 'EU'] : ['EU', 'FE'];
    var cacheKey  = (isJP ? 'AMZTK_JP_' : 'AMZTK_') + orderId;

    processed++;

    var tn = '', got429 = false;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var tracks = _tracksWithFallbacks(orderId, endpoints);
        tn = (tracks && tracks.length && (tracks[0].trackingNumber || '').trim())
          ? tracks[0].trackingNumber.trim() : '';
        got429 = false;
        break;
      } catch (e) {
        if (_isRateLimit429(e) && attempt < 2) {
          got429 = true;
          Logger.log('Row ' + row + ': 429 — waiting 45 s (attempt ' + (attempt + 1) + '/3)');
          Utilities.sleep(45000);
          continue;
        }
        got429 = _isRateLimit429(e);
        break; // non-429, or 429 retries exhausted — stop retrying this row
      }
    }

    if (got429) {
      consec429++;
      stillFailing++;
      Logger.log('Row ' + row + ': still 429 after retries (' + consec429 + '/' + RETRY_R_MAX_CONSEC_429 + ' consecutive)');
      if (consec429 >= RETRY_R_MAX_CONSEC_429) {
        Logger.log('retryR429Errors: quota still exhausted after ' + consec429 + ' consecutive 429s — stopping this run.');
        break;
      }
      continue;
    }
    consec429 = 0;

    if (tn) {
      // Freeze to a static HYPERLINK — guaranteed to render, and drops out of the 429 filter
      // on future runs so this row is never re-fetched again.
      var domain = isJP ? 'jp' : 'de';
      var url    = 'https://www.swiship.' + domain + '/track?id=' + tn;
      sheet.getRange(row, RETRY_R_COL).setFormula('=HYPERLINK("' + url + '","' + tn + '")');
      fixed++;
      Logger.log('Row ' + row + ': fixed → ' + tn);
    } else {
      // Order not ready yet — prime the cache AMZTK reads from, then force a genuine
      // recalculation (placeholder write, then the real formula) so the stale 429 text clears.
      cache.put(cacheKey, '', 600);
      var cell = sheet.getRange(row, RETRY_R_COL);
      cell.setFormula('=NA()');
      SpreadsheetApp.flush();
      cell.setFormula(formula);
      cleared++;
      Logger.log('Row ' + row + ': no tracking number yet — cleared stale error');
    }
  }

  SpreadsheetApp.flush();
  Logger.log('retryR429Errors done — processed: ' + processed + ', fixed: ' + fixed + ', cleared: ' + cleared + ', still 429: ' + stillFailing);
}

function _is429ErrorValue(v) {
  var s = String(v || '');
  return s.indexOf('SP-API error 429') >= 0 || s.indexOf('QuotaExceeded') >= 0;
}

/***** ========= RETRY $0 TRANSPORTATION FEES IN COL Y ========= *****/
var RETRY_ZERO_FEE_MAX_ROWS_PER_RUN = 40; // hard cap so one run only clears/reprocesses a bounded batch

/**
 * Finds cells in col Y (Transportation Fee) showing a literal 0 — the symptom of the GCX
 * fee-type filtering bug (see _sumMcfFeeFromShipments) that was fixed in sp-api.js, but had
 * already written wrong 0s into the sheet before the fix landed. backfillMCFFees() skips any
 * row whose col Y already has a non-empty value — including "0" — so those rows never get
 * reprocessed on their own even after the fix.
 *
 * Clears up to RETRY_ZERO_FEE_MAX_ROWS_PER_RUN of those 0-cells back to blank (making them
 * "pending" under backfillMCFFees()'s own skip logic), then runs backfillMCFFees() so they
 * get recomputed with the fixed fee-type logic. All of backfillMCFFees()'s own safeguards
 * (429 sleep-and-retry per window, moving on rather than hanging) apply as-is — no separate
 * retry/backoff logic needed here.
 *
 * Bounded so a single run can't try to clear and reprocess the whole historical backlog at
 * once, which would risk a long-running execution across many months of Finances API windows.
 * Run hourly and it works through the backlog gradually.
 *
 * Run manually, or set up an hourly time-based trigger for this function via
 * Apps Script editor → Triggers.
 */
function retryZeroTransportationFees() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < BF_START_ROW) return;

  var numRows = lastRow - BF_START_ROW + 1;
  var feeVals = sheet.getRange(BF_START_ROW, BF_COL_FEE, numRows, 1).getValues();

  var cleared = 0;
  for (var i = 0; i < numRows && cleared < RETRY_ZERO_FEE_MAX_ROWS_PER_RUN; i++) {
    var v = feeVals[i][0];
    if (v === 0 || v === '0') {
      sheet.getRange(BF_START_ROW + i, BF_COL_FEE).setValue('');
      cleared++;
    }
  }

  if (!cleared) {
    Logger.log('retryZeroTransportationFees: no zero-fee cells found — nothing to do.');
    return;
  }

  Logger.log('retryZeroTransportationFees: cleared ' + cleared + ' zero-fee cell(s), running backfillMCFFees()...');
  backfillMCFFees();
}

/**
 * ONE-TIME recovery variant of retryZeroTransportationFees() — clears ALL zero-fee cells in
 * col Y (uncapped) in a single batched write, then runs backfillMCFFees() once.
 *
 * Use this instead of the hourly-safe retryZeroTransportationFees() (40 rows/run) when there's
 * a large one-off backlog: backfillMCFFees()'s cost is dominated by the date-range window
 * fetches (a handful of calls covering the whole range), not by how many rows get matched
 * against the result — clearing only a small slice per run means paying that same window-fetch
 * cost repeatedly while only a few rows benefit each time. Clearing everything at once lets a
 * single backfillMCFFees() run resolve the whole backlog in one pass (assuming SP-API quota
 * allows it to complete).
 *
 * Run manually from the Apps Script editor once SP-API's EU quota has recovered — check with
 * auditYColumnFees() first if unsure, since that's read-only and won't consume quota needed for
 * this to succeed.
 */
function recoverAllZeroTransportationFees() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < BF_START_ROW) return;

  var numRows  = lastRow - BF_START_ROW + 1;
  var feeRange = sheet.getRange(BF_START_ROW, BF_COL_FEE, numRows, 1);
  var feeVals  = feeRange.getValues();

  var cleared = 0;
  for (var i = 0; i < numRows; i++) {
    var v = feeVals[i][0];
    if (v === 0 || v === '0') {
      feeVals[i][0] = '';
      cleared++;
    }
  }

  if (!cleared) {
    Logger.log('recoverAllZeroTransportationFees: no zero-fee cells found — nothing to do.');
    return;
  }

  feeRange.setValues(feeVals); // single batched write, not one setValue() call per row
  Logger.log('recoverAllZeroTransportationFees: cleared ' + cleared + ' zero-fee cell(s) in one batch, running backfillMCFFees()...');
  backfillMCFFees();
}

/**
 * READ-ONLY audit: computes the true Finances API fee for every row in col Y that's currently
 * blank or a literal 0, WITHOUT writing anything back to col Y. Writes a side-by-side comparison
 * (row, orderId, sentDate, current Y value, computed true fee) to a separate "Y_Fee_Audit" sheet
 * tab instead, so this can be reviewed before touching the original data at all.
 *
 * Uses the same batched 60-day-window Finances API approach as backfillMCFFees() (a handful of
 * calls covering the whole date range, not one call per row) to minimize additional load while
 * SP-API's quota may still be recovering from earlier heavy use today. Handles 429 with the same
 * sleep-and-retry-once-per-window pattern; a window that still fails is logged and skipped rather
 * than blocking the rest of the audit.
 *
 * Run manually from the Apps Script editor.
 */
function auditYColumnFees() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < BF_START_ROW) return;

  var numRows   = lastRow - BF_START_ROW + 1;
  var orderIds  = sheet.getRange(BF_START_ROW, BF_COL_ORDER,  numRows, 1).getValues();
  var sentDates = sheet.getRange(BF_START_ROW, BF_COL_SENT,   numRows, 1).getValues();
  var regions   = sheet.getRange(BF_START_ROW, BF_COL_REGION, numRows, 1).getValues();
  var currentY  = sheet.getRange(BF_START_ROW, BF_COL_FEE,    numRows, 1).getValues();

  var targets = [];
  var hasJP   = false;
  var minDate = null;

  for (var i = 0; i < numRows; i++) {
    var orderId = String(orderIds[i][0] || '').trim();
    if (!orderId) continue;

    var yVal = currentY[i][0];
    var isZeroOrBlank = (yVal === 0 || yVal === '0' || yVal === '' || yVal === null || yVal === undefined);
    if (!isZeroOrBlank) continue;

    var sentDate = String(sentDates[i][0] || '').trim();
    var isJP     = String(regions[i][0]   || '').trim().toUpperCase() === 'JP';
    if (isJP) hasJP = true;

    if (sentDate) {
      var d = new Date(sentDate);
      if (!minDate || d < minDate) minDate = d;
    }

    targets.push({ row: BF_START_ROW + i, orderId: orderId, sentDate: sentDate, isJP: isJP, currentY: yVal });
  }

  if (!targets.length) {
    Logger.log('auditYColumnFees: no zero/blank rows found — nothing to audit.');
    return;
  }

  var now = new Date(Date.now() - 5 * 60 * 1000);
  if (!minDate) minDate = new Date(now.getTime() - 180 * 24 * 3600 * 1000);

  Logger.log('auditYColumnFees: %s target rows, window %s → now', targets.length, minDate.toISOString().slice(0, 10));

  function fetchFeeMap(ep) {
    var feeMap      = {};
    var windowStart = new Date(minDate);

    while (windowStart < now) {
      var windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 60);
      if (windowEnd > now) windowEnd = now;
      if (windowStart >= windowEnd) break;

      try {
        var chunk = _buildFeeMapForWindow(ep, windowStart, windowEnd);
        Object.keys(chunk).forEach(function(k) { feeMap[k] = chunk[k]; });
        Logger.log('  [%s] %s – %s: %s orders found', ep,
          windowStart.toISOString().slice(0, 10), windowEnd.toISOString().slice(0, 10), Object.keys(chunk).length);
      } catch (e) {
        if (_isRateLimit429(e)) {
          Logger.log('  [%s] 429 — sleeping 15 s, retrying window', ep);
          Utilities.sleep(15000);
          try {
            var chunk2 = _buildFeeMapForWindow(ep, windowStart, windowEnd);
            Object.keys(chunk2).forEach(function(k) { feeMap[k] = chunk2[k]; });
          } catch (e2) {
            Logger.log('  [%s] retry also failed — skipping window: %s', ep, e2.message);
          }
        } else {
          Logger.log('  [%s] window error (%s): %s', ep, windowStart.toISOString().slice(0, 10), e.message);
        }
      }

      windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() + 1);
      Utilities.sleep(500);
    }

    return feeMap;
  }

  var euMap = fetchFeeMap('EU');
  var feMap = hasJP ? fetchFeeMap('FE') : {};

  var results = [['Row', 'OrderID', 'SentDate', 'Current Y value', 'Computed true fee', 'Source', 'Note']];
  var matched = 0, stillUnresolved = 0;

  targets.forEach(function(t) {
    var primaryMap   = t.isJP ? feMap : euMap;
    var secondaryMap = t.isJP ? euMap : feMap;
    var primaryEp    = t.isJP ? 'FE' : 'EU';
    var secondaryEp  = t.isJP ? 'EU' : 'FE';

    var fee, src;
    if (primaryMap[t.orderId] !== undefined)        { fee = primaryMap[t.orderId];   src = primaryEp; }
    else if (secondaryMap[t.orderId] !== undefined) { fee = secondaryMap[t.orderId]; src = secondaryEp; }
    else                                             { fee = ''; src = ''; }

    if (fee !== '') matched++; else stillUnresolved++;

    results.push([
      t.row, t.orderId, t.sentDate, t.currentY,
      fee, src,
      fee !== '' ? '' : 'not found in window — may be outside range, unsettled, or needs displayableOrderId fallback'
    ]);
  });

  var auditSheet = ss.getSheetByName('Y_Fee_Audit');
  if (!auditSheet) auditSheet = ss.insertSheet('Y_Fee_Audit');
  auditSheet.clearContents();
  auditSheet.getRange(1, 1, results.length, results[0].length).setValues(results);

  Logger.log('auditYColumnFees done — %s matched, %s still unresolved. See "Y_Fee_Audit" sheet. Col Y was NOT modified.',
    matched, stillUnresolved);
}

/**
 * Writes MCF fulfillment fees as static values into BF_COL_FEE (col Y).
 *
 * Batch approach: fetches all financial events in 60-day windows (EU + FE endpoints)
 * then matches every pending order ID against the result map — far fewer API calls
 * than the previous per-order approach.
 *
 * - Skips rows where fee is already filled (never overwrites a value).
 * - Rows marked RETRY or ERR are retried on the next run.
 * Run manually or set a daily time-based trigger.
 */
function backfillMCFFees() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < BF_START_ROW) return;

  var numRows   = lastRow - BF_START_ROW + 1;
  var orderIds  = sheet.getRange(BF_START_ROW, BF_COL_ORDER,  numRows, 1).getValues();
  var sentDates = sheet.getRange(BF_START_ROW, BF_COL_SENT,   numRows, 1).getValues();
  var regions   = sheet.getRange(BF_START_ROW, BF_COL_REGION, numRows, 1).getValues();
  var existing  = sheet.getRange(BF_START_ROW, BF_COL_FEE,    numRows, 1).getValues();

  // Collect rows that still need a fee
  var pending = [];
  var hasJP   = false;
  var minDate = null;

  for (var i = 0; i < numRows; i++) {
    var orderId = String(orderIds[i][0] || '').trim();
    if (!orderId) continue;

    var curStr = String(existing[i][0] === null || existing[i][0] === undefined ? '' : existing[i][0]).trim();
    // Skip rows that already have a valid numeric fee
    if (curStr !== '' && curStr !== 'RETRY' && !_isErrorValue(curStr)) continue;

    var sentDate = String(sentDates[i][0] || '').trim();
    var isJP     = String(regions[i][0]   || '').trim().toUpperCase() === 'JP';
    if (isJP) hasJP = true;

    if (sentDate) {
      var d = new Date(sentDate);
      if (!minDate || d < minDate) minDate = d;
    }

    pending.push({ i: i, orderId: orderId, sentDate: sentDate, isJP: isJP });
  }

  if (!pending.length) {
    Logger.log('backfillMCFFees: nothing to process');
    return;
  }

  var now = new Date(Date.now() - 5 * 60 * 1000); // 5-min buffer for clock drift
  if (!minDate) minDate = new Date(now.getTime() - 180 * 24 * 3600 * 1000); // fallback: 180 days

  Logger.log('backfillMCFFees: %s rows pending, window %s → now', pending.length, minDate.toISOString().slice(0, 10));

  // Fetch all financial events in 60-day windows for one endpoint
  function fetchFeeMap(ep) {
    var feeMap      = {};
    var windowStart = new Date(minDate);

    while (windowStart < now) {
      var windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 60);
      if (windowEnd > now) windowEnd = now;
      if (windowStart >= windowEnd) break;

      try {
        var chunk = _buildFeeMapForWindow(ep, windowStart, windowEnd);
        var keys  = Object.keys(chunk);
        keys.forEach(function(k) { feeMap[k] = chunk[k]; });
        Logger.log('  [%s] %s – %s: %s orders found', ep,
          windowStart.toISOString().slice(0, 10), windowEnd.toISOString().slice(0, 10), keys.length);
      } catch (e) {
        if (_isRateLimit429(e)) {
          Logger.log('  [%s] 429 — sleeping 15 s, retrying window', ep);
          Utilities.sleep(15000);
          try {
            var chunk2 = _buildFeeMapForWindow(ep, windowStart, windowEnd);
            Object.keys(chunk2).forEach(function(k) { feeMap[k] = chunk2[k]; });
          } catch (e2) {
            Logger.log('  [%s] retry also failed: %s', ep, e2.message);
          }
        } else {
          Logger.log('  [%s] window error (%s): %s', ep, windowStart.toISOString().slice(0, 10), e.message);
        }
      }

      windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() + 1);
      Utilities.sleep(500); // stay under SP-API rate limit between windows
    }

    return feeMap;
  }

  var euMap = fetchFeeMap('EU');
  var feMap = hasJP ? fetchFeeMap('FE') : {};

  // Write fees — track unmatched rows for displayableOrderId fallback
  var written = 0, notSettled = 0;
  var unfilledRows = [];

  pending.forEach(function(r) {
    var primaryMap   = r.isJP ? feMap : euMap;
    var secondaryMap = r.isJP ? euMap : feMap;
    var fee = primaryMap[r.orderId]   !== undefined ? primaryMap[r.orderId]
            : secondaryMap[r.orderId] !== undefined ? secondaryMap[r.orderId]
            : null;

    if (fee !== null) {
      sheet.getRange(BF_START_ROW + r.i, BF_COL_FEE).setValue(fee);
      Logger.log('Row %s (%s): fee = %s', BF_START_ROW + r.i, r.orderId, fee);
      written++;
    } else {
      unfilledRows.push(r);
    }
  });

  // Fallback: some MCF orders settle in Finances API under displayableOrderId
  // (e.g. when the MCF order is linked to an Amazon marketplace order).
  // Call getFulfillmentOrderRaw per unmatched row to resolve the alternate ID.
  if (unfilledRows.length) {
    Logger.log('backfillMCFFees: %s rows unmatched — trying displayableOrderId fallback', unfilledRows.length);
    unfilledRows.forEach(function(r) {
      var resolved = false;
      try {
        var ep       = r.isJP ? 'FE' : 'EU';
        var foResult = getFulfillmentOrderRaw(r.orderId, ep);
        var dispId   = ((foResult.fulfillmentOrder || {}).displayableOrderId || '').trim();
        if (dispId && dispId !== r.orderId) {
          var primaryMap   = r.isJP ? feMap : euMap;
          var secondaryMap = r.isJP ? euMap : feMap;
          var fee2 = primaryMap[dispId]   !== undefined ? primaryMap[dispId]
                   : secondaryMap[dispId] !== undefined ? secondaryMap[dispId]
                   : null;
          if (fee2 !== null) {
            sheet.getRange(BF_START_ROW + r.i, BF_COL_FEE).setValue(fee2);
            Logger.log('Row %s (%s → %s): fee = %s via displayableOrderId', BF_START_ROW + r.i, r.orderId, dispId, fee2);
            written++;
            resolved = true;
          }
        }
      } catch (e) {
        Logger.log('Row %s (%s): fallback error: %s', BF_START_ROW + r.i, r.orderId, e.message || e);
      }
      if (!resolved) {
        Logger.log('Row %s (%s): not yet settled', BF_START_ROW + r.i, r.orderId);
        notSettled++;
      }
      Utilities.sleep(400);
    });
  }

  Logger.log('backfillMCFFees done — written: %s, not settled: %s', written, notSettled);
}

/**
 * Scoped variant of backfillMCFFees() — only processes rows sent within the last `days` days
 * (default 90), and clamps the Finances API scan window to that same range instead of using
 * the earliest pending row's date.
 *
 * backfillMCFFees() always scans from the earliest pending row's sentDate to now — with the
 * current backlog that means ~9 EU + 9 FE 60-day windows covering March 2025 → now, which is
 * expensive enough that back-to-back runs don't give SP-API's Finances API quota enough real
 * time to recover between attempts (confirmed live: a run that succeeded got followed by one
 * that immediately hit persistent 429 again ~10 minutes later). This variant costs ~2 windows
 * instead of ~9, is far more likely to succeed even while quota is still recovering, and
 * prioritizes the most recent (most operationally relevant) orders. Older pending rows outside
 * the window are left for a later backfillMCFFees() run once quota is more comfortably available.
 *
 * Run manually from the Apps Script editor.
 */
function backfillMCFFeesRecent(days) {
  days = days || 90;

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < BF_START_ROW) return;

  var now      = new Date(Date.now() - 5 * 60 * 1000);
  var cutoff   = new Date(now.getTime() - days * 24 * 3600 * 1000);

  var numRows   = lastRow - BF_START_ROW + 1;
  var orderIds  = sheet.getRange(BF_START_ROW, BF_COL_ORDER,  numRows, 1).getValues();
  var sentDates = sheet.getRange(BF_START_ROW, BF_COL_SENT,   numRows, 1).getValues();
  var regions   = sheet.getRange(BF_START_ROW, BF_COL_REGION, numRows, 1).getValues();
  var existing  = sheet.getRange(BF_START_ROW, BF_COL_FEE,    numRows, 1).getValues();

  var pending = [];
  var hasJP   = false;

  for (var i = 0; i < numRows; i++) {
    var orderId = String(orderIds[i][0] || '').trim();
    if (!orderId) continue;

    var curStr = String(existing[i][0] === null || existing[i][0] === undefined ? '' : existing[i][0]).trim();
    if (curStr !== '' && curStr !== 'RETRY' && !_isErrorValue(curStr)) continue;

    var sentDateStr = String(sentDates[i][0] || '').trim();
    if (!sentDateStr) continue; // no sentDate — can't confirm it's within the recent window, skip here
    var d = new Date(sentDateStr);
    if (d < cutoff) continue; // older than the window — leave for a full backfillMCFFees() run

    var isJP = String(regions[i][0] || '').trim().toUpperCase() === 'JP';
    if (isJP) hasJP = true;

    pending.push({ i: i, orderId: orderId, sentDate: sentDateStr, isJP: isJP });
  }

  if (!pending.length) {
    Logger.log('backfillMCFFeesRecent: nothing pending within the last %s days.', days);
    return;
  }

  Logger.log('backfillMCFFeesRecent: %s rows pending, window %s → now (last %s days)',
    pending.length, cutoff.toISOString().slice(0, 10), days);

  function fetchFeeMap(ep) {
    var feeMap      = {};
    var windowStart = new Date(cutoff);

    while (windowStart < now) {
      var windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 60);
      if (windowEnd > now) windowEnd = now;
      if (windowStart >= windowEnd) break;

      try {
        var chunk = _buildFeeMapForWindow(ep, windowStart, windowEnd);
        var keys  = Object.keys(chunk);
        keys.forEach(function(k) { feeMap[k] = chunk[k]; });
        Logger.log('  [%s] %s – %s: %s orders found', ep,
          windowStart.toISOString().slice(0, 10), windowEnd.toISOString().slice(0, 10), keys.length);
      } catch (e) {
        if (_isRateLimit429(e)) {
          Logger.log('  [%s] 429 — sleeping 15 s, retrying window', ep);
          Utilities.sleep(15000);
          try {
            var chunk2 = _buildFeeMapForWindow(ep, windowStart, windowEnd);
            Object.keys(chunk2).forEach(function(k) { feeMap[k] = chunk2[k]; });
          } catch (e2) {
            Logger.log('  [%s] retry also failed: %s', ep, e2.message);
          }
        } else {
          Logger.log('  [%s] window error (%s): %s', ep, windowStart.toISOString().slice(0, 10), e.message);
        }
      }

      windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() + 1);
      Utilities.sleep(500);
    }

    return feeMap;
  }

  var euMap = fetchFeeMap('EU');
  var feMap = hasJP ? fetchFeeMap('FE') : {};

  var written = 0, notSettled = 0;

  pending.forEach(function(r) {
    var primaryMap   = r.isJP ? feMap : euMap;
    var secondaryMap = r.isJP ? euMap : feMap;
    var fee = primaryMap[r.orderId]   !== undefined ? primaryMap[r.orderId]
            : secondaryMap[r.orderId] !== undefined ? secondaryMap[r.orderId]
            : null;

    if (fee !== null) {
      sheet.getRange(BF_START_ROW + r.i, BF_COL_FEE).setValue(fee);
      Logger.log('Row %s (%s): fee = %s', BF_START_ROW + r.i, r.orderId, fee);
      written++;
    } else {
      notSettled++;
    }
  });

  Logger.log('backfillMCFFeesRecent done — written: %s, not settled: %s (older rows outside the %s-day window untouched)',
    written, notSettled, days);
}

/**
 * STEP 1 — run this first to undo the bad freeze.
 * Scans for HYPERLINK formulas whose "tracking number" looks like a price
 * (pure decimal number < 1000, e.g. "22.99") and restores the original
 * =IF(OR(B…,Q…),"",IF(B…<>"JP", HYPERLINK(…AMZTK…), HYPERLINK(…AMZTK_JP…))) formula.
 */
function unfreezeAmztkFormulas() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < BF_START_ROW) return;

  var numRows     = lastRow - BF_START_ROW + 1;
  var allFormulas = sheet.getRange(BF_START_ROW, 1, numRows, lastCol).getFormulas();
  // Matches =HYPERLINK("https://www.swiship.XX/track?id=22.99","22.99")
  var feePattern  = /^=HYPERLINK\("https:\/\/www\.swiship\.(de|jp)\/track\?id=(\d+\.?\d*)","(\d+\.?\d*)"\)$/i;

  var restored = 0;
  for (var i = 0; i < numRows; i++) {
    var rowNum = BF_START_ROW + i;
    var bRef = 'B' + rowNum;
    var qRef = 'Q' + rowNum;
    for (var c = 0; c < lastCol; c++) {
      var f = allFormulas[i][c] || '';
      var m = f.match(feePattern);
      if (!m) continue;
      // Tracking numbers are never plain small decimals — prices are (< 500 €/¥)
      if (parseFloat(m[2]) >= 500) continue;
      var orig =
        '=IF(OR(' + bRef + '="",' + qRef + '=""),"",IF(' + bRef + '<>"JP",' +
        'HYPERLINK("https://www.swiship.de/track?id="&AMZTK(' + qRef + '),AMZTK(' + qRef + ')),' +
        'HYPERLINK("https://www.swiship.jp/track?id="&AMZTK_JP(' + qRef + '),AMZTK_JP(' + qRef + '))))';
      sheet.getRange(rowNum, c + 1).setFormula(orig);
      restored++;
    }
  }
  Logger.log('unfreezeAmztkFormulas done — restored: ' + restored + ' cells');
  SpreadsheetApp.getUi().alert('수식 복원 완료: ' + restored + '개 셀');
}

/**
 * STEP 2 — run after unfreezeAmztkFormulas() (and after EU LWA is fixed).
 * Fetches real tracking numbers from SP-API only (never reads col Z as a source,
 * since col Z contains fees in this sheet).
 *
 * - JP rows: fetched via FE endpoint immediately.
 * - EU rows: skipped until EU LWA refresh token is re-authorised.
 * - Replaces each AMZTK formula cell with =HYPERLINK("swiship.XX/…","TN").
 * - Safe to run multiple times — skips cells that already have a non-AMZTK formula.
 */
function freezeAmztkFormulas() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  _warmLwaTokens();

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < BF_START_ROW) { Logger.log('No data rows.'); return; }

  var numRows = lastRow - BF_START_ROW + 1;

  var allFormulas = sheet.getRange(BF_START_ROW, 1, numRows, lastCol).getFormulas();
  var regions     = sheet.getRange(BF_START_ROW, BF_COL_REGION, numRows, 1).getValues();
  var orderIds    = sheet.getRange(BF_START_ROW, BF_COL_ORDER,  numRows, 1).getValues();

  var frozen = 0, pending = 0, skippedEU = 0;

  for (var i = 0; i < numRows; i++) {
    var orderId = String(orderIds[i][0] || '').trim();
    if (!orderId) continue;

    var amztkCols = [];
    for (var c = 0; c < lastCol; c++) {
      if ((allFormulas[i][c] || '').toUpperCase().indexOf('AMZTK') !== -1) {
        amztkCols.push(c + 1);
      }
    }
    if (!amztkCols.length) continue;

    var isJP = String(regions[i][0] || '').trim().toUpperCase() === 'JP';

    // EU rows: skip until LWA is re-authorised.
    if (!isJP) {
      Logger.log('Row ' + (BF_START_ROW + i) + ': EU — skipping (LWA broken)');
      skippedEU++;
      continue;
    }

    // JP rows: fetch from FE endpoint, with outer 429 retry (45 s backoff, up to 3×).
    var tn = '';
    var retries429 = 0;
    var fetchOk = false;
    while (!fetchOk) {
      try {
        var tracks = _tracksWithFallbacks(orderId, isJP ? ['FE', 'EU'] : ['EU', 'FE']);
        tn = (tracks && tracks.length && (tracks[0].trackingNumber || '').trim())
          ? tracks[0].trackingNumber.trim() : '';
        Utilities.sleep(400);
        fetchOk = true;
      } catch (e) {
        if (_isRateLimit429(e) && retries429 < 3) {
          retries429++;
          Logger.log('Row ' + (BF_START_ROW + i) + ': 429 — waiting 45 s (retry ' + retries429 + '/3)');
          Utilities.sleep(45000);
        } else {
          Logger.log('Row ' + (BF_START_ROW + i) + ': fetch error — ' + e.message);
          pending++;
          break;
        }
      }
    }
    if (!fetchOk) continue;

    if (!tn) { pending++; continue; }

    var url           = 'https://www.swiship.jp/track?id=' + tn;
    var staticFormula = '=HYPERLINK("' + url + '","' + tn + '")';
    for (var ci = 0; ci < amztkCols.length; ci++) {
      sheet.getRange(BF_START_ROW + i, amztkCols[ci]).setFormula(staticFormula);
    }
    Logger.log('Row ' + (BF_START_ROW + i) + ': frozen → ' + tn);
    frozen++;
  }

  Logger.log(
    'freezeAmztkFormulas done — frozen: ' + frozen +
    ', EU skipped: ' + skippedEU +
    ', pending (no TN yet): ' + pending
  );
  SpreadsheetApp.getUi().alert(
    '완료\n\n' +
    '✅ 고정됨 (JP): ' + frozen + '행\n' +
    '⏭ EU 스킵 (LWA 재인증 필요): ' + skippedEU + '행\n' +
    '⏳ 아직 운송장 없음: ' + pending + '행'
  );
}

function onEdit_mcf(e) {
  if (!e) return;

  const sheet = e.source.getActiveSheet();
  const editedCell = e.range;
  const row = editedCell.getRow();
  const col = editedCell.getColumn();
  const value = String(editedCell.getValue()).trim().toUpperCase();

  // Only run in MCF sheet
  if (sheet.getName() !== 'MCF 발송 로그') return;
  if (row < 4) return;  // ignore header rows

  /**********************************************
   * 1) STOCK CHECK (AB column = 28)
   **********************************************/
  if (col === 28 && value === "STOCK") {
    runStockCheckOnly(sheet, row);
    return;
  }

  /**********************************************
   * 2) FULL MCF RUN (W column = 23)
   **********************************************/
  if (col === 23 && value === "RUN") {
    processMCFRow(sheet, row);
    return;
  }

  /**********************************************
   * 3) ORIGINAL LOGIC
   **********************************************/

  // I → M (col 9 → 13) insert date once
  if (col === 9) {
    const targetCell = sheet.getRange(row, 13);
    if (!targetCell.getValue()) {
      const formattedDate = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
      targetCell.setValue(formattedDate);
    }
  }

  // N → S (col 14 → 19) set Pending
  if (col === 14) {
    const statusCell = sheet.getRange(row, 19);
    const nValue = editedCell.getValue();
    if (nValue !== "" && !statusCell.getValue()) {
      statusCell.setValue("Pending");
    }
  }

  // U → P + S (col 21 → 16 & 19)
  if (col === 21) {
    const uValue = editedCell.getValue();
    const pCell = sheet.getRange(row, 16);
    const sCell = sheet.getRange(row, 19);

    if (uValue !== "") {
      if (!pCell.getValue()) {
        const formattedDate = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
        pCell.setValue(formattedDate);
      }
      sCell.setValue("MCF");
    }
  }

  // F column → update H
  if (col === 6) { 
    updateMcfStockForRow(sheet, row);
  }

  /**********************************************
   * 4) NEW RULE — Y column triggers T + W
   *    Y = col 25
   *    T = col 20 (date)
   *    W = col 23 ("MCF")
   **********************************************/
  if (col === 25) {
    const yValue = editedCell.getValue().toString().trim();

    if (yValue !== "") {
      const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');

      // T column (20)
      const tCell = sheet.getRange(row, 20);
      if (!tCell.getValue()) {
        tCell.setValue(today);
      }

      // W column (23)
      const wCell = sheet.getRange(row, 23);
      wCell.setValue("MCF");
    }

    return;
  }
}

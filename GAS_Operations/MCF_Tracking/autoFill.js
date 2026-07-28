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
 * formula is currently showing a 429 QuotaExceeded error, re-fetches those specific orders
 * directly, primes AMZTK's own CacheService entry with the result, then rewrites the cell's
 * existing formula (same text) to force it to recalculate against the fresh cache instead of
 * the stale error. No formulas are ever replaced with static values.
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
  var processed = 0, fixed = 0, stillFailing = 0, consec429 = 0;

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

    // Prime AMZTK's own cache with the fresh result, then force the live formula to
    // re-evaluate so it reads the cache instead of repeating the API call.
    cache.put(cacheKey, tn, tn ? 21600 : 600);
    sheet.getRange(row, RETRY_R_COL).setFormula(formula);
    if (tn) fixed++;
    Logger.log('Row ' + row + ': ' + (tn ? 'fixed → ' + tn : 'no tracking number yet — cache refreshed'));
  }

  SpreadsheetApp.flush();
  Logger.log('retryR429Errors done — processed: ' + processed + ', fixed: ' + fixed + ', still 429: ' + stillFailing);
}

function _is429ErrorValue(v) {
  var s = String(v || '');
  return s.indexOf('SP-API error 429') >= 0 || s.indexOf('QuotaExceeded') >= 0;
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

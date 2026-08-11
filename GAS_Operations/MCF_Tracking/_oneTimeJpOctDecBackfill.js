/**
 * ONE-TIME BACKFILL JP Oct-Dec 2025 (2026-08-04) — writes Transportation Fee (col Y) for the
 * remaining older JP rows (Oct-Dec 2025), sourced from manually-requested JP Seller Central
 * settlement statements (FE region / jp credential set). Run once from the editor, then delete.
 */
function oneTimeJpOctDecBackfill() {
  var FEES = {"GCX-JP-251003-470":318.0,"GCX-JP-251006-485":288.0,"GCX-JP-251020-579":288.0,"GCX-JP-251021-592":318.0,"GCX-JP-251229-1087":318.0};

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + BF_SHEET_NAME);

  var lastRow = sheet.getLastRow();
  var numRows = lastRow - BF_START_ROW + 1;
  var orderIds = sheet.getRange(BF_START_ROW, BF_COL_ORDER, numRows, 1).getValues();
  var existing = sheet.getRange(BF_START_ROW, BF_COL_FEE, numRows, 1).getValues();

  var written = 0, skippedAlreadyFilled = 0, notInMap = 0;
  for (var i = 0; i < numRows; i++) {
    var orderId = String(orderIds[i][0] || '').trim();
    if (!orderId || !FEES.hasOwnProperty(orderId)) { notInMap++; continue; }

    var curStr = String(existing[i][0] === null || existing[i][0] === undefined ? '' : existing[i][0]).trim();
    if (curStr !== '' && curStr !== 'RETRY' && !_isErrorValue(curStr)) { skippedAlreadyFilled++; continue; }

    sheet.getRange(BF_START_ROW + i, BF_COL_FEE).setValue(FEES[orderId]);
    written++;
  }

  Logger.log('oneTimeJpOctDecBackfill done — written: %s, already filled (skipped): %s, not in map: %s',
    written, skippedAlreadyFilled, notInMap);
}

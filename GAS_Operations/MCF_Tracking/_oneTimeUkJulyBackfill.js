function oneTimeUkJulyBackfill() {
  var FEES = {"GCX-UK-260725-2760":3.48,"GCX-UK-260727-2768":3.48,"GCX-UK-260728-2781":3.5,"GCX-UK-260724-2758":3.48,"GCX-UK-260728-2786":3.48,"GCX-UK-260727-2775":4.64,"GCX-UK-260729-2798":3.45,"GCX-UK-260725-2759":3.48,"GCX-UK-260726-2766":3.48,"GCX-UK-260724-2754":3.48};

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

  Logger.log('oneTimeUkJulyBackfill done — written: %s, already filled (skipped): %s, not in map: %s',
    written, skippedAlreadyFilled, notInMap);
}

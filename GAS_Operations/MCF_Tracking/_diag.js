function diagVerifyRange2782to2909() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  var startRow = 2782, endRow = 2909;
  var numRows = endRow - startRow + 1;
  var fees  = sheet.getRange(startRow, BF_COL_FEE, numRows, 1).getValues();
  var notes = sheet.getRange(startRow, BF_COL_FEE, numRows, 1).getNotes();

  var stillBlank = 0, realValue = 0, estimateValue = 0;
  for (var i = 0; i < numRows; i++) {
    var feeStr = String(fees[i][0]===null||fees[i][0]===undefined?'':fees[i][0]).trim();
    var isBlank = (feeStr === '' || feeStr.toUpperCase()==='RETRY' || _isErrorValue(feeStr));
    if (isBlank) { stillBlank++; continue; }
    if (_isFeeEstimateNote(notes[i][0])) estimateValue++;
    else realValue++;
  }
  Logger.log('range %s-%s: stillBlank=%s, estimateValue=%s, realValue(pre-existing or settled)=%s',
    startRow, endRow, stillBlank, estimateValue, realValue);
}

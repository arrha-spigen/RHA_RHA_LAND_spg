function diagBlanksInWindow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BF_SHEET_NAME);
  var lastRow = sheet.getLastRow();
  var numRows = lastRow - BF_START_ROW + 1;

  var regions = sheet.getRange(BF_START_ROW, BF_COL_REGION, numRows, 1).getValues();
  var orders  = sheet.getRange(BF_START_ROW, BF_COL_ORDER, numRows, 1).getValues();
  var sents   = sheet.getRange(BF_START_ROW, BF_COL_SENT, numRows, 1).getValues();
  var fees    = sheet.getRange(BF_START_ROW, BF_COL_FEE, numRows, 1).getValues();

  var cutoffStart = new Date('2026-07-29T00:00:00');
  var cutoffEnd   = new Date('2026-08-12T00:00:00'); // exclusive, covers all of 08-11

  var out = [];
  var byRegion = {};
  for (var i = 0; i < numRows; i++) {
    var orderId = String(orders[i][0] || '').trim();
    if (!orderId) continue;
    var sentStr = String(sents[i][0] || '').trim();
    if (!sentStr) continue;
    var d = new Date(sentStr);
    if (isNaN(d.getTime()) || d < cutoffStart || d >= cutoffEnd) continue;

    var feeStr = String(fees[i][0] === null || fees[i][0] === undefined ? '' : fees[i][0]).trim();
    var isBlank = (feeStr === '' || feeStr.toUpperCase() === 'RETRY' || _isErrorValue(feeStr));
    if (!isBlank) continue;

    var region = String(regions[i][0] || '').trim().toUpperCase() || '(blank)';
    byRegion[region] = (byRegion[region] || 0) + 1;
    out.push((BF_START_ROW + i) + '|' + orderId + '|' + sentStr + '|' + region);
  }

  Logger.log('blanks in window 2026-07-29..2026-08-11: %s', out.length);
  Logger.log('by region: %s', JSON.stringify(byRegion));
  Logger.log('rows:\n%s', out.join('\n'));
}

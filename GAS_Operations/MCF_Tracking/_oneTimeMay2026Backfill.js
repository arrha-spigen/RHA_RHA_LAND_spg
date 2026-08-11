/**
 * ONE-TIME BACKFILL (2026-08-07) — writes Transportation Fee (col Y) for the newly requested
 * May 2026 EU settlement report (period 04/05/2026-08/05/2026), the only period reachable
 * beyond what was already covered, due to a ~3-4 month lookback limit discovered on the
 * All Statements search UI this session. Run once, then delete.
 */
function oneTimeMay2026Backfill() {
  var FEES = {"GCX-ES-260430-2099":16.14,"GCX-FR-260504-2101":7.46,"GCX-DE-260504-2122":5.78,"GCX-ES-260507-2163_1":9.57,"GCX-DE-260507-2159":5.96,"GCX-DE-260506-2145":6.76,"GCX-FR-260506-2153":9.02,"GCX-FR-260504-2109":7.81,"GCX-DE-260504-2119":5.84,"GCX-DE-260504-2118":5.84,"GCX-FR-260430-2093":7.81,"GCX-IT-260507-2166":8.74,"GCX-DE-260507-2165":5.84,"GCX-DE-260504-2100":5.78,"GCX-DE-260506-2136":5.72,"GCX-DE-260504-2116":5.96,"GCX-FR-260504-2104":7.36,"GCX-DE-260504-2105":5.96,"GCX-DE-260507-2164":5.72,"GCX-DE-260506-2144":5.96,"GCX-FR-260504-2108":7.46,"GCX-FR-260504-2123":7.81,"GCX-IT-260504-2129":7.38,"GCX-DE-260507-2158":5.66,"GCX-FR-260504-2134":7.56,"GCX-FR-260504-2127":7.46,"GCX-IT-260504-2117":8.97,"GCX-FR-260504-2103":7.81,"GCX-DE-260506-2148":5.78,"GCX-FR-260504-2107":7.56,"GCX-IT-260507-2160":8.98,"GCX-DE-260504-2131":5.78,"GCX-IT-260506-2140":8.98,"GCX-DE-260504-2111":5.96,"GCX-IT-260504-2133":8.46,"GCX-ES-260506-2154":8.27};

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

  Logger.log('oneTimeMay2026Backfill done — written: %s, already filled (skipped): %s, not in map: %s',
    written, skippedAlreadyFilled, notInMap);
}

/********************************
 * K_시트 daily archive
 *
 * K_시트 is overwritten every run, so past days are lost. This step appends
 * today's K_시트 table to a 'K_시트_history' sheet keyed by date, giving the
 * Chat-app date picker something to read.
 *
 * Sheet columns:
 *   A dateKey (yyyy-MM-dd, KST)   -- dropdown value / lookup key
 *   B Update 날짜 (MM/dd (요일))   -- display label
 *   C seq  D country  E brand  F category  G qty  H owner  I device  J reason
 *   (C..J mirror K_시트 B..I)
 ********************************/
const KSHEET_HISTORY_NAME = 'K_시트_history';
const KSHEET_HISTORY_HEADERS =
  ['dateKey', 'Update 날짜', 'seq', 'country', 'brand', 'category', 'qty', 'owner', 'device', 'reason'];

function getKSheetHistorySheet_(ss) {
  let hist = ss.getSheetByName(KSHEET_HISTORY_NAME);
  if (!hist) {
    hist = ss.insertSheet(KSHEET_HISTORY_NAME);
    hist.getRange(1, 1, 1, KSHEET_HISTORY_HEADERS.length).setValues([KSHEET_HISTORY_HEADERS]);
    hist.setFrozenRows(1);
  }
  return hist;
}

function archiveKSheetHistory() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const src = ss.getSheetByName('K_시트');
  if (!src) { Logger.log('archiveKSheetHistory: K_시트 not found'); return; }

  const hist = getKSheetHistorySheet_(ss);

  const dateKey = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const dateLabel = getKoreanFormattedDate(); // "MM/dd (요일)" - same helper as All_Graph

  // Idempotent: drop any rows already stored for today before re-appending
  const existing = hist.getDataRange().getValues();
  for (let r = existing.length; r >= 2; r--) {
    if (String(existing[r - 1][0]) === dateKey) hist.deleteRow(r);
  }

  // K_시트 B5:I to the last non-empty row (B seq .. I reason)
  const lastRow = Math.max(src.getLastRow(), 5);
  const rows = src.getRange(5, 2, lastRow - 4, 8).getValues()
    .filter(row => row.some(v => v !== '' && v !== null));

  if (!rows.length) {
    Logger.log('archiveKSheetHistory: no K_시트 rows to archive for ' + dateKey);
    return;
  }

  const out = rows.map(row => [dateKey, dateLabel].concat(row));
  hist.getRange(hist.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  Logger.log('archiveKSheetHistory: wrote ' + out.length + ' rows for ' + dateKey);
}

/***** ===== CONFIG (SKU세일즈/리뷰 — Amazon.de Product Rating) ===== *****/

/* ===== SHEET ===== */
const SHEET_NAME = 'SKU세일즈/리뷰';
const ASIN_COL = 7;      // G — "Asin"
const RATING_COL = 9;    // I — Amazon.de rating, starts at row 7
const DATA_START_ROW = 7;

/* ===== APIFY TASK ===== */
// "product-details-scraper-ljh" task (axesso_data/amazon-product-details-scraper actor),
// pre-configured with amazon.de URLs matching this sheet's ASIN (G) column.
const TASK_ID = 'QWtvKi7oXZ6YYR92G';

/* ===== BEHAVIOR ===== */
const CONFIG = {
  pollIntervalMinutes: 1, // ScriptApp.everyMinutes() only accepts 1/5/10/15/30
  pollMaxMinutes: 180,
  timezone: 'Asia/Seoul',
  asinSyncWeekDay: 'SUNDAY', // ScriptApp.WeekDay name — must run before Monday's weekly kickoff
  asinSyncHour: 7
};

function getSpreadsheetId_() {
  return SpreadsheetApp.getActive().getId();
}

function _getToken() {
  const token = PropertiesService.getScriptProperties().getProperty('APIFY_TOKEN');
  if (!token) {
    throw new Error('APIFY_TOKEN is not set in Script Properties (Project Settings → Script Properties).');
  }
  return token;
}

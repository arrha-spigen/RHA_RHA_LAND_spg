/***** ===== CONFIG (iPhone 18 / iPhone Fold — Amazon.de Product Rating) ===== *****/

/* ===== SHEETS ===== */
// Both sheets share the same layout: A=SKU, B=ASIN, C=제품 페이지, D=Review, E=Rating.
const SHEETS = [
  { name: 'iPhone 18', asinCol: 2, ratingCol: 5, dataStartRow: 6 },
  { name: 'iPhone Fold', asinCol: 2, ratingCol: 5, dataStartRow: 6 }
];

/* ===== APIFY TASK ===== */
// "product-details-scraper-iphone18-fold" task (axesso_data/amazon-product-details-scraper
// actor — same actor as SKUSales_Rating_Apify), pre-loaded with amazon.de URLs for every
// ASIN across both sheets above.
const TASK_ID = 'CLQ3G6Sokyr7AJtQi';

/* ===== BEHAVIOR ===== */
const CONFIG = {
  pollIntervalMinutes: 1, // ScriptApp.everyMinutes() only accepts 1/5/10/15/30
  pollMaxMinutes: 180,
  timezone: 'Asia/Seoul',
  dailyHour: 8 // kickoff hour, skipped on Sat/Sun — see dailyWeekdayKickoff()
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

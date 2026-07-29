var SHEET_NAME = 'Leaderboard';
var TOP_N = 5;
var KEEP_N = 20; // prune sheet to this many rows to keep it small
var MAX_NICKNAME_LEN = 20;
var MIN_TIME_MS = 1000;
var MAX_TIME_MS = 3600000;
var VALID_COUNTRIES = ['de', 'gb', 'fr', 'it', 'es', 'in', 'jp'];

function _sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['Nickname', 'Country', 'TimeMs', 'Timestamp']);
  }
  return sh;
}

function _rows_() {
  var sh = _sheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues();
}

function _top5_() {
  var rows = _rows_().slice();
  rows.sort(function (a, b) { return a[2] - b[2]; }); // ascending TimeMs = best first
  return rows.slice(0, TOP_N).map(function (r) {
    return { nickname: String(r[0]), country: String(r[1]), timeMs: Number(r[2]) };
  });
}

function _json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return _json_({ leaderboard: _top5_() });
}

// Placeholder default entries (times are estimates, not real recorded solves) —
// run manually once to seed the leaderboard before any real submissions come in.
function seedLeaderboard() {
  var sh = _sheet();
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  var seed = [
    ['Spigel', 'de', 42000, new Date()],
    ['Bib Gourmant', 'fr', 51000, new Date()],
    ['ak47', 'fr', 58000, new Date()]
  ];
  sh.getRange(2, 1, seed.length, 4).setValues(seed);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return _json_({ error: 'invalid_payload' });
  }

  var nickname = String(body.nickname || '').trim().slice(0, MAX_NICKNAME_LEN);
  var country = String(body.country || '').trim().toLowerCase();
  var timeMs = Number(body.timeMs);

  if (!nickname) return _json_({ error: 'missing_nickname' });
  if (VALID_COUNTRIES.indexOf(country) === -1) return _json_({ error: 'invalid_country' });
  if (!isFinite(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
    return _json_({ error: 'invalid_time' });
  }

  var sh = _sheet();
  sh.appendRow([nickname, country, timeMs, new Date()]);

  // Prune to the best KEEP_N rows so a public write endpoint can't grow the sheet unbounded.
  var rows = _rows_().sort(function (a, b) { return a[2] - b[2]; }).slice(0, KEEP_N);
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  return _json_({ leaderboard: _top5_() });
}

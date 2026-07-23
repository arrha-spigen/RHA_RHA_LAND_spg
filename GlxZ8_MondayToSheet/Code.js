/*************************************************
 * CONFIG — Galaxy Z8 Case+CP (Monday → Sheet, append-new-only)
 *************************************************/
const BOARD_ID = 18421346787;
const SHEET_NAME = 'Sheet1';
const PAGE_LIMIT = 500;
const RUN_TRIGGER_HOUR = 17; // 5PM KST

/** Sheet header (in order) ↔ Monday column id. colId=null → Monday item name (title field). */
const COLUMN_MAP = [
  { header: 'Order ID',       colId: null },
  { header: 'Created 날짜',    colId: 'date_mm0f80th' },
  { header: 'Purchased 날짜',  colId: 'date_mm59ejfp' },
  { header: 'ASIN',           colId: 'text_mm0f1q4h' },
  { header: 'SKU',             colId: 'lookup_mm0fv615' },
  { header: '대분류',          colId: 'lookup_mm0ffq8f' },
  { header: '인입사유',        colId: 'formula_mm0g81mb' },
  { header: '국가',            colId: 'formula_mm25vbf0' },
  { header: '기종명',          colId: 'lookup_mm0f6j81' },
  { header: '모델명',          colId: 'lookup_mm0fn79' },
  { header: '색상명',          colId: 'lookup_mm0fg6ja' },
  { header: '클레임/리뷰',     colId: 'color_mm0f7bwq' },
  { header: '생산업체',        colId: 'lookup_mm0feh3b' },
  { header: '원산지',          colId: 'lookup_mm0fahcy' },
  { header: '고객 대응',       colId: 'color_mm0fjzar' },
  { header: 'Review Link',    colId: 'link_mm0fkspz' },
  { header: 'Zendesk Ticket', colId: 'integration_mm0fzmv0' },
  { header: '데이터 출처',     colId: 'text_mm5gms5r' }
];

const FORMULA_COL_IDS = COLUMN_MAP
  .filter(function(c){ return c.colId && c.colId.indexOf('formula_') === 0; })
  .map(function(c){ return c.colId; });

const HEADER = ['item_id'].concat(COLUMN_MAP.map(function(c){ return c.header; }));

/*************************************************
 * MENU (manual test run / one-time trigger setup)
 *************************************************/
function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('Monday.com')
    .addItem('지금 동기화 (신규 항목만)', 'appendNewMondayItems')
    .addItem('일일 자동 실행 설정 (최초 1회)', 'setupDailyTrigger')
    .addToUi();
}

/*************************************************
 * MAIN — append only items not already in the sheet
 *************************************************/
function appendNewMondayItems(){
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { Logger.log('Another sync is already running. Skipped.'); return; }
  try {
    const apiKey = _getMondayApiKey_();
    const sheet = _getSheet_();
    _ensureHeader_(sheet);

    const existingIds = _getExistingItemIds_(sheet);
    Logger.log('Existing item_id count: ' + existingIds.size);

    const colIds = COLUMN_MAP.filter(function(c){ return c.colId; }).map(function(c){ return c.colId; });
    const items = _fetchAllItems_(apiKey, colIds);
    Logger.log('Fetched from Monday: ' + items.length);

    const newItems = items.filter(function(it){ return !existingIds.has(String(it.id)); });
    Logger.log('New items to append: ' + newItems.length);
    if (!newItems.length) return;

    var formulaOverrides = {};
    if (FORMULA_COL_IDS.length){
      const missingIds = newItems
        .filter(function(it){ return _needsFormulaRetry_(it); })
        .map(function(it){ return it.id; });
      if (missingIds.length) formulaOverrides = _fetchColumnsForItems_(apiKey, missingIds, FORMULA_COL_IDS);
    }

    const rows = newItems.map(function(it){ return _buildRow_(it, formulaOverrides[it.id]); });
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, HEADER.length).setValues(rows);
    Logger.log('Appended ' + rows.length + ' new row(s).');
  } catch (e) {
    Logger.log('ERROR: ' + (e && e.message ? e.message : e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/*************************************************
 * DAILY TRIGGER SETUP (run once manually)
 *************************************************/
function setupDailyTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'appendNewMondayItems') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('appendNewMondayItems')
    .timeBased()
    .atHour(RUN_TRIGGER_HOUR)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();
  Logger.log('Daily trigger installed: ~' + RUN_TRIGGER_HOUR + ':00 Asia/Seoul');
}

/*************************************************
 * SHEET HELPERS
 *************************************************/
function _getSheet_(){
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SHEET_NAME) || ss.getActiveSheet();
}

function _ensureHeader_(sheet){
  const firstCell = sheet.getRange(1, 1).getValue();
  if (!firstCell) sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
}

function _getExistingItemIds_(sheet){
  const lastRow = sheet.getLastRow();
  const ids = new Set();
  if (lastRow < 2) return ids;
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  values.forEach(function(r){ if (r[0]) ids.add(String(r[0])); });
  return ids;
}

/*************************************************
 * MONDAY FETCH (paged, only requested columns)
 *************************************************/
function _cvFragments_(){
  return 'id type text value ' +
    '... on MirrorValue { display_value } ' +
    '... on StatusValue { label } ' +
    '... on LinkValue { url text } ' +
    '... on NumbersValue { number } ' +
    '... on DateValue { date } ' +
    '... on BoardRelationValue { linked_items { name } }';
}

function _fetchAllItems_(apiKey, colIds){
  const fr = _cvFragments_();
  const query =
    'query ($boardId: [ID!], $pageCursor: String, $colIds: [String!]) {' +
    '  boards(ids: $boardId) {' +
    '    items_page(limit: ' + PAGE_LIMIT + ', cursor: $pageCursor) {' +
    '      items { id name column_values(ids: $colIds) { ' + fr + ' } } cursor } } }';
  var cursor = null, all = [];
  do {
    const resp = _mondayFetch_(apiKey, query, { boardId: BOARD_ID, pageCursor: cursor, colIds: colIds });
    const page = resp.data && resp.data.boards && resp.data.boards[0] && resp.data.boards[0].items_page;
    const batch = (page && page.items) ? page.items : [];
    all = all.concat(batch);
    cursor = page && page.cursor;
    if (cursor) Utilities.sleep(120);
  } while (cursor);
  return all;
}

function _needsFormulaRetry_(item){
  const map = {};
  (item.column_values || []).forEach(function(cv){ map[cv.id] = cv; });
  return FORMULA_COL_IDS.some(function(cid){ return _isEmpty_(map[cid]); });
}

function _fetchColumnsForItems_(apiKey, itemIds, colIds){
  const fr = _cvFragments_();
  const byItem = {};
  const CHUNK = 50;
  for (var i = 0; i < itemIds.length; i += CHUNK) {
    const slice = itemIds.slice(i, i + CHUNK);
    const query =
      'query ($itemIds: [ID!], $colIds: [String!]) {' +
      '  items(ids: $itemIds) { id column_values(ids: $colIds) { ' + fr + ' } } }';
    const resp = _mondayFetch_(apiKey, query, { itemIds: slice, colIds: colIds });
    const its = (resp.data && resp.data.items) || [];
    its.forEach(function(it){
      const map = byItem[it.id] || (byItem[it.id] = {});
      (it.column_values || []).forEach(function(cv){ map[cv.id] = cv; });
    });
    Utilities.sleep(120);
  }
  return byItem;
}

/*************************************************
 * ROW BUILDING / VALUE DISPLAY
 *************************************************/
function _buildRow_(item, formulaOverrides){
  const cvMap = {};
  (item.column_values || []).forEach(function(cv){ cvMap[cv.id] = cv; });
  const cells = COLUMN_MAP.map(function(c){
    if (c.colId === null) return item.name; // Order ID
    var cv = cvMap[c.colId];
    if (FORMULA_COL_IDS.indexOf(c.colId) >= 0 && _isEmpty_(cv) && formulaOverrides && formulaOverrides[c.colId]) {
      cv = formulaOverrides[c.colId];
    }
    return _displayValue_(cv);
  });
  return [String(item.id)].concat(cells);
}

function _displayValue_(cv){
  if (!cv) return '';
  if (_has_(cv.display_value)) return _clean_(cv.display_value);
  if (_has_(cv.label)) return _clean_(cv.label);
  if (_has_(cv.url)) return _clean_(cv.url);
  if (_has_(cv.number)) return String(cv.number);
  if (_has_(cv.date)) return String(cv.date);
  if (Array.isArray(cv.linked_items) && cv.linked_items.length) {
    const names = cv.linked_items.map(function(li){ return li && li.name; }).filter(Boolean);
    if (names.length) return names.join(', ');
  }
  if (_has_(cv.text)) return _clean_(cv.text);
  if (_has_(cv.value)) {
    const parsed = _tryParse_(cv.value);
    if (parsed && typeof parsed === 'object') {
      if (parsed.api_ticket_url) return _cleanZendeskUrl_(String(parsed.api_ticket_url));
      if (_has_(parsed.display_value)) return _clean_(parsed.display_value);
      if (_has_(parsed.text)) return _clean_(parsed.text);
      if (_has_(parsed.label)) return _clean_(parsed.label);
      if (_has_(parsed.url)) return _clean_(parsed.url);
      if (parsed.date) return String(parsed.date);
      if (parsed.number != null) return String(parsed.number);
      return _clean_(JSON.stringify(parsed));
    }
    return _clean_(String(cv.value).replace(/^"(.*)"$/, '$1'));
  }
  return '';
}

function _isEmpty_(cv){
  if (!cv) return true;
  return !(_has_(cv.display_value) || _has_(cv.label) || _has_(cv.url) ||
    _has_(cv.number) || _has_(cv.date) || _has_(cv.text) || _has_(cv.value));
}

function _cleanZendeskUrl_(u){
  try {
    const id = (u.match(/\/tickets\/(\d+)/) || [])[1];
    const m = u.match(/^https?:\/\/([^\/]+)/);
    if (id && m) return 'https://' + m[1] + '/api/v2/tickets/' + id;
  } catch (e) {}
  return String(u || '').replace(/\.json$/i, '');
}

function _has_(v){ return v != null && String(v).trim() !== ''; }
function _clean_(s){ return String(s == null ? '' : s).trim(); }
function _tryParse_(s){ try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } }

/*************************************************
 * MONDAY API (GraphQL)
 *************************************************/
function _mondayFetch_(apiKey, query, variables){
  const resp = UrlFetchApp.fetch('https://api.monday.com/v2', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: apiKey },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Monday API HTTP ' + code + ': ' + resp.getContentText());
  const json = JSON.parse(resp.getContentText());
  if (json.errors && json.errors.length) throw new Error('Monday GraphQL error: ' + JSON.stringify(json.errors));
  return json;
}

function _getMondayApiKey_(){
  const key = PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY');
  if (!key) throw new Error('Missing Script Property MONDAY_API_KEY. Project Settings → Script Properties에서 추가하세요.');
  return key;
}

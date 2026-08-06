/*************************************************
 * MONDAY API KEY
 *************************************************/
function _requireMondayApiKey_() {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('MONDAY_API_KEY');

  if (!apiKey) {
    throw new Error('Missing MONDAY_API_KEY in Script Properties.');
  }
  return apiKey;
}

/*************************************************
 * CORE UPLOADER (SAFE – USING GRAPHQL VARIABLES)
 *************************************************/
function syncSheetToMonday_core() {

  const apiKey = _requireMondayApiKey_();

  const { columns, groups, firstGroupId } =
    fetchBoardColumnsAndFirstGroup(apiKey, BOARD_ID);

  const groupsMap = new Map(groups.map(g => [g.title, g.id]));

  // 'formula' columns are client-side auto-calculated on monday.com — the API
  // rejects any write to them with ColumnValueException ("client side auto
  // calculated column"), which was failing every single row in the batch.
  const writableCols = columns.filter(c =>
    !['mirror','subtasks','integration','board_relation','formula'].includes(c.type)
  );

  const titleToId = buildTitleToIdMap(writableCols, COLUMN_OVERRIDES_BY_TITLE);
  const statusMaps = buildStatusMaps(columns);

  const existingLinks =
    fetchExistingReviewLinks(apiKey, BOARD_ID, LINK_COLUMN_ID);

  const { headers, rows } =
    readSheetDisplayedValues(UPLOAD_SHEET_ID, UPLOAD_SHEET_NAME);

  const headerIndex = indexHeaders(headers);
  const modelHeader =
    MODEL_HEADER_CANDIDATES.find(h => h in headerIndex) || null;

  const toCreate = [];

  for (const r of rows) {

    const itemName =
      (r[headerIndex[ITEM_NAME_HEADER]] || '').toString().trim();

    const reviewLink =
      headerIndex['Review Link'] != null
        ? (r[headerIndex['Review Link']] || '').toString().trim()
        : '';

    if (!itemName || !reviewLink) continue;
    if (existingLinks.has(normalizeLink(reviewLink))) continue;

    const colVals = formatRowToMondayCols(
      headers, r, writableCols, titleToId
    );

    // Default status
    if (CLAIM_REVIEW_COLUMN_ID) {
      const idx = resolveStatusIndexByLabel(
        statusMaps,
        CLAIM_REVIEW_COLUMN_ID,
        DEFAULT_CLAIM_REVIEW_LABEL
      );
      if (idx != null) {
        colVals[CLAIM_REVIEW_COLUMN_ID] = { index: idx };
      }
    }

    const modelText =
      modelHeader ? (r[headerIndex[modelHeader]] || '') : '';

    const groupTitle = chooseGroupFromModel(modelText);
    const group_id =
      (groupTitle && groupsMap.get(groupTitle)) || firstGroupId;

    toCreate.push({
      item_name: itemName,
      column_values: colVals,
      group_id
    });
  }

  if (!toCreate.length) return { createdCount: 0 };

  createItemsBatch(apiKey, toCreate);

  return { createdCount: toCreate.length };
}

/*************************************************
 * CREATE ITEM USING GRAPHQL VARIABLES
 *************************************************/
function createItemWithVariables(apiKey, item) {

  const mutation = `
    mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues
      ) {
        id
      }
    }
  `;

  const payload = {
    query: mutation,
    variables: {
      boardId: String(BOARD_ID), // force string
      groupId: String(item.group_id),
      itemName: String(item.item_name),
      columnValues: JSON.stringify(item.column_values)
    }
  };

  const resp = UrlFetchApp.fetch(
    'https://api.monday.com/v2',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const json = JSON.parse(resp.getContentText());

  if (json.errors) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }

  return json;
}


/*************************************************
 * MONDAY HELPERS
 *************************************************/
function fetchBoardColumnsAndFirstGroup(apiKey, boardId) {

  const CACHE_KEY = 'BOARD_META_' + boardId;
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(CACHE_KEY);
  if (cached) {
    try {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL_MS) return data;
    } catch (e) {}
  }

  const query = `
    query {
      boards (ids: ${boardId}) {
        groups { id title }
        columns { id title type settings_str }
      }
    }
  `;

  const json = mondayCallRaw(apiKey, query);
  const b = json.data.boards[0];

  const result = {
    columns: b.columns || [],
    groups: b.groups || [],
    firstGroupId: (b.groups && b.groups[0]) ? b.groups[0].id : null
  };

  props.setProperty(CACHE_KEY, JSON.stringify({ data: result, ts: Date.now() }));
  return result;
}

function mondayCallRaw(apiKey, query) {

  const resp = UrlFetchApp.fetch(
    'https://api.monday.com/v2',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: apiKey },
      payload: JSON.stringify({ query })
    }
  );

  const json = JSON.parse(resp.getContentText());
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }

  return json;
}

function fetchExistingReviewLinks(apiKey, boardId, linkColId) {

  let cursor = null;
  const links = new Set();

  do {
    // Only fetch the one link column — ~30x less payload than fetching all columns
    const query = `
      query ($cursor: String) {
        boards(ids: ${boardId}) {
          items_page(limit: 500, cursor: $cursor) {
            cursor
            items {
              column_values(ids: ["${linkColId}"]) {
                id
                text
                value
              }
            }
          }
        }
      }
    `;

    const json = mondayCallRawWithRetry(apiKey, query, { cursor });
    const page = json.data.boards[0].items_page;

    page.items.forEach(it => {
      const cv = it.column_values[0];
      if (!cv) return;
      if (cv.value) {
        try {
          const parsed = JSON.parse(cv.value);
          if (parsed && parsed.url) { links.add(normalizeLink(parsed.url)); return; }
        } catch (e) {}
      }
      if (cv.text) links.add(normalizeLink(cv.text));
    });

    cursor = page.cursor;

  } while (cursor);

  Logger.log(`Fetched ${links.size} existing links`);

  return links;
}

/*************************************************
 * SHEET HELPERS
 *************************************************/
function readSheetDisplayedValues(id, name) {
  const sh = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sh) throw new Error('Sheet not found');

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { headers: [], rows: [] };

  return {
    headers: sh.getRange(1,1,1,lastCol).getDisplayValues()[0],
    rows: sh.getRange(2,1,lastRow-1,lastCol).getDisplayValues()
  };
}

function indexHeaders(headers) {
  const map = {};
  headers.forEach((h,i)=> map[h]=i);
  return map;
}

/*************************************************
 * FORMAT HELPERS
 *************************************************/
function resolveStatusIndexByLabel(statusMaps, columnId, label) {
  const m = statusMaps[columnId];
  if (!m) return null;
  return m.byLabel[(label || '').toLowerCase()] ?? null;
}

function buildTitleToIdMap(cols, overrides) {
  const map = new Map();
  cols.forEach(c => map.set(c.title, c.id));
  if (overrides) {
    Object.keys(overrides).forEach(k =>
      map.set(k, overrides[k])
    );
  }
  return map;
}

function buildStatusMaps(columns) {
  const out = {};
  columns.forEach(c => {
    if (c.type !== 'status') return;
    const cfg = c.settings_str ? JSON.parse(c.settings_str) : {};
    const labels = cfg.labels || {};
    const byLabel = {};
    Object.keys(labels).forEach(k => {
      byLabel[labels[k].toLowerCase()] = parseInt(k, 10);
    });
    out[c.id] = { byLabel };
  });
  return out;
}

function formatRowToMondayCols(headers, row, writableCols, titleToId) {

  const colTypeMap = {};
  writableCols.forEach(c => colTypeMap[c.id] = c.type);

  const out = {};

  headers.forEach((h, i) => {

    const colId = titleToId.get(h);
    if (!colId) return;

    const val = row[i];
    if (val === '' || val == null) return;

    const colType = colTypeMap[colId];

    if (colType === 'link') {
      out[colId] = {
        url: String(val),
        text: String(val)
      };
      return;
    }

    if (colType === 'status') {
      out[colId] = { label: String(val) };
      return;
    }

    if (colType === 'date') {

      const parsed = parseToDateObject(val);
      if (!parsed) return;

      const yyyy = parsed.getFullYear();
      const mm = String(parsed.getMonth() + 1).padStart(2, '0');
      const dd = String(parsed.getDate()).padStart(2, '0');

      out[colId] = {
        date: `${yyyy}-${mm}-${dd}`
      };

      return;
    }

    out[colId] = val;
  });

  return out;
}




/*************************************************
 * ===== SHEET META =====
 *************************************************/
function readSheetMeta(spreadsheetId, sheetName) {

  const sh = SpreadsheetApp
    .openById(spreadsheetId)
    .getSheetByName(sheetName);

  if (!sh) throw new Error(`Sheet not found: ${sheetName}`);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  const headers =
    lastRow > 0
      ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
      : [];

  return {
    headers,
    lastRow,
    firstDataRow: 2
  };
}

/*************************************************
 * ===== PAGED READER =====
 *************************************************/
function readSheetRowsByPage(
  spreadsheetId,
  sheetName,
  targetYmdDot,
  dateColIndex1Based,
  startRow,
  pageSize
) {

  const sh = SpreadsheetApp
    .openById(spreadsheetId)
    .getSheetByName(sheetName);

  if (!sh) throw new Error(`Sheet not found: ${sheetName}`);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  if (lastRow < 2) {
    return {
      headers: [],
      rows: [],
      nextStartRow: null,
      scanned: 0,
      matched: 0
    };
  }

  const headers =
    sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];

  const dataStartRow = 2;
  const safeStart = Math.max(startRow || dataStartRow, dataStartRow);
  const endRow = Math.min(safeStart + pageSize - 1, lastRow);

  const values =
    sh.getRange(
      safeStart,
      1,
      endRow - safeStart + 1,
      lastCol
    ).getDisplayValues();

  const targetDateObj = parseToDateObject(targetYmdDot);
  const filterByDate = !!targetDateObj; // false → upload all rows (no date filter)

  const rows = [];
  let scanned = 0;
  let matched = 0;

  values.forEach((row, i) => {
    scanned++;

    if (filterByDate) {
      const rawDate = row[dateColIndex1Based - 1];
      const cellDateObj = parseToDateObject(rawDate);

      if (!cellDateObj) return;

      if (
        cellDateObj.getFullYear() !== targetDateObj.getFullYear() ||
        cellDateObj.getMonth()    !== targetDateObj.getMonth()    ||
        cellDateObj.getDate()     !== targetDateObj.getDate()
      ) return;
    }

    matched++;
    rows.push({ sheetRow: safeStart + i, values: row });
  });

  const nextStartRow =
    endRow < lastRow ? endRow + 1 : null;

  return {
    headers,
    rows,
    nextStartRow,
    scanned,
    matched
  };
}

/*************************************************
 * ===== DATE PARSER =====
 *************************************************/
function parseToDateObject(input) {
  if (!input) return null;

  const cleaned = input
    .toString()
    .replace(/\s+/g, '')
    .replace(/\./g, '-');

  const d = new Date(cleaned);

  if (isNaN(d.getTime())) return null;

  return d;
}

/*************************************************
 * ===== NORMALIZE YYYY.MM.DD =====
 *************************************************/
function normalizeYmdDot(s) {
  let v = (s || '').toString().trim();
  if (!v) return '';

  v = v.replace(/[-/]/g, '.');

  const m = v.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);

  return m
    ? `${m[1]}.${m[2].padStart(2,'0')}.${m[3].padStart(2,'0')}`
    : '';
}

/*************************************************
 * ===== STRING NORMALIZERS =====
 *************************************************/
function normalizeStatusLabel(s) {
  return (s || '').toString().trim().toLowerCase();
}

function normalizeLink(s) {
  if (!s) return '';

  return s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\?.*$/, '')     // remove query params
    .replace(/\/$/, '')       // remove trailing slash
    .replace(/^http:/, 'https:'); // normalize protocol
}

/*************************************************
 * ===== GRAPHQL JSON WRAPPER =====
 *************************************************/
function jsonGraphQL(value) {
  return JSON.stringify(value);
}

/*************************************************
 * MONDAY CALL WITH RETRY (exponential backoff on 429/5xx)
 *************************************************/
function mondayCallRawWithRetry(apiKey, query, variables) {

  const payload = variables ? { query, variables } : { query };

  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    const resp = UrlFetchApp.fetch(
      'https://api.monday.com/v2',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );

    const code = resp.getResponseCode();

    if ((code === 429 || code >= 500) && attempt < RETRY_MAX) {
      Utilities.sleep(RETRY_BASE_MS * Math.pow(2, attempt));
      continue;
    }

    const json = JSON.parse(resp.getContentText());
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json;
  }
}

/*************************************************
 * BATCH ITEM CREATION — N items in ceil(N/20) API calls
 *************************************************/
function createItemsBatch(apiKey, items) {

  const BATCH_SIZE = 20;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const varDefs = batch.map((_, j) =>
      `$n${j}: String!, $g${j}: String!, $cv${j}: JSON!`
    ).join(', ');

    const aliases = batch.map((_, j) =>
      `item${j}: create_item(board_id: "${BOARD_ID}", group_id: $g${j}, item_name: $n${j}, column_values: $cv${j}) { id }`
    ).join('\n      ');

    const variables = {};
    batch.forEach((item, j) => {
      variables[`n${j}`] = item.item_name;
      variables[`g${j}`] = item.group_id;
      variables[`cv${j}`] = JSON.stringify(item.column_values);
    });

    mondayCallRawWithRetry(apiKey, `mutation Batch(${varDefs}) { ${aliases} }`, variables);

    if (i + BATCH_SIZE < items.length) Utilities.sleep(200);
  }
}

function chooseGroupFromModel(modelText) {

  const model = (modelText || '').toLowerCase();

  // Most-specific first — "Pro Fold" and "Pro XL" both contain "pro", and
  // "Pro Fold"/"Pro XL" must not fall through to the plain "Pro" group.
  if (model.includes('pro fold') || model.includes('profold')) return 'Pixel 11 Pro Fold';
  if (model.includes('pro xl') || model.includes('proxl')) return 'Pixel 11 Pro XL';
  if (model.includes('pro')) return 'Pixel 11 Pro';
  if (model.includes('pixel 11') || model.includes('pixel11')) return 'Pixel 11';

  return null;
}

function countAnyColoredCells(rangeA1, trigger) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const range = sheet.getRange(rangeA1);
  const bgColors = range.getBackgrounds();
  const values = range.getValues();

  let count = 0;
  let total = 0;

  for (let i = 0; i < bgColors.length; i++) {
    for (let j = 0; j < bgColors[i].length; j++) {
      if (values[i][j] !== "") {
        total++;
        if (bgColors[i][j] !== "#ffffff" && bgColors[i][j] !== "") {
          count++;
        }
      }
    }
  }

  return total === 0 ? 0 : count / total;
}
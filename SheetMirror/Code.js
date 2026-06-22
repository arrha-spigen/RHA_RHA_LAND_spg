const CONFIG = {
  sourceId:    '1sjcCj_P4DRD8rywkmYJhbsrzwFfgiJQuF9nIKwCiKlc',
  sourceSheet: '26년 전체문의',
  destId:      '1qxwUjuV3-_0HRS1Bsb3Fsua0n8N6r6GzNnqiv9wRU10',
  destSheet:   'RAW',
  chunkSize:   1000,        // rows per read-write cycle

  // Helper ARRAYFORMULA columns. These are NEVER overwritten by mirrored data,
  // and the canonical formula below is (re)applied to row 1 every run so it
  // always matches — even if the cell was edited or cleared. Backslashes are
  // doubled here for JS; the cell receives single backslashes.
  formulas: {
    6:  '={"Brand(상세) Clean";ARRAYFORMULA(REGEXREPLACE(E2:E, "Spigen\\((.*?)\\)", "$1"))}',
    14: '={"Product Name Clean";ARRAYFORMULA(REGEXREPLACE(REGEXREPLACE(IF(ISBLANK(K2:K), L2:L, K2:K), " \\(.*?\\)", ""), "_.*", ""))}'
  }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 Mirror')
    .addItem('Mirror now', 'mirrorSheet')
    .addToUi();
}

// Break columns 1..lastCol into contiguous runs, excluding the protected columns.
// e.g. lastCol=20, skip=[6,14]  →  [[1,5],[7,13],[15,20]]
function colSegments_(lastCol, skip) {
  const skipSet = new Set(skip);
  const segs = [];
  let start = null;
  for (let c = 1; c <= lastCol; c++) {
    if (skipSet.has(c)) {
      if (start !== null) { segs.push([start, c - 1]); start = null; }
    } else if (start === null) {
      start = c;
    }
  }
  if (start !== null) segs.push([start, lastCol]);
  return segs;
}

// (Re)apply the canonical helper formula to row 1 of each formula column.
function applyFormulas_(dst) {
  Object.keys(CONFIG.formulas).forEach(col => {
    dst.getRange(1, Number(col)).setFormula(CONFIG.formulas[col]);
  });
}

function mirrorSheet() {
  const src = SpreadsheetApp.openById(CONFIG.sourceId).getSheetByName(CONFIG.sourceSheet);
  const dst = SpreadsheetApp.openById(CONFIG.destId).getSheetByName(CONFIG.destSheet);

  if (!src) throw new Error('Source sheet not found: ' + CONFIG.sourceSheet);
  if (!dst) throw new Error('Dest sheet not found: ' + CONFIG.destSheet);

  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();

  const formulaCols = Object.keys(CONFIG.formulas).map(Number);

  // Segments cover the widest of source/dest so old trailing columns get cleared too.
  const widest   = Math.max(lastCol, dst.getLastColumn());
  const segments = colSegments_(widest, formulaCols);

  // Clear ONLY the non-formula columns (leaves F & N ARRAYFORMULAs untouched).
  const clearRows = dst.getMaxRows();
  segments.forEach(([s, e]) => dst.getRange(1, s, clearRows, e - s + 1).clearContent());

  if (lastRow === 0 || lastCol === 0) {
    applyFormulas_(dst);
    Logger.log('Source is empty — non-formula columns cleared, F & N formulas (re)applied.');
    return;
  }

  // Expand destination dimensions if needed
  if (dst.getMaxRows() < lastRow) {
    dst.insertRowsAfter(dst.getMaxRows(), lastRow - dst.getMaxRows());
  }
  if (dst.getMaxColumns() < lastCol) {
    dst.insertColumnsAfter(dst.getMaxColumns(), lastCol - dst.getMaxColumns());
  }

  // Read in chunks; write each chunk per segment so F & N are skipped.
  for (let row = 1; row <= lastRow; row += CONFIG.chunkSize) {
    const numRows = Math.min(CONFIG.chunkSize, lastRow - row + 1);
    const data = src.getRange(row, 1, numRows, lastCol).getValues();
    segments.forEach(([s, e]) => {
      if (s > lastCol) return;                       // segment is past source data
      const segEnd = Math.min(e, lastCol);
      const block  = data.map(r => r.slice(s - 1, segEnd));   // cols s..segEnd
      dst.getRange(row, s, numRows, segEnd - s + 1).setValues(block);
    });
    SpreadsheetApp.flush();
  }

  // (Re)apply formulas last, so they spill over the freshly mirrored E / K / L data.
  applyFormulas_(dst);
  SpreadsheetApp.flush();

  Logger.log('Mirror complete: ' + lastRow + ' rows × ' + lastCol +
             ' cols (F & N formulas re-applied) → ' + CONFIG.destSheet);
}

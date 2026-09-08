function appendZendeskDailyStatus() {
  const sheetId = '10VYnysCGztKWMXfvXIWBVcE2_zENnRxvXUr9nicHkpo';
  const date = getKoreanFormattedDate();

  const ss = SpreadsheetApp.openById(sheetId);
  const srcSheet = ss.getSheetByName('Zendesk_Daily');
  const destSheet = ss.getSheetByName('All_Graph');

  if (!srcSheet || !destSheet) {
    Logger.log("Either 'Zendesk_Daily' or 'All_Graph' sheet not found.");
    return;
  }

  // --- Same-day guard: never add a 2nd 'All_Graph' row for the same date -------
  // If the job is resumed / re-run, column A of the last row already holds
  // today's label. Overwrite that row instead of appending a duplicate; and if
  // 'Zendesk_Daily' has already been cleared by an earlier run, leave the row
  // untouched (don't overwrite good counts with zeros).
  const destLastRow = destSheet.getLastRow();
  const existingDate = destLastRow >= 1
    ? String(destSheet.getRange(destLastRow, 1).getValue() || '').trim()
    : '';
  const srcHasData = srcSheet.getLastRow() >= 2;

  if (existingDate === date && !srcHasData) {
    Logger.log(`↻ 'All_Graph' already has today's row (${date}) and 'Zendesk_Daily' is empty - skipping append.`);
    return;
  }

  const statusRows = Math.max(srcSheet.getLastRow(), 2);
  const statusCol = srcSheet.getRange('B2:B' + statusRows).getValues();

  let newCount = 0, openCount = 0, pendingCount = 0;

  statusCol.forEach(row => {
    const status = (row[0] || '').toString().toLowerCase();
    if (status === 'new') newCount++;
    else if (status === 'open') openCount++;
    else if (status === 'pending') pendingCount++;
  });

  const targetRow = (existingDate === date) ? destLastRow : destLastRow + 1;
  if (existingDate === date) {
    Logger.log(`↻ Overwriting today's existing 'All_Graph' row ${targetRow} (${date}) instead of appending.`);
  }
  destSheet.getRange(targetRow, 1, 1, 4).setValues([[date, newCount, openCount, pendingCount]]);

  srcSheet.clearContents(); // Clean after write
}

function getKoreanFormattedDate() {
  const timeZone = 'Asia/Seoul';
  const date = new Date();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const formattedDate = Utilities.formatDate(date, timeZone, 'MM/dd');
  const weekday = dayNames[date.getDay()];
  return `${formattedDate} (${weekday})`;
}

function collapseOldRowsIfNeeded() {
  // openById (not getActiveSpreadsheet) so this works from a time-based trigger too.
  const sheet = SpreadsheetApp.openById('10VYnysCGztKWMXfvXIWBVcE2_zENnRxvXUr9nicHkpo').getSheetByName('All_Graph');
  const startRow = 2;
  const lastRow = sheet.getLastRow();
  const visibleValues = [];

  for (let row = startRow; row <= lastRow; row++) {
    if (!sheet.isRowHiddenByUser(row)) {
      const value = sheet.getRange(row, 1).getValue(); // Col A
      if (value !== "") {
        visibleValues.push(row);
      }
    }
  }

  if (visibleValues.length >= 20) {
    const rowsToCollapse = visibleValues.slice(0, 5);
    rowsToCollapse.forEach(row => {
      sheet.hideRows(row);
    });
    Logger.log(`🔒 Collapsed rows: ${rowsToCollapse.join(', ')}`);
  } else {
    Logger.log(`✅ No need to collapse. Visible rows: ${visibleValues.length}`);
  }
}


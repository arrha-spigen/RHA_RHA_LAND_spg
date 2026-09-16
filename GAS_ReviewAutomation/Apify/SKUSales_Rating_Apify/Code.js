/**********************************************************
 * MENU
 **********************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Apify Rating')
    .addItem('Run Now (refresh ratings)', 'runApifyRatingRefreshNow')
    .addItem('Cancel Polling', 'cancelRatingPolling')
    .addSeparator()
    .addItem('Install Weekly Monday 8AM Trigger', 'setupWeeklyTrigger')
    .addItem('Remove Weekly Trigger', 'removeWeeklyTrigger')
    .addToUi();
}


/**********************************************************
 * ENTRY POINTS
 **********************************************************/

// Manual "Run Now" from the menu, and also the function the weekly
// time-based trigger calls every Monday 8AM KST.
function runApifyRatingRefreshNow() {
  const props = PropertiesService.getScriptProperties();
  const pendingRunId = props.getProperty('RATING_LAST_RUN_ID');

  if (pendingRunId) {
    Logger.log('A rating run is already pending (runId=%s). Ensuring poller is scheduled.', pendingRunId);
  } else {
    _startRatingRun_();
  }
  _scheduleRecurringRatingPoll_();
}

function cancelRatingPolling() {
  _deleteTriggersByHandler_('pollRatingRunAndWrite');
  _cleanupRatingState_();
}


/**********************************************************
 * START RUN
 **********************************************************/
function _startRatingRun_() {
  const ss = SpreadsheetApp.getActive();
  const token = _getToken();

  const url = `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(TASK_ID)}/runs?token=${encodeURIComponent(token)}`;
  Logger.log('Starting rating run (async): ' + url.replace(/token=[^&]+/, 'token=***'));

  const resp = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const body = resp.getContentText();

  if (code >= 400) {
    throw new Error(`Failed to start run: HTTP ${code}: ${body.slice(0, 1000)}`);
  }

  const data = JSON.parse(body).data;
  if (!data || !data.id) throw new Error('Start run response missing run id.');

  _rememberRatingRun_(data.id, data.defaultDatasetId || null);

  const msg = `Apify rating run started. runId=${data.id}`;
  Logger.log(msg);
  try { ss.toast(msg, 'Apify Rating', 5); } catch (e) { /* no UI context (trigger run) */ }
}


/**********************************************************
 * POLLER (invoked by recurring time-based trigger)
 **********************************************************/
function pollRatingRunAndWrite() {
  const ss = SpreadsheetApp.getActive();
  const token = _getToken();
  const props = PropertiesService.getScriptProperties();

  const runId = props.getProperty('RATING_LAST_RUN_ID');
  const datasetIdFromStart = props.getProperty('RATING_LAST_DATASET_ID');
  const startedAtMs = Number(props.getProperty('RATING_LAST_POLL_STARTED_AT_MS')) || Date.now();

  if (!runId) {
    _deleteTriggersByHandler_('pollRatingRunAndWrite');
    return;
  }

  const elapsedMin = (Date.now() - startedAtMs) / 60000;
  if (elapsedMin > CONFIG.pollMaxMinutes) {
    _cleanupRatingState_();
    _deleteTriggersByHandler_('pollRatingRunAndWrite');
    Logger.log('Rating polling timed out after %s min.', CONFIG.pollMaxMinutes);
    return;
  }

  const runUrl = `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`;
  const runResp = UrlFetchApp.fetch(runUrl, { method: 'get', muteHttpExceptions: true });
  if (runResp.getResponseCode() >= 400) return;

  const runData = JSON.parse(runResp.getContentText()).data;
  const status = runData.status;
  const datasetId = runData.defaultDatasetId || datasetIdFromStart;

  Logger.log('Rating run status=%s, datasetId=%s', status, datasetId);

  if (status === 'SUCCEEDED') {
    if (!datasetId) {
      _cleanupRatingState_();
      _deleteTriggersByHandler_('pollRatingRunAndWrite');
      return;
    }

    const items = _fetchRatingDatasetItems_(datasetId, token);
    const written = _writeRatingsToSheet_(items);

    Logger.log('Rating refresh done: %s dataset item(s), %s row(s) written.', items.length, written);
    try {
      ss.toast(`Rating refresh done: ${written} row(s) updated.`, 'Apify Rating', 8);
    } catch (e) { /* no UI context */ }

    _cleanupRatingState_();
    _deleteTriggersByHandler_('pollRatingRunAndWrite');
    return;
  }

  if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    _cleanupRatingState_();
    _deleteTriggersByHandler_('pollRatingRunAndWrite');
    Logger.log('Rating run ended with status=%s', status);
  }
}


/**********************************************************
 * DATASET FETCH
 **********************************************************/
function _fetchRatingDatasetItems_(datasetId, token) {
  const baseUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${token}`;
  let offset = 0;
  const limit = 1000;
  let allItems = [];

  while (true) {
    const url = `${baseUrl}&offset=${offset}&limit=${limit}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 400) {
      throw new Error('Dataset fetch failed: ' + resp.getContentText());
    }

    const items = JSON.parse(resp.getContentText());
    if (!items || items.length === 0) break;

    allItems = allItems.concat(items.map(i => ({
      asin: i.asin || '',
      productRating: _extractRatingValue_(i.productRating)
    })));

    offset += items.length;
    if (items.length < limit) break;
  }

  // Same ASIN can appear more than once (the task's URL list has duplicate
  // ASIN entries mirroring duplicate rows in the sheet) — last write wins.
  const byAsin = new Map();
  for (const item of allItems) {
    if (item.asin) byAsin.set(item.asin, item.productRating);
  }
  return byAsin;
}

// Rating text comes back locale-formatted (e.g. "4,5 von 5 Sternen" for amazon.de).
// Just take the leading number and normalize the decimal separator.
function _extractRatingValue_(raw) {
  if (!raw) return '';
  const s = String(raw).trim().replace(',', '.');
  const m = s.match(/^\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : '';
}


/**********************************************************
 * WRITE TO SHEET — match by ASIN (col G) → rating (col I),
 * hyperlinked to the product's amazon.de page. A row whose ASIN got no
 * (or empty) result in this run keeps whatever was already in its cell —
 * only a fresh non-empty scrape result overwrites a rating.
 **********************************************************/
function _writeRatingsToSheet_(ratingByAsin) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found.`);

  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return 0;

  const numRows = lastRow - DATA_START_ROW + 1;
  const asinValues = sheet.getRange(DATA_START_ROW, ASIN_COL, numRows, 1).getValues();

  const ratingRange = sheet.getRange(DATA_START_ROW, RATING_COL, numRows, 1);
  const existingFormulas = ratingRange.getFormulas();
  const existingValues = ratingRange.getValues();

  let updated = 0;
  const output = asinValues.map((row, i) => {
    const asin = String(row[0] || '').trim();
    if (asin && ratingByAsin.has(asin)) {
      const rating = ratingByAsin.get(asin);
      if (rating !== '') {
        updated++;
        return [`=HYPERLINK("https://www.amazon.de/dp/${asin}",${rating})`];
      }
    }
    return [existingFormulas[i][0] || existingValues[i][0]];
  });

  ratingRange.setFormulas(output);
  return updated;
}

// Manual recovery: reapply an already-scraped dataset without starting a new
// Apify run (e.g. after fixing the write logic). Run from the editor with the
// dataset ID from the Apify console or a prior execution log line.
function reprocessDataset(datasetId) {
  const token = _getToken();
  const ratingByAsin = _fetchRatingDatasetItems_(datasetId, token);
  const written = _writeRatingsToSheet_(ratingByAsin);
  Logger.log('Reprocessed dataset %s: %s row(s) updated.', datasetId, written);
}


/**********************************************************
 * WEEKLY TRIGGER (every Monday 8AM KST) — kicks off the run;
 * the run itself finishes asynchronously via pollRatingRunAndWrite.
 **********************************************************/
function setupWeeklyTrigger() {
  removeWeeklyTrigger();
  ScriptApp.newTrigger('runApifyRatingRefreshNow')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .nearMinute(0)
    .inTimezone(CONFIG.timezone)
    .create();
  Logger.log('Weekly trigger installed: every Monday ~08:00 %s', CONFIG.timezone);
}

function removeWeeklyTrigger() {
  _deleteTriggersByHandler_('runApifyRatingRefreshNow');
}


/**********************************************************
 * STATE / TRIGGER HELPERS
 **********************************************************/
function _rememberRatingRun_(runId, datasetId) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('RATING_LAST_RUN_ID', runId);
  if (datasetId) props.setProperty('RATING_LAST_DATASET_ID', datasetId);
  props.setProperty('RATING_LAST_POLL_STARTED_AT_MS', String(Date.now()));
}

function _cleanupRatingState_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('RATING_LAST_RUN_ID');
  props.deleteProperty('RATING_LAST_DATASET_ID');
  props.deleteProperty('RATING_LAST_POLL_STARTED_AT_MS');
}

function _scheduleRecurringRatingPoll_() {
  _deleteTriggersByHandler_('pollRatingRunAndWrite');
  const every = Math.max(1, Number(CONFIG.pollIntervalMinutes || 2));
  ScriptApp.newTrigger('pollRatingRunAndWrite')
    .timeBased()
    .everyMinutes(every)
    .create();
}

function _deleteTriggersByHandler_(handlerName) {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(t);
    }
  }
}

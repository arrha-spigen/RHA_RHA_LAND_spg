/**
 * Ticket Reporter — interactive Google Chat app.
 *
 * Flow: the ticket-reporter monitor (Chrome-automation session) writes a row into the
 * TicketQueue sheet for a new Pending + 4.Product Issue ticket, then sends a short
 * trigger message ("티켓 1000161577" or similar) into the target space using the
 * signed-in human's own Chrome session (NOT this app's identity — this app never needs
 * to post proactively, so it never needs the chat.bot scope / domain-wide delegation
 * that blocked ../BadReview_ChatReport/chat_app's sibling project).
 *
 * onMessage reads the ticket id out of that trigger text, looks up the queued row (or
 * falls back to an empty context if not queued), and replies with the interactive card:
 * one reference dropdown (all 43 canned phrases) + one freeform note textbox the user
 * actually types the internal note into. Picking a dropdown item just appends that phrase
 * as a new line onto whatever is already in the note box (see onRefChange) — the dropdown
 * never "is" the note, it's just a fast way to insert a line into it. Submitting posts the
 * note box's current text to Zendesk with comment.public = false — NEVER true. That is a
 * hard rule; see postInternalNote_.
 */

/* ===================== Chat envelope helpers (add-on mode) ===================== */

function chatCreate_(message) {
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: message } } } };
}
function chatUpdate_(message) {
  return { hostAppDataAction: { chatDataAction: { updateMessageAction: { message: message } } } };
}

/* ===================== Chat event handlers ===================== */

function onAddedToSpace(event) {
  return chatCreate_({
    text: 'Ticket Reporter 앱입니다. 모니터가 새 티켓을 큐에 넣으면 "티켓 <번호>"라고 보내 카드를 불러오세요.'
  });
}

function onRemovedFromSpace(event) {}

function onMessage(event) {
  var text = messageText_(event);
  var trimmed = String(text || '').trim();

  // `/revision <feedback>` — a note about how future ticket reports should be written
  // (사용자 지시 2026-09-16). Never touches Zendesk; just logged to the Feedback sheet tab
  // for the ticket-reporter session to pick up and apply as a permanent rule change. Checked
  // before the ticket-number regex below since pasted feedback often quotes a full report
  // (which contains ticket numbers of its own).
  if (/^\/revision\b/i.test(trimmed)) {
    return handleRevisionFeedback_(trimmed.replace(/^\/revision\s*/i, ''), event);
  }

  var m = trimmed.match(/(\d{6,})/);

  // Thread-reply direct-post path: a reply (no explicit ticket number in the text) inside
  // a thread the monitor already mapped to a ticket (see lookupTicketByThread_) is treated
  // as the internal-note content itself — no card round-trip needed. This is how a human
  // replies under an auto-sent static report and has it land on Zendesk directly.
  if (!m) {
    var threadName = threadName_(event);
    var mappedId = threadName ? lookupTicketByThread_(threadName) : null;
    if (mappedId) {
      return postThreadReplyAsNote_(mappedId, trimmed, event);
    }
    return chatCreate_({ text: '티켓 번호를 찾을 수 없습니다. 예: "티켓 1000161577"' });
  }
  // Short trigger ("티켓 1000161577") just opens the card. A longer pasted message
  // (a full TCK 전달 전 보고 리포트) is rendered above the same dropdowns/button
  // so confirmer can read the report and act on it in one card.
  var isShortTrigger = /^티켓\s*\d{6,}$/.test(trimmed);
  return chatCreate_({ cardsV2: [buildCard_(m[1], isShortTrigger ? null : trimmed, null)] });
}

function messageText_(event) {
  var msg = (event && event.message) ||
            (event && event.chat && event.chat.messagePayload && event.chat.messagePayload.message) || {};
  return msg.argumentText || msg.text || '';
}

function threadName_(event) {
  var msg = (event && event.message) ||
            (event && event.chat && event.chat.messagePayload && event.chat.messagePayload.message) || {};
  return (msg.thread && msg.thread.name) || '';
}

/** Classic-mode shim; add-on mode calls the named function in onClick.action.function directly. */
function onCardClick(event) {
  var fn = (event.common && event.common.invokedFunction) ||
           (event.action && event.action.actionMethodName) || '';
  if (fn === 'submitNote') return submitNote(event);
  if (fn === 'onRefChange') return onRefChange(event);
  return chatCreate_({ text: '알 수 없는 동작입니다.' });
}

/**
 * Fired by the reference dropdown's onChangeAction. Reads whatever is currently typed in
 * the note textbox plus the newly picked phrase, appends the phrase as a new line, and
 * rebuilds the card with that as the note box's new value. The dropdown itself is always
 * rebuilt with nothing selected (see buildCard_) so picking the SAME phrase again still
 * counts as a change and appends it again.
 */
function onRefChange(event) {
  var inputs = formInputs_(event);
  var params = actionParams_(event);
  var ticketId = params.ticketId;
  var reportText = params.reportText || null;

  var picked = {};
  var chosen = extractString_(inputs, 'ref');
  var currentNote = extractString_(inputs, 'noteText');
  picked.noteText = chosen ? (currentNote ? currentNote + '\n' + chosen : chosen) : currentNote;
  picked.confirmer = extractString_(inputs, 'confirmer');

  return chatUpdate_({ cardsV2: [buildCard_(ticketId, reportText, picked)] });
}

/* ===================== Card building ===================== */

/**
 * @param {string} ticketId
 * @param {?string} reportText  full pasted TCK report body, shown above the card body when present
 * @param {?Object} picked      { noteText, confirmer } to preserve across an onRefChange
 *                              rebuild; null on the first render (empty note, KJW default).
 */
function buildCard_(ticketId, reportText, picked) {
  picked = picked || {};
  var row = lookupQueueRow_(ticketId);
  var widgets = [];

  if (reportText) {
    widgets.push({ textParagraph: { text: reportHtml_(reportText) } });
  }

  if (row) {
    widgets.push({ decoratedText: {
      topLabel: 'Zendesk 티켓', text: '<b>#' + ticketId + '</b> — ' + escapeHtml_(row.subject || ''),
      bottomLabel: row.country ? (row.country + ' · ' + (row.category || '')) : '',
      onClick: { openLink: { url: zendeskTicketUrl_(ticketId) } }
    }});
  } else {
    widgets.push({ decoratedText: {
      topLabel: 'Zendesk 티켓', text: '<b>#' + ticketId + '</b> (큐에 없음 — 수동 입력)',
      onClick: { openLink: { url: zendeskTicketUrl_(ticketId) } }
    }});
  }

  var changeParams = [
    { key: 'ticketId', value: String(ticketId) },
    { key: 'reportText', value: reportText || '' }
  ];

  // Reference dropdown never keeps a selected item — every pick is rendered as a fresh
  // "change" so picking the same phrase twice in a row still fires onRefChange twice.
  var refItems = [{ text: '(문구 선택 시 아래 노트에 자동 추가)', value: '', selected: true }]
    .concat(REFERENCE_PHRASES.map(function (text) { return { text: text, value: text, selected: false }; }));
  widgets.push({ selectionInput: {
    name: 'ref', label: '①', type: 'DROPDOWN', items: refItems,
    onChangeAction: { function: 'onRefChange', parameters: changeParams }
  }});

  widgets.push({ textInput: {
    name: 'noteText', label: '내부 노트 내용 (직접 입력 가능 · 드롭다운 선택 시 자동 추가)',
    type: 'MULTIPLE_LINE', value: picked.noteText || ''
  } });

  var confirmerCurrent = picked.confirmer || CONFIRMERS[0];
  var confirmerItems = CONFIRMERS.map(function (c) {
    return { text: c, value: c, selected: c === confirmerCurrent };
  });
  widgets.push({ selectionInput: { name: 'confirmer', label: '[GCX ___ 컨펌]', type: 'DROPDOWN', items: confirmerItems } });

  widgets.push({ buttonList: { buttons: [
    { text: 'Zendesk 내부 노트로 전송', type: 'FILLED', onClick: { action: {
        function: 'submitNote',
        parameters: [
          { key: 'ticketId', value: String(ticketId) },
          { key: 'reportText', value: reportText || '' }
        ]
    } } }
  ]}});

  return {
    cardId: 'ticket-reporter-' + ticketId,
    card: {
      header: { title: '티켓 #' + ticketId + ' — 처리 요청 사항', subtitle: '노트 작성 후 전송 · 항상 내부 노트로만 등록됩니다' },
      sections: [{ widgets: widgets }]
    }
  };
}

/* ===================== Submit → compose note → post to Zendesk (internal only) ===================== */

function submitNote(event) {
  var inputs = formInputs_(event);
  var params = actionParams_(event);
  var ticketId = params.ticketId;
  var reportText = params.reportText || null;
  if (!ticketId) return chatUpdate_({ text: '티켓 번호를 찾을 수 없습니다.' });

  var noteText = extractString_(inputs, 'noteText').trim();
  var confirmer = extractString_(inputs, 'confirmer') || CONFIRMERS[0];

  if (!noteText) {
    return chatUpdate_({
      cardsV2: [buildCard_(ticketId, reportText, { noteText: noteText, confirmer: confirmer })],
      text: '⚠️ 내부 노트 내용을 입력하거나 드롭다운에서 문구를 선택해 주세요.'
    });
  }

  var body = composeNote_(noteText, confirmer);
  var result = postInternalNote_(ticketId, body);

  if (!result.ok) {
    return chatUpdate_({ text: '❌ #' + ticketId + ' 내부 노트 전송 실패 (' + result.status + '): ' + result.error });
  }

  logSubmission_(ticketId, body, confirmer);

  return chatUpdate_({
    cardsV2: [{
      cardId: 'ticket-reporter-done-' + ticketId,
      card: {
        header: { title: '✅ #' + ticketId + ' 내부 노트 전송 완료', subtitle: '[GCX ' + confirmer + ' 컨펌]' },
        sections: [{ widgets: [
          { textParagraph: { text: escapeHtml_(body).replace(/\n/g, '<br>') } },
          { buttonList: { buttons: [{ text: '티켓 열기', onClick: { openLink: { url: zendeskTicketUrl_(ticketId) } } }] } }
        ]}]
      }
    }]
  });
}

/**
 * Thread-reply direct-post path (no interactive card): a human replied in the thread under
 * an auto-sent static report, mentioning this app, with the actual note text and no ticket
 * number (see onMessage). Post it straight to Zendesk as the internal note AND reopen the
 * ticket to Open (사용자 지시 2026-09-16 — this path represents a confirmer's finished
 * decision, so the ticket should move out of Pending/On-hold back into the active queue).
 * Confirmer code is resolved from the sender's email (confirmerForUser_) — the message
 * text is the note only, not a form, so there's no confirmer dropdown to read from here.
 */
function postThreadReplyAsNote_(ticketId, noteText, event) {
  if (!noteText) {
    return chatCreate_({ text: '⚠️ 노트 내용이 비어 있습니다.' });
  }
  var confirmer = confirmerForUser_(event);
  var body = composeNote_(noteText, confirmer);
  var result = postInternalNoteAndReopen_(ticketId, body);

  if (!result.ok) {
    return chatCreate_({ text: '❌ #' + ticketId + ' 내부 노트 전송 실패 (' + result.status + '): ' + result.error });
  }

  logSubmission_(ticketId, body, confirmer);

  return chatCreate_({
    cardsV2: [{
      cardId: 'ticket-reporter-thread-done-' + ticketId + '-' + new Date().getTime(),
      card: {
        header: { title: '내부 노트 전송 완료', subtitle: '[GCX ' + confirmer + ' 컨펌]' },
        sections: [{ widgets: [
          { textParagraph: { text: escapeHtml_(body).replace(/\n/g, '<br>') } },
          { buttonList: { buttons: [{ text: '티켓 열기', onClick: { openLink: { url: zendeskTicketUrl_(ticketId) } } }] } }
        ]}]
      }
    }]
  });
}

/** "처리 요청 사항" \n\n <노트 내용> \n\n "[GCX <confirmer> 컨펌]" — exact user-specified format. */
function composeNote_(noteText, confirmer) {
  return [
    '처리 요청 사항',
    '',
    noteText,
    '',
    '[GCX ' + confirmer + ' 컨펌]'
  ].join('\n');
}

/**
 * Posts `body` as a Zendesk INTERNAL note (comment.public = false). HARD RULE: never
 * flip this to true — internal notes only, this is never sent to the customer directly.
 */
function postInternalNote_(ticketId, body) {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('ZENDESK_EMAIL');
  var token = props.getProperty('ZENDESK_API_TOKEN');
  if (!email || !token) return { ok: false, status: 0, error: 'ZENDESK_EMAIL/ZENDESK_API_TOKEN not set in Script Properties' };

  var url = 'https://' + ZENDESK_SUBDOMAIN + '.zendesk.com/api/v2/tickets/' + encodeURIComponent(ticketId) + '.json';
  var auth = Utilities.base64Encode(email + '/token:' + token);
  var payload = { ticket: { comment: { body: body, public: false } } };

  var resp = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Basic ' + auth },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) return { ok: true, status: code };
  return { ok: false, status: code, error: resp.getContentText().slice(0, 300) };
}

function zendeskTicketUrl_(ticketId) {
  return 'https://' + ZENDESK_SUBDOMAIN + '.zendesk.com/agent/tickets/' + ticketId;
}

/**
 * Same as postInternalNote_ but also reopens the ticket to `open` in the same PUT call —
 * used only by the thread-reply direct-post path (postThreadReplyAsNote_), where the
 * confirmer's reply is a finished decision that should move the ticket out of
 * Pending/On-hold. postInternalNote_ (interactive-card submit) never changes status.
 */
function postInternalNoteAndReopen_(ticketId, body) {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('ZENDESK_EMAIL');
  var token = props.getProperty('ZENDESK_API_TOKEN');
  if (!email || !token) return { ok: false, status: 0, error: 'ZENDESK_EMAIL/ZENDESK_API_TOKEN not set in Script Properties' };

  var url = 'https://' + ZENDESK_SUBDOMAIN + '.zendesk.com/api/v2/tickets/' + encodeURIComponent(ticketId) + '.json';
  var auth = Utilities.base64Encode(email + '/token:' + token);
  var payload = { ticket: { comment: { body: body, public: false }, status: 'open' } };

  var resp = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Basic ' + auth },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) return { ok: true, status: code };
  return { ok: false, status: code, error: resp.getContentText().slice(0, 300) };
}

/**
 * Resolves the confirmer code for the thread-reply direct-post path from the Chat event's
 * sender email (CONFIRMER_BY_EMAIL in Config.gs), falling back to CONFIRMERS[0] (KJW) for
 * anyone not explicitly mapped.
 */
function confirmerForUser_(event) {
  var email = (event && event.user && event.user.email) || '';
  return CONFIRMER_BY_EMAIL[email.toLowerCase()] || CONFIRMERS[0];
}

/* ===================== TicketQueue sheet (monitor → card hand-off) ===================== */

/** Plain name so it shows in the editor's Run-function dropdown (GAS hides `_`-suffixed names). */
function setupOnce() { setupOnce_(); }

/** Run once from the Apps Script editor to provision the queue sheet. */
function setupOnce_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(QUEUE_SHEET_PROP)) {
    Logger.log('Queue sheet already set: ' + props.getProperty(QUEUE_SHEET_PROP));
    return;
  }
  var ss = SpreadsheetApp.create('Ticket Reporter — Interactive Card Queue');
  var sheet = ss.getSheets()[0];
  sheet.setName(QUEUE_TAB);
  sheet.appendRow(['ticketId', 'subject', 'country', 'category', 'queuedAt', 'submittedAt', 'confirmer', 'threadId']);
  props.setProperty(QUEUE_SHEET_PROP, ss.getId());
  Logger.log('Created queue sheet: ' + ss.getUrl());
}

function lookupQueueRow_(ticketId) {
  var id = PropertiesService.getScriptProperties().getProperty(QUEUE_SHEET_PROP);
  if (!id) return null;
  var vals = SpreadsheetApp.openById(id).getSheetByName(QUEUE_TAB).getDataRange().getValues();
  var H = vals[0];
  var iId = H.indexOf('ticketId'), iSub = H.indexOf('subject'), iCty = H.indexOf('country'), iCat = H.indexOf('category');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]) === String(ticketId)) {
      return { subject: vals[r][iSub], country: vals[r][iCty], category: vals[r][iCat] };
    }
  }
  return null;
}

/**
 * Reverse lookup: which ticket does this Chat thread belong to? Populated by send.py right
 * after it posts a static report webhook message — it writes {ticketId, threadId} into the
 * same queue sheet. Lets onMessage resolve a plain thread reply (no ticket number in the
 * text) back to a ticket without needing Chat API read access (chat.bot is not
 * user-consentable in Apps Script's OAuth flow, so the app can't call spaces.messages.list
 * to read the thread's own history — this sheet-based mapping avoids needing that).
 */
function lookupTicketByThread_(threadName) {
  var id = PropertiesService.getScriptProperties().getProperty(QUEUE_SHEET_PROP);
  if (!id || !threadName) return null;
  var vals = SpreadsheetApp.openById(id).getSheetByName(QUEUE_TAB).getDataRange().getValues();
  var H = vals[0];
  var iId = H.indexOf('ticketId'), iThread = H.indexOf('threadId');
  if (iThread === -1) return null;
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iThread]) === String(threadName)) return String(vals[r][iId]);
  }
  return null;
}

/**
 * `/revision <feedback>` handler (사용자 지시 2026-09-16). This is a feedback channel, not a
 * Zendesk action: it never touches a ticket. The feedback text (often a full pasted report
 * plus a note about what should have been different) is appended to the Feedback sheet tab
 * with `appliedAt` left blank. The ticket-reporter Claude session checks that tab at the
 * start of every monitor tick, reads any unapplied rows, updates SKILL.md's writing rules
 * accordingly, then stamps `appliedAt` so the same feedback isn't re-applied.
 */
function handleRevisionFeedback_(feedbackText, event) {
  feedbackText = String(feedbackText || '').trim();
  if (!feedbackText) {
    return chatCreate_({ text: '⚠️ /revision 뒤에 피드백 내용을 입력해 주세요.' });
  }
  var email = (event && event.user && event.user.email) || '';
  logRevisionFeedback_(feedbackText, email);
  return chatCreate_({
    cardsV2: [{
      cardId: 'ticket-reporter-revision-' + new Date().getTime(),
      card: {
        header: { title: '피드백 접수 완료' },
        sections: [{ widgets: [
          { textParagraph: { text: '다음 리포트부터 반영됩니다.<br><br>' + escapeHtml_(feedbackText).replace(/\n/g, '<br>') } }
        ]}]
      }
    }]
  });
}

function logRevisionFeedback_(feedbackText, email) {
  var id = PropertiesService.getScriptProperties().getProperty(QUEUE_SHEET_PROP);
  if (!id) return;
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(FEEDBACK_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(FEEDBACK_TAB);
    sheet.appendRow(['ts', 'submitterEmail', 'feedbackText', 'appliedAt']);
  }
  sheet.appendRow([new Date(), email, feedbackText, '']);
}

function logSubmission_(ticketId, body, confirmer) {
  var id = PropertiesService.getScriptProperties().getProperty(QUEUE_SHEET_PROP);
  if (!id) return;
  var sheet = SpreadsheetApp.openById(id).getSheetByName(QUEUE_TAB);
  var vals = sheet.getDataRange().getValues();
  var H = vals[0];
  var iId = H.indexOf('ticketId'), iSubAt = H.indexOf('submittedAt'), iConf = H.indexOf('confirmer');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]) === String(ticketId)) {
      sheet.getRange(r + 1, iSubAt + 1).setValue(new Date());
      sheet.getRange(r + 1, iConf + 1).setValue(confirmer);
      return;
    }
  }
}

/* ===================== Form input parsing (same shape as BadReview_ChatReport/chat_app) ===================== */

function formInputs_(event) {
  return (event.common && event.common.formInputs) ||
         (event.commonEventObject && event.commonEventObject.formInputs) ||
         event.formInputs || {};
}

function inputField_(inputs, name) {
  var v = inputs && inputs[name];
  if (!v) return null;
  return v[''] || v;
}

function extractString_(inputs, name) {
  var f = inputField_(inputs, name);
  if (!f) return '';
  var si = f.stringInputs;
  if (si && si.value && si.value.length) return String(si.value[0]);
  return '';
}

function actionParams_(event) {
  var list = (event.common && event.common.parameters) ||
             (event.commonEventObject && event.commonEventObject.parameters) ||
             (event.action && event.action.parameters) || {};
  if (Array.isArray(list)) {
    var o = {};
    list.forEach(function (p) { o[p.key] = p.value; });
    return o;
  }
  return list;
}

function escapeHtml_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders a pasted report body as card text: escape, then turn newlines into <br>. */
function reportHtml_(s) {
  return escapeHtml_(s).replace(/\n/g, '<br>');
}

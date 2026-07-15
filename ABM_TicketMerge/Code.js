/********************************
 * ABM Ticket Merge
 * ------------------------------
 * Amazon sends an unthreaded "You have received a message" notification
 * email for every single ABM message, so Zendesk's mail channel creates a
 * brand new ticket per message instead of appending to the buyer's existing
 * open ticket (unlike Seller Central's own inbox, which threads by caseId).
 *
 * A Zendesk Trigger (condition: ticket created AND tags contain
 * "buyer_message_amazon") calls this Web App via a Notify-target webhook,
 * passing the new ticket's ID. If the same buyer already has a prior
 * buyer_message_amazon ticket, this script:
 *   1. Posts the new ticket's message as a public comment on that prior
 *      ("primary") ticket (authored as the requester, so it reads like the
 *      customer's own follow-up — matching how Seller Central threads it),
 *      REOPENING the primary if it had already been solved.
 *   2. Closes the new (duplicate) ticket with an internal note pointing to
 *      the ticket it was merged into.
 * If no reusable prior ticket exists, the new ticket is left untouched — it
 * becomes the thread's primary ticket for any future follow-ups.
 *
 * Primary selection (v2 — reopen & merge, case-ID aware):
 *   - Candidates = same-requester, buyer_message_amazon-tagged tickets that
 *     are NOT closed (Zendesk 'closed' is terminal — can't be reopened or
 *     commented on), newest first.
 *   - Amazon's buyer proxy address embeds the Seller Central case ID
 *     (e.g. "...+76c079d3-...@marketplace.amazon.co.jp"). When the NEW ticket
 *     has one, prefer the newest candidate with the SAME case ID — that's the
 *     exact key Seller Central threads by, and it avoids wrongly merging two
 *     genuinely different open cases from the same buyer. Candidates whose
 *     address has no resolvable case ID (older tickets, empty from-address)
 *     are eligible as a soft fallback; a candidate with a DIFFERENT explicit
 *     case ID is never chosen.
 *   - Earlier behavior only matched still-OPEN tickets and never reopened,
 *     so once an agent solved a ticket, the buyer's next message spawned a
 *     fresh unmerged ticket. That was the root cause of the "New tickets keep
 *     getting created" reports (e.g. JP chain #1000153447→603→740, all solved
 *     between messages).
 ********************************/

const ZENDESK_EMAIL = 'kjw@spigen.com';
const ZENDESK_TOKEN = 'QhM2AiBYwTZTSb04Qjor918PHtttxp8xAzCFfFsg';
const ZENDESK_SUBDOMAIN = 'spigenhelp';
const ABM_TAG = 'buyer_message_amazon';

// Shared secret the Zendesk webhook target must send back (see setupInstructions_ below).
// Checked against the `?secret=` query param on the webhook URL.
const WEBHOOK_SECRET = 'xN61CnX8OWX1O3lquwj-JFi6YTmFeezTaVhHsWZXvi8';

function zdAuthHeader_() {
  return 'Basic ' + Utilities.base64Encode(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`);
}

function zdFetch_(path, options) {
  const url = path.startsWith('http') ? path : `https://${ZENDESK_SUBDOMAIN}.zendesk.com${path}`;
  const opts = Object.assign({
    headers: { Authorization: zdAuthHeader_() },
    contentType: 'application/json',
    muteHttpExceptions: true
  }, options || {});
  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 300) {
    throw new Error(`Zendesk API ${opts.method || 'GET'} ${url} -> ${code}: ${body}`);
  }
  return body ? JSON.parse(body) : {};
}

function getTicket_(ticketId) {
  return zdFetch_(`/api/v2/tickets/${ticketId}.json`).ticket;
}

function getUser_(userId) {
  return zdFetch_(`/api/v2/users/${userId}.json`).user;
}

// First public comment on a ticket (the actual Amazon notification body).
function getFirstComment_(ticketId) {
  const data = zdFetch_(`/api/v2/tickets/${ticketId}/comments.json?sort_order=asc`);
  const comments = data.comments || [];
  return comments.length ? comments[0] : null;
}

// Re-hosts a source comment's attachments onto Zendesk so they can be attached
// to the primary ticket's comment. A Zendesk comment can't reference another
// ticket's attachment tokens directly — each file must be downloaded and
// re-uploaded to get a fresh upload token. Returns an array of upload tokens
// (one per successfully transferred file) to pass as `comment.uploads`.
// Best-effort per file: a single download/upload failure is logged and skipped
// so the rest of the message (text + other attachments) still merges.
function transferAttachments_(attachments) {
  const tokens = [];
  (attachments || []).forEach(att => {
    try {
      // content_url carries its own access token, but send the API Basic auth
      // too so private/agent-only attachments download reliably.
      const dl = UrlFetchApp.fetch(att.content_url, {
        headers: { Authorization: zdAuthHeader_() },
        muteHttpExceptions: true
      });
      if (dl.getResponseCode() >= 300) {
        Logger.log(`transferAttachments_: download failed for ${att.file_name} (${dl.getResponseCode()})`);
        return;
      }
      const blob = dl.getBlob().setName(att.file_name);
      const up = UrlFetchApp.fetch(
        `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/uploads.json?filename=${encodeURIComponent(att.file_name)}`,
        {
          method: 'post',
          contentType: att.content_type || 'application/octet-stream',
          payload: blob.getBytes(),
          headers: { Authorization: zdAuthHeader_() },
          muteHttpExceptions: true
        }
      );
      if (up.getResponseCode() >= 300) {
        Logger.log(`transferAttachments_: upload failed for ${att.file_name} (${up.getResponseCode()}): ${up.getContentText()}`);
        return;
      }
      const token = JSON.parse(up.getContentText())?.upload?.token;
      if (token) tokens.push(token);
    } catch (err) {
      Logger.log(`transferAttachments_: error on ${att && att.file_name} — ${err}`);
    }
  });
  return tokens;
}

// Seller Central case ID embedded in the Amazon buyer proxy from-address,
// e.g. "s0574jllj4n84kf+76c079d3-2f98-4aec-bc42-16aab22433ee@marketplace.amazon.co.jp".
// null when the address has no such segment (older tickets, empty address).
function caseIdFromTicket_(ticket) {
  const addr = (ticket && ticket.via && ticket.via.source && ticket.via.source.from
    && ticket.via.source.from.address) || '';
  const m = addr.match(/\+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@marketplace\./i);
  return m ? m[1] : null;
}

// Picks the prior ticket to thread the new message into — see the file header
// for the full selection rationale. Returns the ticket object or null.
function findPrimaryTicket_(requesterEmail, newTicket) {
  // status<closed keeps new/open/pending/solved (all reusable) and drops only
  // terminal 'closed' tickets, which Zendesk won't let us reopen or comment on.
  const query = encodeURIComponent(
    `type:ticket tags:${ABM_TAG} requester:${requesterEmail} status<closed`
  );
  const data = zdFetch_(`/api/v2/search.json?query=${query}&sort_by=created_at&sort_order=desc`);
  const candidates = (data.results || []).filter(t => t.id !== newTicket.id);
  if (!candidates.length) return null;

  const newCaseId = caseIdFromTicket_(newTicket);
  if (newCaseId) {
    const sameCase = candidates.find(t => caseIdFromTicket_(t) === newCaseId);
    if (sameCase) return sameCase;
    // No same-case candidate. Only fall back to candidates with NO resolvable
    // case ID (could plausibly be the same conversation); never merge into a
    // candidate that carries a DIFFERENT explicit case ID.
    const unknownCase = candidates.find(t => caseIdFromTicket_(t) === null);
    return unknownCase || null;
  }
  // New ticket has no case ID → fall back to plain newest same-buyer candidate.
  return candidates[0];
}

function mergeNewTicketIntoPrimary_(newTicket, primaryTicket) {
  const requester = getUser_(newTicket.requester_id);
  const firstComment = getFirstComment_(newTicket.id);
  const htmlBody = (firstComment && firstComment.html_body) || newTicket.description || '';

  // Carry the customer's attachments (photos/video/PDFs) across too — the
  // message body alone isn't enough (reported: 4 photos on #1000153766 didn't
  // reach #1000153709). Re-host them and pass the resulting upload tokens on
  // the primary's comment.
  const uploadTokens = transferAttachments_(firstComment && firstComment.attachments);

  // 1. Add the new message as a public comment on the primary ticket,
  //    authored as the requester so it reads as the customer's follow-up.
  //    Reopen the primary (→ 'open') if it had already been solved, so the
  //    thread comes back to the agents' queue instead of a new ticket.
  const primaryComment = { html_body: htmlBody, public: true, author_id: requester.id };
  if (uploadTokens.length) primaryComment.uploads = uploadTokens;
  const primaryPayload = { comment: primaryComment };
  const wasReopened = primaryTicket.status === 'solved';
  if (wasReopened) primaryPayload.status = 'open';

  zdFetch_(`/api/v2/tickets/${primaryTicket.id}.json`, {
    method: 'put',
    payload: JSON.stringify({ ticket: primaryPayload })
  });

  // 2. Close the duplicate with an internal note pointing to the primary.
  zdFetch_(`/api/v2/tickets/${newTicket.id}.json`, {
    method: 'put',
    payload: JSON.stringify({
      ticket: {
        status: 'closed',
        comment: {
          html_body: `Auto-merged: this buyer already has ABM ticket #${primaryTicket.id}${wasReopened ? ' (reopened)' : ''}. Message moved there — see that ticket for the customer's reply.`,
          public: false
        }
      }
    })
  });

  const srcAttachCount = (firstComment && firstComment.attachments || []).length;
  Logger.log(`Merged ticket #${newTicket.id} into #${primaryTicket.id}${wasReopened ? ' (reopened)' : ''} — attachments ${uploadTokens.length}/${srcAttachCount} transferred`);
  return { wasReopened, attachmentsTransferred: uploadTokens.length, attachmentsTotal: srcAttachCount };
}

function handleNewAbmTicket_(ticketId) {
  const ticket = getTicket_(ticketId);
  if (!ticket) return { status: 'not_found', ticketId };
  if ((ticket.tags || []).indexOf(ABM_TAG) === -1) {
    return { status: 'skipped_no_tag', ticketId };
  }
  // Idempotency guard: this ticket was already processed (closed) by a prior
  // invocation — e.g. a webhook retry. Re-running would re-post its message
  // as a duplicate comment on the primary ticket.
  if (ticket.status === 'closed') {
    return { status: 'already_processed', ticketId };
  }

  const requester = getUser_(ticket.requester_id);
  if (!requester || !requester.email) {
    return { status: 'skipped_no_requester_email', ticketId };
  }

  const primary = findPrimaryTicket_(requester.email, ticket);
  if (!primary) {
    return { status: 'left_as_primary', ticketId };
  }

  // Zendesk's SEARCH index lags behind live ticket state — a search result's
  // `status` can be stale (e.g. still shows 'new' seconds after a solve, or
  // 'open' after a close). The reopen decision and the can-we-write check both
  // depend on the TRUE current status, so re-fetch the chosen primary directly
  // before mutating it. If it's actually already closed (terminal — a PUT
  // would 422 "closed prevents ticket update"), don't merge into it; leave the
  // new ticket as its own primary instead.
  const freshPrimary = getTicket_(primary.id);
  if (!freshPrimary || freshPrimary.status === 'closed') {
    return { status: 'left_as_primary', ticketId, note: 'primary was closed on re-fetch' };
  }

  const merge = mergeNewTicketIntoPrimary_(ticket, freshPrimary);
  return {
    status: merge.wasReopened ? 'merged_reopened' : 'merged',
    ticketId,
    primaryTicketId: freshPrimary.id,
    attachmentsTransferred: merge.attachmentsTransferred,
    attachmentsTotal: merge.attachmentsTotal
  };
}

/********************************
 * Web App entry point (Zendesk Notify-target webhook)
 ********************************/
function doPost(e) {
  try {
    const params = e.parameter || {};
    if (params.secret !== WEBHOOK_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'forbidden' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const body = JSON.parse(e.postData.contents || '{}');
    const ticketId = body.ticket_id;
    if (!ticketId) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'missing ticket_id' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const result = handleNewAbmTicket_(ticketId);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log(err);
    return ContentService.createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/********************************
 * Manual test helper — run from the Apps Script editor
 * (bypasses the webhook/secret entirely; calls the same logic directly)
 ********************************/
function testMergeOnTicket(ticketId) {
  const result = handleNewAbmTicket_(ticketId);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

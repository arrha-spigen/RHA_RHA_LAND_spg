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
 * passing the new ticket's ID. If the same requester already has another
 * open/pending ticket tagged buyer_message_amazon, this script:
 *   1. Posts the new ticket's message as a public comment on that older
 *      ticket (authored as the requester, so it reads like the customer's
 *      own follow-up — matching how Seller Central threads it).
 *   2. Closes the new (duplicate) ticket with an internal note pointing to
 *      the ticket it was merged into.
 * If no such ticket exists, the new ticket is left untouched — it becomes
 * the thread's primary ticket for any future follow-ups.
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

// Finds the oldest OTHER open/pending ticket tagged buyer_message_amazon from
// the same requester — that's the thread's "primary" ticket to merge into.
function findPrimaryTicket_(requesterEmail, excludeTicketId) {
  const query = encodeURIComponent(
    `type:ticket tags:${ABM_TAG} requester:${requesterEmail} status<solved`
  );
  const data = zdFetch_(`/api/v2/search.json?query=${query}&sort_by=created_at&sort_order=asc`);
  const results = (data.results || []).filter(t => t.id !== excludeTicketId);
  return results.length ? results[0] : null;
}

function mergeNewTicketIntoPrimary_(newTicket, primaryTicket) {
  const requester = getUser_(newTicket.requester_id);
  const firstComment = getFirstComment_(newTicket.id);
  const htmlBody = (firstComment && firstComment.html_body) || newTicket.description || '';

  // 1. Add the new message as a public comment on the primary ticket,
  //    authored as the requester so it reads as the customer's follow-up.
  zdFetch_(`/api/v2/tickets/${primaryTicket.id}.json`, {
    method: 'put',
    payload: JSON.stringify({
      ticket: {
        comment: {
          html_body: htmlBody,
          public: true,
          author_id: requester.id
        }
      }
    })
  });

  // 2. Close the duplicate with an internal note pointing to the primary.
  zdFetch_(`/api/v2/tickets/${newTicket.id}.json`, {
    method: 'put',
    payload: JSON.stringify({
      ticket: {
        status: 'closed',
        comment: {
          html_body: `Auto-merged: this buyer already has an open ABM ticket #${primaryTicket.id}. Message moved there — see that ticket for the customer's reply.`,
          public: false
        }
      }
    })
  });

  Logger.log(`Merged ticket #${newTicket.id} into #${primaryTicket.id}`);
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

  const primary = findPrimaryTicket_(requester.email, ticket.id);
  if (!primary) {
    return { status: 'left_as_primary', ticketId };
  }

  mergeNewTicketIntoPrimary_(ticket, primary);
  return { status: 'merged', ticketId, primaryTicketId: primary.id };
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

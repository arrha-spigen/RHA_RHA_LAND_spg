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

/********************************
 * ABM inbound cleanup
 * ------------------------------
 * Amazon's "You have received a message" notification email buries the
 * buyer's own typed text inside a full marketing/legal HTML template (logo,
 * order table, "did this email help" survey buttons, footer copyright,
 * opt-out text, commMgrTok/SPC-xxAmazon tracking IDs) — the ticket comment
 * Zendesk creates from it looks nothing like a normal claim, even though
 * Zendesk's own inbound mail parsing already attaches the buyer's real
 * photos/PDFs correctly (verified live on ticket #1000154136 — no fix
 * needed there).
 *
 * Investigated live 2026-07-21 by diffing the raw html_body of several real
 * ABM tickets across JP/EN/DE: every sample wraps the buyer's own text in
 * exactly one <pre> block with an IDENTICAL inline style across every
 * marketplace/language sampled — only the surrounding template strings are
 * translated, this wrapper is not. That makes it a reliable, locale-agnostic
 * extraction anchor, so no Seller Central lookup (and therefore no live
 * agent browser session) is needed at all — this runs entirely server-side.
 *
 * Zendesk's "Ticket Comments" API has no way to replace a comment's visible
 * content with new text, so this posts a SEPARATE clean public comment
 * authored as the requester (same technique already proven in
 * mergeNewTicketIntoPrimary_) with the buyer's real attachments re-hosted
 * onto it. The original raw comment is left fully intact — zero data loss,
 * fully auditable, nothing destructive.
 *
 * (Briefly tried also redacting the raw original's text, GAS v14-v18,
 * 2026-07-22 — reverted the same day after discovering Zendesk's own native
 * "merge tickets" feature quotes a merged ticket's last comment by its
 * CURRENT stored text, so an agent manually merging a duplicate ABM ticket
 * whose raw comment had already been redacted produced a merge-quote system
 * note full of garbled block characters instead of the real message.
 * Redaction is permanent/global — it doesn't just affect this feature's own
 * view of the comment. Not worth that risk; see the removed
 * redactCommentText_ function's final comment and [[abm_ticket_merge]]
 * memory for the full incident writeup.)
 ********************************/

// Same inline style Amazon's template applies to the buyer's own message
// text, confirmed identical (byte-for-byte on this substring) across every
// JP/EN/DE sample checked — a couple of samples drop the single leading
// space before "color: black" (seemingly whenever the message body is just
// a bare URL), hence \s* rather than a literal space.
const ABM_RAW_PRE_RE = /<pre[^>]*white-space:\s*-o-pre-wrap[^>]*>([\s\S]*?)<\/pre>/i;

function decodeHtmlEntities_(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, '&'); // last: avoid double-decoding entities that start with &amp;
}

// Extracts just the buyer's own typed text from a raw ABM notification
// email's html_body. Returns:
//   null       — the <pre> marker wasn't found at all (not a raw ABM
//                template — e.g. already cleaned, or a shape we haven't
//                seen) — callers must NOT touch the comment in this case.
//   ''         — marker found but empty (e.g. a photo-only message with no
//                typed text) — callers should still surface a clean copy so
//                the real attachments aren't stranded inside the raw wall
//                of HTML, just with a placeholder line instead of blank text.
//   non-empty  — the buyer's real message, tags stripped, entities decoded.
function cleanAbmMessageText_(html) {
  const m = ABM_RAW_PRE_RE.exec(html || '');
  if (!m) return null;
  const stripped = m[1].replace(/<[^>]+>/g, '');
  return decodeHtmlEntities_(stripped).trim();
}

// Idempotency tag for a cleaned source comment. Previously this tracking
// marker was embedded as a visible first line of the public comment itself
// ("[Amazon Buyer Message — auto-cleaned copy of comment N]"), which showed
// up at the top of every cleaned message in the ticket's own conversation
// thread — moved to a tag instead so the public comment is just the buyer's
// real message, nothing else.
function abmCleanedTag_(sourceCommentId) {
  return `abm_cleaned_${sourceCommentId}`;
}

// Adds a tag to a ticket WITHOUT replacing its existing tags. The single-
// ticket update endpoint (PUT /api/v2/tickets/{id}.json) has no
// `additional_tags` field — only a plain `tags` field that REPLACES the
// whole array (confirmed via Zendesk's own API docs after the first version
// of this fix silently no-opped: passing `additional_tags` alongside
// `comment` in that same PUT was just an unrecognized/ignored field, so NO
// tag was ever actually added in production, and every subsequent cleanup
// run had zero idempotency signal — reproduced live on ticket #1000153636,
// where two ABM messages 23 seconds apart each triggered their own
// cleanupExistingAbmTicket_ run, both saw the first message as un-cleaned,
// and both posted a duplicate clean copy of it). Adding tags without
// clobbering existing ones requires the DEDICATED tags endpoint instead:
// PUT /api/v2/tickets/{id}/tags.json with body {tags: [...]}.
function addTicketTag_(ticketId, tag) {
  zdFetch_(`/api/v2/tickets/${ticketId}/tags.json`, {
    method: 'put',
    payload: JSON.stringify({ tags: [tag] })
  });
}

// REVERTED 2026-07-23 (was live briefly as redactCommentText_, GAS v14-v18):
// tried auto-redacting the raw comment's text right after posting its clean
// copy, so only the clean message would be visible. Discovered a real,
// unrelated side effect that made this not worth the risk: Zendesk's own
// NATIVE "merge tickets" feature (an agent manually merging a duplicate ABM
// ticket via the Zendesk UI — a completely different mechanism from this
// project's own auto-merge) quotes the merged ticket's "last comment" by
// reading whatever its CURRENTLY STORED text is. On ticket #1000154651, an
// agent natively merged in ticket #1000154652 hours after its raw comment
// had already been redacted — the resulting merge-quote system note showed
// the redacted block-character garbage verbatim, not the original message.
// Redaction is permanent/global: it doesn't just affect how a comment looks
// in its own ticket, it destroys the text for ANY other Zendesk feature that
// might read it later (native merges being the one that surfaced first).
// User's call, given that risk: keep the original (pre-v14) design — post
// the clean copy ALONGSIDE the untouched raw comment, never redact.
// Tickets processed while v14-v18 was live (roughly 2026-07-22 08:00 through
// 2026-07-23) have their raw comments PERMANENTLY blanked already — Zendesk
// redaction cannot be undone via the API. That set of affected real tickets
// was small (this feature was live under a day); see [[abm_ticket_merge]]
// memory for the full incident writeup and any tickets identified.

function alreadyCleanedSourceIds_(ticket, comments) {
  const ids = new Set();
  const tagRe = /^abm_cleaned_(\d+)$/;
  (ticket.tags || []).forEach(t => {
    const m = tagRe.exec(t);
    if (m) ids.add(m[1]);
  });
  // Back-compat: tickets cleaned before this tag existed still carry the old
  // visible "[Amazon Buyer Message — auto-cleaned copy of comment N]" marker
  // in their clean comment's body instead of a tag — keep recognizing those
  // too so this migration doesn't re-post duplicates on tickets cleaned under
  // the old scheme. New cleanups only ever add the tag, never this text.
  const legacyRe = /auto-cleaned copy of comment (\d+)/g;
  (comments || []).forEach(c => {
    const text = c.body || c.plain_body || '';
    let m;
    while ((m = legacyRe.exec(text)) !== null) ids.add(m[1]);
  });
  return ids;
}

// ── Auto-fill ticket fields from the order GCX Reply's Auto-Fill would resolve ──
// User's ask: Order ID / Customer Full Name / Amazon Fulfillment Methods /
// Country should already be filled in by the time an agent opens a new ABM
// ticket, not require them to click GCX Reply's Auto-Fill button first — only
// the buyer's actual message should read as "what was received."
//
// Field IDs must match tampermonkey_scripts/GCX Reply.user.js's ZD constant
// exactly (same Zendesk instance, same custom fields).
const ZD_ORDER_ID    = 360021934132;
const ZD_CUST_NAME   = 360021999951;
const ZD_COUNTRY     = 4513936822297;
const ZD_FULFILLMENT = 900002781823;

// Mirrors GCX Reply's COUNTRY_MAP exactly — must match, since these are the
// literal Zendesk tagger field option values (confirmed live against
// ticket_fields/4513936822297.json: de/uk/fr/it/es/nl/se/ie/pl/tr/be/in/jp/
// sg/au/us/ca/mx/kr).
const ABM_COUNTRY_MAP = {
  US: 'us', GB: 'uk', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', JP: 'jp',
  NL: 'nl', SE: 'se', IE: 'ie', PL: 'pl', TR: 'tr', BE: 'be', IN: 'in',
  SG: 'sg', AU: 'au', CA: 'ca', MX: 'mx', KR: 'kr',
};

// Calls GCX Reply's OWN order-lookup endpoint (GCXReply_GAS's `?orderId=`,
// same SP-API-backed data GCX Reply's Auto-Fill button uses) rather than
// re-implementing SP-API SigV4 signing in this project too.
function fetchGcxOrderData_(orderId) {
  const res = UrlFetchApp.fetch(`${GCX_GAS_URL}?orderId=${encodeURIComponent(orderId)}`,
    { muteHttpExceptions: true, followRedirects: true });
  try {
    const d = JSON.parse(res.getContentText());
    return d && !d.error ? d : null;
  } catch (_) { return null; }
}

// Same precedence GCX Reply's own Auto-Fill uses (buildAndShow's
// fulfillmentReady): a PAN EU seller SKU suffix wins regardless of
// FulfillmentChannel; otherwise AFN→fba, MFN→merchant__fbm_. Confirmed live
// against ticket_fields/900002781823.json for the exact tag values.
function abmFulfillmentTag_(fulfillmentChannel, sellerSku) {
  if (/pan|eup/i.test(sellerSku || '')) return 'pan_eu';
  if (fulfillmentChannel === 'AFN') return 'fba';
  if (fulfillmentChannel === 'MFN') return 'merchant__fbm_';
  return null;
}

// Fills Order ID / Customer Full Name / Country / Amazon Fulfillment Methods
// from the order GCX Reply's own Auto-Fill would resolve — but ONLY fields
// that are CURRENTLY EMPTY, so this never overwrites a value an agent (or an
// earlier run) already set. Safe/idempotent to call on every cleanup run;
// no-ops instantly (no HTTP calls) once all 4 fields are already populated.
function autoFillAbmTicketFields_(ticket, orderId) {
  if (!orderId) return;
  const cf = ticket.custom_fields || [];
  const valueOf_ = id => { const f = cf.find(x => x.id === id); return f ? f.value : null; };
  const needs = {
    orderId:     !valueOf_(ZD_ORDER_ID),
    custName:    !valueOf_(ZD_CUST_NAME),
    country:     !valueOf_(ZD_COUNTRY),
    fulfillment: !valueOf_(ZD_FULFILLMENT),
  };
  if (!needs.orderId && !needs.custName && !needs.country && !needs.fulfillment) return;

  const data = fetchGcxOrderData_(orderId);
  if (!data) return; // order lookup failed/unavailable — leave fields as-is, nothing to fill with

  const custom_fields = [];
  if (needs.orderId) custom_fields.push({ id: ZD_ORDER_ID, value: orderId });
  if (needs.custName) {
    // Falls back to the requester's name (what Zendesk parsed from the ABM
    // email's From-name) when SP-API has no BuyerName — same fallback
    // ladder GCX Reply's own panel uses.
    const name = (data.buyer && data.buyer.BuyerName) || (ticket.via && ticket.via.source && ticket.via.source.from && ticket.via.source.from.name) || null;
    if (name) custom_fields.push({ id: ZD_CUST_NAME, value: name });
  }
  if (needs.country) {
    const countryVal = ABM_COUNTRY_MAP[data.address && data.address.CountryCode];
    if (countryVal) custom_fields.push({ id: ZD_COUNTRY, value: countryVal });
  }
  if (needs.fulfillment) {
    const sellerSku = data.items && data.items[0] ? data.items[0].SellerSKU : '';
    const fv = abmFulfillmentTag_(data.order && data.order.FulfillmentChannel, sellerSku);
    if (fv) custom_fields.push({ id: ZD_FULFILLMENT, value: fv });
  }
  if (!custom_fields.length) return;

  // Confirmed live (2026-07-22): a partial `custom_fields` array in a ticket
  // PUT updates ONLY the listed field IDs — every other custom field on the
  // ticket is left untouched (unlike `tags`, which replaces the whole array;
  // see addTicketTag_'s history of getting this exact distinction wrong for
  // a different field).
  zdFetch_(`/api/v2/tickets/${ticket.id}.json`, {
    method: 'put',
    payload: JSON.stringify({ ticket: { custom_fields } })
  });
}

// Scans a ticket for public, requester-authored comments that are still raw
// ABM template and don't already have a clean copy, and adds one clean
// public comment per such source comment — buyer's real text + re-hosted
// real attachments, authored as the requester so it reads as their own
// message. Fully idempotent (safe to re-run/backfill): each source comment
// gets at most one clean copy, tracked via abmCleanedTag_/
// alreadyCleanedSourceIds_ above. Covers both a ticket's own first
// (creation-time) comment and any raw comments mergeNewTicketIntoPrimary_
// posts onto an existing primary — same function handles both call sites.
// Also auto-fills Order ID/Customer Full Name/Country/Amazon Fulfillment
// Methods (see autoFillAbmTicketFields_) — only empty fields, every run.
//
// LockService-guarded: two ABM messages arriving seconds apart each trigger
// their own call to this function on the SAME ticket (handleNewAbmTicket_ /
// mergeNewTicketIntoPrimary_ per message) — without a lock, both could read
// the same "not yet cleaned" state before either had written its tag,
// racing into a duplicate clean copy of the same source comment (exactly
// what happened live on #1000153636 before this fix).
function cleanupExistingAbmTicket_(ticketId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { status: 'locked', ticketId };
  try {
    const ticket = getTicket_(ticketId);
    if (!ticket) return { status: 'not_found', ticketId };
    const requester = getUser_(ticket.requester_id);
    if (!requester) return { status: 'no_requester', ticketId };

    // ticket.description is Zendesk's own copy of the ticket's originating
    // comment's plain text — for an ABM ticket that's the raw "You have
    // received a message" email, which always embeds the Order ID (confirmed
    // live on #1000154560: description contains "402-1366488-5457149"
    // verbatim). Same regex handleNewAbmTicket_/relayAbmReply_ use elsewhere.
    const orderIdMatch = (ticket.description || '').match(/\b(\d{3}-\d{7}-\d{7})\b/);
    autoFillAbmTicketFields_(ticket, orderIdMatch ? orderIdMatch[1] : null);

    const data = zdFetch_(`/api/v2/tickets/${ticketId}/comments.json?sort_order=asc`);
    const comments = data.comments || [];
    const done = alreadyCleanedSourceIds_(ticket, comments);
    // Defense in depth, independent of tag/marker bookkeeping: if a public,
    // requester-authored comment with this EXACT clean text already exists,
    // treat it as already cleaned regardless — this is what actually caught
    // (and would have prevented) the #1000153636 duplicates, since the tag
    // write was silently failing at the time. Trade-off: a buyer who
    // legitimately repeats the exact same short message verbatim would only
    // get one clean copy — acceptable, this is a safety net, not the
    // primary mechanism (the tag is).
    const existingBodies = new Set(
      comments.filter(c => c.public && c.author_id === requester.id)
        .map(c => (c.plain_body || c.body || '').trim())
    );

    const cleaned = [];
    comments.forEach(c => {
      if (!c.public || c.author_id !== requester.id) return;
      if (done.has(String(c.id))) return;
      const cleanText = cleanAbmMessageText_(c.html_body || '');
      if (cleanText === null) return; // not a raw ABM template comment — leave untouched

      const uploadTokens = transferAttachments_(c.attachments);
      const hasContent = cleanText || uploadTokens.length;
      if (!hasContent) return; // empty message, no attachments — nothing worth surfacing

      const bodyText = cleanText || '(메시지 텍스트 없음 — 첨부파일 참고)';
      if (existingBodies.has(bodyText.trim())) {
        // A clean copy already exists (created before the tag mechanism was
        // fixed) — just backfill the tag, don't post another one.
        addTicketTag_(ticketId, abmCleanedTag_(c.id));
        return;
      }

      const comment = { body: bodyText, public: true, author_id: requester.id };
      if (uploadTokens.length) comment.uploads = uploadTokens;

      zdFetch_(`/api/v2/tickets/${ticketId}.json`, {
        method: 'put',
        payload: JSON.stringify({ ticket: { comment } })
      });
      addTicketTag_(ticketId, abmCleanedTag_(c.id));
      existingBodies.add(bodyText.trim());
      cleaned.push({ sourceCommentId: c.id, attachmentsTransferred: uploadTokens.length, attachmentsTotal: (c.attachments || []).length });
    });
    return { status: 'ok', ticketId, cleaned };
  } finally {
    lock.releaseLock();
  }
}

// Manual runner — run from the Apps Script editor (bypasses the webhook/
// secret entirely; calls the same logic directly). Used for backfilling
// tickets created before this feature existed.
function testCleanupOnTicket(ticketId) {
  const result = cleanupExistingAbmTicket_(ticketId);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
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
    // This ticket's own first comment is still the raw Amazon template —
    // clean it up here too (see the "ABM inbound cleanup" section above),
    // same as a merged follow-up gets below.
    const cleanup = cleanupExistingAbmTicket_(ticketId);
    return { status: 'left_as_primary', ticketId, cleanup };
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
  // The comment mergeNewTicketIntoPrimary_ just posted onto the primary
  // carries the SAME raw Amazon template html_body as the source ticket's
  // own first comment — clean it up on the primary right away, same
  // function used for the standalone (left_as_primary) case above.
  const cleanup = cleanupExistingAbmTicket_(freshPrimary.id);
  return {
    status: merge.wasReopened ? 'merged_reopened' : 'merged',
    ticketId,
    primaryTicketId: freshPrimary.id,
    attachmentsTransferred: merge.attachmentsTransferred,
    attachmentsTotal: merge.attachmentsTotal,
    cleanup
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

    // Secret-guarded on-demand backfill trigger — cleans up a ticket created
    // before the inbound-cleanup feature existed (or any ticket the live
    // webhook path missed for any reason). Idempotent, safe to call repeatedly.
    if (body.action === 'cleanupTicket') {
      const result = cleanupExistingAbmTicket_(body.ticketId);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Secret-guarded manual reconciliation trigger (for testing/on-demand runs).
    if (body.action === 'reconcile') {
      const summary = reconcileAbmRelays_(Number(body.lookbackHours) || 6);
      return ContentService.createTextOutput(JSON.stringify(summary))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Secret-guarded one-time trigger installer.
    if (body.action === 'setupTrigger') {
      const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'reconcileAbmRelays_');
      if (!exists) ScriptApp.newTrigger('reconcileAbmRelays_').timeBased().everyMinutes(30).create();
      return ContentService.createTextOutput(JSON.stringify({ installed: !exists, alreadyExisted: exists }))
        .setMimeType(ContentService.MimeType.JSON);
    }

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

/********************************
 * ABM relay reconciliation
 * ------------------------------
 * Safety net for the outgoing relay. GCX Reply relays an agent's public reply
 * to the buyer via Seller Central ONLY from a browser running the updated
 * userscript with a live SC session. If an agent's browser is stale/old/not
 * logged into SC, their reply silently never reaches the buyer AND never gets
 * logged (the relay never ran to log a failure) — exactly what happened on
 * ticket #1000153794 (agent sent an invoice reply + 3 PDFs; buyer never got
 * it; zero rows in ABM_Relay_Log).
 *
 * This scheduled job closes that gap: it scans recently-updated ABM tickets,
 * finds each ticket's latest public AGENT reply, and if that reply isn't
 * already accounted for in ABM_Relay_Log (by CommentId, or by matching text
 * for browser-relayed rows that predate CommentId), it queues a 'pending' row
 * in the log. Any updated agent browser with a valid SC session then claims
 * (atomic) and delivers it — text AND attachments — via the existing sweep.
 *
 * Dedup is deliberately conservative (favours "already handled" to avoid a
 * duplicate send to a real buyer). Sends are NOT performed here — this only
 * queues; the browser sweep does the actual delivery, one claimant per row.
 ********************************/

// GCX Reply web app (owns the ABM_Relay_Log sheet + its endpoints).
const GCX_GAS_URL = 'https://script.google.com/macros/s/AKfycbw2Vdwk197LXB6oUAzuHS8sKamD5uqKZJDLvcHzbftWJk-M65XV1fAnTqiZo7ZEm4hk/exec';

// EU marketplaces whose Seller Central messaging is served from amazon.de
// (single EU login covers them via marketplaceId) — mirrors GCX Reply's
// EU_SC_REDIRECT so the queued row's marketplace matches what the browser
// sweep will actually hit.
const EU_SC_REDIRECT_TO_DE = ['amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.be'];

function abmMarketplaceFromAddress_(address) {
  const m = (address || '').match(/@marketplace\.(amazon\.[a-z.]+)$/i);
  if (!m) return null;
  const domain = m[1].toLowerCase();
  return EU_SC_REDIRECT_TO_DE.indexOf(domain) !== -1 ? 'amazon.de' : domain;
}

// Aggressive normalization for dedup: the browser relay stores the DECODED
// message text (htmlToPlainText_ turns &nbsp; into an actual nbsp char, etc.),
// while Zendesk's comment.plain_body keeps literal HTML entities like
// "&nbsp;". Comparing raw would falsely treat the same reply as different and
// risk a duplicate send. So strip HTML entities first, then drop everything
// that isn't a letter or digit, then lowercase — two encodings of the same
// message collapse to the same key. Erring toward "already handled" (a false
// match just skips a resend) is the safe direction for real-customer sends.
function normalizeForDedup_(s) {
  return String(s || '')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')   // HTML entities → space (so "nbsp" letters don't linger)
    .replace(/[^\p{L}\p{N}]+/gu, '')     // keep only letters/digits
    .toLowerCase();
}

function gcxGet_(action, params) {
  let url = `${GCX_GAS_URL}?action=${encodeURIComponent(action)}`;
  Object.keys(params || {}).forEach(k => { url += `&${k}=${encodeURIComponent(params[k])}`; });
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  return JSON.parse(res.getContentText());
}

function gcxPost_(payload) {
  const res = UrlFetchApp.fetch(GCX_GAS_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: true
  });
  return JSON.parse(res.getContentText());
}

// Latest PUBLIC agent reply on a ticket — i.e. an outbound message that should
// have reached the buyer. Excludes the customer's own inbound messages and the
// merge-injected customer follow-ups (both authored by end-users, not agents).
function latestAgentPublicComment_(ticketId, requesterId) {
  const data = zdFetch_(`/api/v2/tickets/${ticketId}/comments.json?include=users&sort_order=desc`);
  const roleById = {};
  (data.users || []).forEach(u => { roleById[u.id] = u.role; });
  const comments = data.comments || [];
  for (const c of comments) {
    if (!c.public) continue;
    if (c.author_id === requesterId) continue;             // customer / merge-injected
    const role = roleById[c.author_id];
    if (role === 'agent' || role === 'admin') return c;    // outbound agent reply
  }
  return null;
}

function reconcileAbmRelays_(lookbackHours) {
  // Time-based triggers invoke this with an event object as the first arg, not
  // a number — only honour a real numeric override (from runReconcileNow).
  const hours = (typeof lookbackHours === 'number' && lookbackHours > 0) ? lookbackHours : 6;
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const query = encodeURIComponent(`type:ticket tags:${ABM_TAG} updated>${cutoff}`);

  // Existing log rows, indexed per ticket for dedup.
  const logRows = (gcxGet_('abmRelayAll', { limit: 200 }).rows) || [];
  const byTicket = {};
  logRows.forEach(r => {
    const t = String(r.ticketId);
    (byTicket[t] = byTicket[t] || []).push(r);
  });

  const summary = { scanned: 0, queued: 0, skippedNoCase: 0, skippedNoReply: 0, alreadyLogged: 0, queuedTickets: [] };

  let url = `/api/v2/search.json?query=${query}&sort_by=updated_at&sort_order=desc`;
  let guard = 0;
  while (url && guard++ < 10) {
    const page = zdFetch_(url);
    (page.results || []).forEach(t => {
      if (!t || t.id === undefined) return;
      summary.scanned++;
      const fromAddr = (t.via && t.via.source && t.via.source.from && t.via.source.from.address) || '';
      const caseId = caseIdFromTicket_(t);
      const marketplace = abmMarketplaceFromAddress_(fromAddr);
      if (!caseId || !marketplace) { summary.skippedNoCase++; return; }

      const reply = latestAgentPublicComment_(t.id, t.requester_id);
      if (!reply) { summary.skippedNoReply++; return; }
      const text = (reply.plain_body || '').trim();
      if (!text) { summary.skippedNoReply++; return; }

      const existing = byTicket[String(t.id)] || [];
      const norm = normalizeForDedup_(text);
      const dup = existing.some(r =>
        String(r.commentId) === String(reply.id) ||          // same comment already logged
        normalizeForDedup_(r.messageText) === norm            // browser-relayed row (no commentId) with same text
      );
      if (dup) { summary.alreadyLogged++; return; }

      gcxPost_({
        action: 'logAbmRelay',
        relayKey: `${t.id}_c${reply.id}`,
        ticketId: t.id,
        commentId: reply.id,
        caseId: caseId,
        marketplace: marketplace,
        status: 'pending',
        attempts: 0,
        lastError: 'queued by reconciliation (relay never logged a result)',
        messageText: text
      });
      summary.queued++;
      summary.queuedTickets.push(t.id);
    });
    url = page.next_page || null;
  }

  Logger.log('reconcileAbmRelays_: ' + JSON.stringify(summary));
  return summary;
}

// Manual runner (dry-run visibility) — run from the Apps Script editor.
function runReconcileNow() {
  return reconcileAbmRelays_(24);
}

// Install the scheduled reconciliation (run ONCE from the editor).
function setupReconcileTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'reconcileAbmRelays_');
  if (exists) { Logger.log('reconcile trigger already exists'); return; }
  ScriptApp.newTrigger('reconcileAbmRelays_').timeBased().everyMinutes(30).create();
  Logger.log('reconcile trigger created — every 30 min');
}

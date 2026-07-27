# ABM Ticket Merge

Fixes a gap in the Amazon Buyer Message (ABM) → Zendesk pipeline: Amazon sends
an unthreaded "You have received a message" notification email for **every**
ABM message, so Zendesk's mail channel creates a **new ticket per message**
instead of appending to the buyer's existing open ticket — unlike Seller
Central's own Message Center, which threads everything by `caseId` into one
conversation.

This project merges those duplicates back into a single Zendesk ticket per
buyer, so agents see one thread per ABM conversation, matching Seller Central.

**Script ID:** `1gJu9O-8MNYWVItLYsr48eym0afY1P9n8lUjSwM_p457DIisZLwOXIWAj`
**Web app URL:** `https://script.google.com/macros/s/AKfycbz2hQMj97voADUPYv6YBHzjZaLsogj1osFhFNpny5iQXtKjBJpn8P2i1pW3Af-6M89ZcA/exec`
**Current version:** 20 (posts a clean copy of the raw Amazon-block comment alongside the untouched original — redaction was tried in v14-v18 and reverted in v19, see below — and auto-fills Order ID / Customer Full Name / Country / Amazon Fulfillment Methods / ASIN on new ABM tickets)

## How it works

1. A Zendesk **Trigger** (`ABM Ticket Merge - dedupe on create`, id
   `60028179059225`) fires whenever a ticket is created with `current_tags`
   containing `buyer_message_amazon`.
2. It calls a Zendesk **Webhook target** (`ABM Ticket Merge`, id
   `01KXFKAQP357K470RC455Z4PZ9`), POSTing `{"ticket_id": <new ticket id>}` to
   this project's deployed web app, with `?secret=...` as a shared-secret
   query param (checked in `doPost`).
3. `Code.js`:
   - Looks up the new ticket's requester email.
   - Searches Zendesk for the buyer's prior `buyer_message_amazon` tickets
     that are **not closed** (`status<closed` — keeps new/open/pending/solved,
     drops only terminal `closed`), newest first.
   - **Primary selection is case-ID aware.** Amazon's buyer proxy from-address
     embeds the Seller Central case ID
     (`...+<uuid>@marketplace.amazon.<tld>`). When the new ticket has one, the
     newest candidate with the **same** case ID wins (the exact key Seller
     Central threads by); a candidate with a *different* explicit case ID is
     never chosen; candidates with no resolvable case ID are a soft fallback.
     With no case ID on the new ticket, it falls back to the newest
     same-requester candidate.
   - **Re-fetches the chosen primary fresh** before mutating — Zendesk's search
     index lags live state, so a search result's `status` can be stale. If the
     fresh fetch shows it's actually `closed`, it's skipped.
   - If a usable primary is found: posts the new message as a **public comment
     on the primary** (authored as the requester, so it reads as the
     customer's follow-up), **carrying over the customer's attachments**
     (photos/PDFs — re-downloaded from the source ticket and re-uploaded, since
     Zendesk comments can't reference another ticket's attachment tokens), and
     **reopening the primary to `open` if it was `solved`** — then closes the
     new duplicate with an internal note pointing to the primary.
   - If none found: leaves the new ticket untouched — it becomes the primary
     for future messages.
   - **Idempotency guard**: an incoming ticket that's already `closed` (a
     webhook retry re-firing after this script already processed & closed it)
     is a no-op.

No persistent state/mapping is kept — each invocation searches Zendesk live.

### Reopen & merge (v3/v4) — the split-ticket fix

The original v1/v2 only merged into a **still-open** ticket and never reopened.
Because agents reply then **solve** a ticket, by the time the buyer wrote back
the prior ticket was already solved, so the merge found nothing and a fresh
unmerged ticket was created — producing the reported chains of split tickets
(e.g. JP `#1000153447 → #1000153603 → #1000153740`, all solved between
messages). v3 broadened selection to include solved tickets and reopens them;
v4 added the fresh re-fetch so the reopen decision uses true (not
index-lagged) status. Verified live end-to-end: a solved primary with a fake
buyer's second message auto-reopened to `open` and now holds both messages,
duplicate auto-closed.

**Remaining limit:** a `closed` (terminal) prior ticket cannot be reopened or
commented on in Zendesk, so if the buyer's previous ticket was already fully
*closed* (not just solved) when they write again, a new primary is started.
Solved is reopenable; closed is not.

## Inbound ABM message cleanup (v10)

Amazon's "You have received a message" notification email buries the buyer's
own typed text inside a full marketing/legal HTML template (logo, order
table, survey buttons, footer copyright, `commMgrTok`/`SPC-xxAmazon-...`
tracking IDs) — the resulting ticket comment looks nothing like a normal
claim, even though Zendesk's own inbound mail parsing already attaches the
buyer's real photos/PDFs correctly (verified — no fix needed there).

Investigated live 2026-07-21 by diffing the raw `html_body` of real ABM
tickets across JP/EN/DE: every sample wraps the buyer's own text in exactly
one `<pre>` block with an identical inline style regardless of marketplace/
language — only the surrounding template strings are translated, this
wrapper isn't. That makes it a reliable, locale-agnostic extraction anchor,
so this runs entirely server-side — no Seller Central lookup, no live agent
browser session needed.

Zendesk's Comments API has no way to *replace* a comment's visible text, so
this **adds a separate clean public comment** (customer's real message +
attachments re-hosted onto it, authored as the requester) right after any
raw-template comment is detected. **The raw original is left fully intact —
by design, both the raw Amazon-template comment and the clean copy are
visible in the ticket.** Idempotency (safe to re-run/backfill — each source
comment gets at most one clean copy) is tracked via an `abm_cleaned_{id}`
tag added to the ticket, not visible text.

**v14-v18 also redacted the raw original's text** via the comment "redact"
endpoint (permanent, blanks matched substrings with block characters) so
agents would only ever see the clean copy. **Reverted in v19** (2026-07-23):
Zendesk's own *native* "merge tickets" feature (an agent manually merging a
duplicate ABM ticket via the Zendesk UI — unrelated to this project's own
auto-merge) quotes the merged ticket's last comment by its *currently
stored* text — on a ticket whose raw comment had already been redacted, the
merge-quote system note showed the redacted block-character garbage instead
of the real message. Redaction turned out to be permanent/global, not
scoped to this feature's own view of the comment, so it was reverted.
**Comments redacted while v14-v18 was live (~2026-07-22 08:00 through
2026-07-23) cannot be restored** — Zendesk redaction has no undo via the
API. That window was under a day, so the affected set is small.

**Auto-fills Order ID / Customer Full Name / Country / Amazon Fulfillment
Methods / ASIN** on the ticket from the same order-lookup GCX Reply's own
Auto-Fill button uses (`GCXReply_GAS`'s `?orderId=` endpoint) — only ever
fills fields that are currently empty, never overwrites an agent's or
earlier run's value. **Order ID / Country / Fulfillment require a resolved
order** (extracted from `ticket.description`, then looked up via SP-API) —
but **Customer Full Name and ASIN fill even for order-less ABM tickets**
(e.g. a pre-purchase compatibility question with no Order ID anywhere in
the message, confirmed live on #1000154672): Customer Full Name falls back
to the ticket requester's from-name, and ASIN is regex-extracted directly
from the raw ABM email regardless of whether the message concerns an actual
order. (v18 originally gated ALL fields behind a resolved order, including
these two, which never needed one — fixed in v20.)

Runs automatically from both existing webhook code paths:
- `handleNewAbmTicket_`'s `left_as_primary` branch (a ticket's own first,
  creation-time comment).
- Right after `mergeNewTicketIntoPrimary_` (a merged follow-up posted onto an
  existing primary carries the same raw template).

**Manual backfill** (tickets created before this existed, or any ticket the
live path missed) — from the Apps Script editor: `testCleanupOnTicket(ticketId)`.
Remotely via the same secret-guarded webhook:
```bash
curl -X POST "$WEB_APP_URL?secret=$WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"cleanupTicket","ticketId":1000154136}'
```
(GAS's own 302 redirect on this webapp's POST response doesn't resolve
cleanly via `curl -L`/`urllib` — a known quirk, not a failure; `doPost`
already executed server-side by the time the redirect returns. Verify by
checking the ticket in Zendesk directly rather than trusting the curl output.)

Verified end-to-end (2026-07-21) against real production data: backfilled
tickets #1000153609/623/627/636 (14 real historical inbound messages across
JP/EN, including one with an embedded link) — 100% correct extraction, zero
duplicates on re-run. Attachment re-hosting verified separately with a real
JPEG posted as a synthetic raw-template comment on #1000153636 — the new
clean comment carried the exact same file (byte-identical size), original
untouched.

## Files

| File | Purpose |
|------|---------|
| `Code.js` | `doPost` webhook receiver + merge logic |
| `appsscript.json` | GAS manifest (web app, `ANYONE_ANONYMOUS` / `USER_DEPLOYING`) |
| `setup_zendesk.sh` | One-time script that created the Zendesk webhook + trigger (kept for reference/rebuild, not meant to be re-run — it would create duplicates) |

## Redeployment workflow (after any Code.js edit)

Same pattern as `GCXReply_GAS` — the web app URL is pinned to a specific
deployment, so pushing new code alone does **not** take effect until you bump
the deployment's version:

```bash
cd ~/Desktop/GCX/GAS_Zendesk/ABM_TicketMerge && clasp push --force
# Then create a new version + point the existing deployment at it.
# (OAuth client_id/client_secret/refresh_token: same clasp-login credentials
# used for every other project's redeploy workflow in this repo — not
# reproduced here; pull them from your own clasp/OAuth config.)
TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CLASP_CLIENT_ID}" \
  -d "client_secret=${CLASP_CLIENT_SECRET}" \
  -d "refresh_token=${CLASP_REFRESH_TOKEN}" \
  -d "grant_type=refresh_token" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
SCRIPT_ID="1gJu9O-8MNYWVItLYsr48eym0afY1P9n8lUjSwM_p457DIisZLwOXIWAj"
DEPLOY_ID="AKfycbz2hQMj97voADUPYv6YBHzjZaLsogj1osFhFNpny5iQXtKjBJpn8P2i1pW3Af-6M89ZcA"
VERSION=$(curl -s -X POST "https://script.googleapis.com/v1/projects/${SCRIPT_ID}/versions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"update"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['versionNumber'])")
curl -s -X PUT "https://script.googleapis.com/v1/projects/${SCRIPT_ID}/deployments/${DEPLOY_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"deploymentConfig\":{\"versionNumber\":${VERSION},\"manifestFileName\":\"appsscript\",\"description\":\"update\"}}"
```

## Rollback

To fully disable: delete the trigger and webhook via Zendesk Admin (or
`DELETE /api/v2/triggers/60028179059225.json` and
`DELETE /api/v2/webhooks/01KXFKAQP357K470RC455Z4PZ9.json`). Zendesk will go
back to creating one ticket per ABM message, same as before.

## Known limitations

- Matching is by requester email, not Seller Central's own `caseId` — if
  Amazon ever reuses/rotates the notification's From/Reply-To address per
  message (not just per conversation) instead of keeping it stable per case,
  this would stop matching correctly. Observed behavior during testing (a
  buyer sending 2 messages) kept the same Zendesk-resolved requester across
  both, so this held for the tested case.
- Only merges into a still-**open** ticket. If the buyer's prior ticket was
  already solved/closed before they send a new message, that's treated as a
  new, unrelated conversation (a new primary ticket) — same as how a solved
  Seller Central case would.

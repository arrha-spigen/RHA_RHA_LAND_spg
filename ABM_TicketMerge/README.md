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
**Current version:** 2 (idempotency guard)

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
   - Searches Zendesk for another **still-open** ticket (`status<solved`)
     tagged `buyer_message_amazon` from the same requester (the oldest match
     = the thread's "primary" ticket).
   - If found: posts the new ticket's message as a **public comment on the
     primary ticket**, authored as the requester (so it reads like the
     customer's own follow-up) — then closes the new (duplicate) ticket with
     an internal note pointing to the primary.
   - If not found: leaves the new ticket untouched — it becomes the primary
     for any future messages from that buyer.
   - **Idempotency guard**: if the incoming ticket is already `closed`
     (already processed by a prior invocation — e.g. a webhook retry), it's a
     no-op. Without this, a retried webhook call would re-post a duplicate
     comment on the primary ticket every time it fired.

No persistent state/mapping is kept — each invocation just searches Zendesk
live via `requester:<email> tags:buyer_message_amazon status<solved`.

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
cd ~/Desktop/GCX/ABM_TicketMerge && clasp push --force
# Then create a new version + point the existing deployment at it:
TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com" \
  -d "client_secret=<YOUR_CLIENT_SECRET>" \
  -d "refresh_token=<YOUR_REFRESH_TOKEN>" \
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

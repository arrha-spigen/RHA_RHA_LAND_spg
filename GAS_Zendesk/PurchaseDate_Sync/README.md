# PurchaseDate_Sync — Zendesk → monday.com "Purchase Date" bridge

Fills the **Purchase Date** date column on the monday board
[Galaxy Z8 Case+CP (18421346787)](https://spigen.monday.com/boards/18421346787)
from the Zendesk custom ticket field **Purchase Date** (field id `360019586172`).

## Why

The native monday↔Zendesk integration cannot map Zendesk **custom** fields to
board columns — for a date column its dropdown only offers Zendesk's system
fields (`Created at` / `Due at` / `Updated at`). So the Purchase Date entered
by agents on the ticket never reaches the board.

## How

```
Zendesk Trigger ("Purchase Date changed")
  └─ Webhook → GAS Web App doPost  {"ticket_id": N}
       ├─ GET Zendesk ticket → raw Purchase Date (YYYY-MM-DD)
       ├─ find board item whose "Zendesk Ticket" integration column
       │  holds {"entity_id": N}   (retries ×4 / 20s — the native recipe
       │  may not have created the item yet)
       └─ monday API change_multiple_column_values → date_mm59ejfp
```

## Components

| Piece | Where |
|---|---|
| GAS project | `PurchaseDate_Sync` (standalone, web app deployment) |
| Zendesk webhook | "monday Purchase Date Sync" → GAS `/exec` URL + `?secret=…` |
| Zendesk trigger | "monday Purchase Date Sync" — fires when Purchase Date changes |
| monday board | `18421346787`, columns `date_mm59ejfp` (Purchase Date), `integration_mm0fzmv0` (Zendesk Ticket) |

## Manual functions (GAS editor → Run)

- `backfillPurchaseDates` — fill the date for all existing items with a linked
  ticket and an empty date column. Safe to re-run.
- `testSyncOneTicket` — sync a single hardcoded test ticket.

## Redeploying after code changes

Web app URL is pinned to a deployment — `clasp push` alone does not take
effect. Push, then create a new version and point the existing deployment at
it (same pattern as `GCXReply_GAS` / `ABM_TicketMerge`; see those READMEs).

## Secrets

Zendesk API token, monday API token, and the webhook shared secret live in
`Code.js` constants. Do **not** copy them into docs.

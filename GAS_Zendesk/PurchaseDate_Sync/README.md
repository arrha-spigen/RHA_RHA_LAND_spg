# PurchaseDate_Sync — Zendesk → monday.com "Purchase Date" bridge

Fills the **Purchase Date** date column on the monday board
[Galaxy Z8 Case+CP (18421346787)](https://spigen.monday.com/boards/18421346787)
from the Zendesk custom ticket field **Purchase Date** (field id `360019586172`).

## Why

The native monday↔Zendesk integration cannot map Zendesk **custom** fields to
board columns — for a date column its dropdown only offers Zendesk's system
fields (`Created at` / `Due at` / `Updated at`). So the Purchase Date entered
by agents on the ticket never reaches the board.

## How  (rewritten 2026-09-08 — batch, twice a day)

Previously a Zendesk webhook hit `doPost` on every "Purchase Date changed"
event. In practice it fired ~5–6×/min around the clock and each call walked
the **entire board up to 4×** to locate one item — by far the biggest
consumer of the monday.com account's API budget. It is now a scheduled batch:

```
Time trigger ×2/day (SYNC_HOURS = 07:00, 19:00 Asia/Seoul)
  └─ scheduledPurchaseDateSync()
       ├─ ONE board walk (500 items/page) → every item with a linked
       │  Zendesk ticket + its current Purchase Date cell
       ├─ Zendesk tickets/show_many (100 ids/call) → Purchase Date per ticket
       └─ change_multiple_column_values → date_mm59ejfp
          ONLY for items where the ticket's date differs from the board
```

`doPost` is now a **no-op** — deactivate the Zendesk trigger + webhook.

## Components

| Piece | Where |
|---|---|
| GAS project | `PurchaseDate_Sync` (standalone) |
| Time triggers | 2× daily `scheduledPurchaseDateSync` — installed by `setupPurchaseDateTriggers` |
| Zendesk webhook | "monday Purchase Date Sync" → **deactivate** (endpoint is a no-op now) |
| Zendesk trigger | "monday Purchase Date Sync" → **deactivate** |
| monday board | `18421346787`, columns `date_mm59ejfp` (Purchase Date), `integration_mm0fzmv0` (Zendesk Ticket) |

## Functions (GAS editor → Run)

- `setupPurchaseDateTriggers` — **run once** to install the two daily triggers
  (needs the OAuth consent click; 403s if invoked headlessly). Re-run-safe.
- `scheduledPurchaseDateSync` — the batch sync itself; also runnable on demand.
- `backfillPurchaseDates` — alias for `scheduledPurchaseDateSync` (kept for
  older docs). Now also refreshes items whose date changed, not just empty ones.
- `testSyncOneTicket` — report what the batch would do for one hardcoded ticket.

## Cutover steps

1. `clasp push` (or paste `Code.js` into the editor).
2. Run `setupPurchaseDateTriggers` once from the editor; approve OAuth.
3. Run `scheduledPurchaseDateSync` once manually to confirm it completes clean.
4. In Zendesk Admin: deactivate the **trigger** and the **webhook** named
   "monday Purchase Date Sync".
5. (Optional) Apps Script → Deploy → Manage deployments → archive the Web App
   deployment. Leaving it published is harmless — `doPost` does nothing.

## Secrets

Zendesk API token, monday API token, and the (now-unused) webhook secret live
in `Code.js` constants. These were exposed in an assistant chat — **rotate the
Zendesk and monday tokens** and replace the constants. Do not copy them into docs.

# MCF_Tracking

Google Apps Script project for Spigen GCX — Multi-Channel Fulfillment (MCF) order tracking, stock lookup, fee estimation, and daily reporting to Google Chat.

**GAS Script ID:** `1kDfEUVEEJ7TCA3HOMF6EYFTjbeZZKIeg_X84wCbLT1-tQqJI2ZlPUCxp`  
**Linked sheet:** `MCF 발송 로그` (Spreadsheet ID: `1g6a-S7eeA1oY19aTEFhTNAyp2A5nLqLNkPRqOqriWfc`)

---

## Files

| File | Purpose |
|------|---------|
| `sp-api.js` | SP-API auth (LWA + AWS SigV4), core fetch, retry logic, and all custom sheet formulas (`AMZTK`, `AMZTK_JP`, `MCFFee`, `MCFFee_JP`, `getMcfStockByAsin`, `MCFFeeDebug`) |
| `autoFill.js` | `onEdit` trigger, `backfillTrackingNumbers()`, and `backfillMCFFees()` — batch server-side fee/tracking writes to col Y/Z |
| `main.js` | `MCFReporter` — daily Google Chat card alert listing rows missing a tracking number |
| `MCFGen.js` | (Archived / commented out) MCF order creation and stock-check helpers via SP-API |
| `triggerGen.js` | `triggerTester()` — schedules a one-off `MCFReporter` test run 1 minute out |
| `tamperMonkey.js` | TamperMonkey-related helpers |
| `appsscript.json` | GAS manifest (timezone, OAuth scopes) |

---

## Custom Sheet Formulas (`sp-api.js`)

### `=AMZTK(orderId)`
Returns the tracking number for an EU MCF order. Tries EU endpoint first, falls back to FE.

### `=AMZTK_JP(orderId)`
Same as `AMZTK` but tries FE (Japan/AU/SG) first.

### `=MCFFee(orderId)` / `=MCFFee(orderId, sentDate)` / `=MCFFee(sentDate, orderId)`
Returns the actual settled MCF fulfillment fee via the Finances API. Always uses the actual charged amount (not an estimate). Returns blank until the order settles (usually a few days after shipment) — retries automatically on the next sheet recalculation.

**For bulk use, prefer `backfillMCFFees()` over this formula** — ARRAYFORMULA is not supported and many simultaneous formula calls will queue indefinitely.

| Usage | Example | Notes |
|-------|---------|-------|
| 1-arg | `=MCFFee(Q2)` | Searches last 180 days |
| 2-arg | `=MCFFee(Q2, P2)` or `=MCFFee(P2, Q2)` | `Q2` = orderId, `P2` = sent date (yyyy-mm-dd) — either argument order works, detected by shape (a `Date`/`yyyy-mm-dd` value is always treated as sentDate). Providing sentDate is faster, less bandwidth. |

```
=IF(Q2<>"", MCFFee(Q2, P2), "")
```

> Different row blocks in this sheet have historically used both argument orders — `MCFFee()`/`MCFFee_JP()` detect which argument is the date vs. the orderId by value shape rather than trusting position, so both work correctly regardless of which convention a given row's formula was copied from.

**Lookup strategy:** two strategies, all SP-API calls use 1 attempt (no retry sleep → no 30s timeout):

**Strategy A — targeted** (for Amazon marketplace–linked orders): `getFulfillmentOrderRaw` → `displayableOrderId` (Amazon 3-7-7 format) → `GET /finances/v0/orders/{id}/financialEvents` → tiny single-order response.

**Strategy B — date-range scan** (for seller-created MCF orders with GCX orderId): `listFinancialEvents` for `sentDate → sentDate+60d` window (2 pages max), match `SellerOrderId = GCX orderId`. Confirmed: `backfillMCFFees()` matches fees this way, so Finances API stores `SellerOrderId = GCX-XX-XXXXXX-XX`.

> **Why 1 attempt / 2 pages?** With 15+ concurrent formula cells, retry sleeps (5s × 3 = 15s) cause 30s GAS timeout. Instead: on 429, the cell returns `''` cached for 90 s and retries automatically with fewer concurrent peers. Events older than 2 pages: run `backfillMCFFees()` which uses 20 pages + full retries in a single sequential process.
>
> `=MCFFee(Q35)` (1-arg) and `=MCFFee(P35, Q35)` (2-arg) both work. sentDate (P col) narrows the Finances API window for Strategy B.

- On 429 QuotaExceeded: returns blank and retries after 90 seconds automatically.
- Tries EU endpoint first, falls back to FE.
- Required SP-API roles: **Amazon Fulfillment** + **Finance and Accounting**.

> **GCX order fee-type quirk:** GCX-prefixed orders' Finances API fee lines aren't tagged with a
> `FeeType` containing `FBA`/`FULFILLMENT` (unlike real Amazon marketplace orders), so the standard
> fee-type filter silently dropped their real fee data to `0`. `_sumMcfFeeFromShipments()` and
> `_buildFeeMapForWindow()` sum **all** fee-line types for any `SellerOrderId` starting with `GCX`
> — this was fixed once already (commits `5fe6def`/`eed853c`, 2026-04-24/27) but got lost in a
> later revert; restored 2026-07-28. Also fixed: only the *first* matching `ShipmentEvent` was
> ever checked — split-shipment orders whose fee posted in a later event were misread as `0`;
> now sums across every matching event.

### `=MCFFee_JP(orderId)` / `=MCFFee_JP(sentDate, orderId)`
Same as `MCFFee` but tries FE (Japan/AU/SG) first.

### `getMcfStockByAsin(asin, marketplaceId)`
Returns available FBA inventory count for a given ASIN and marketplace ID. Used internally by `autoFill.js`.

> **Cache TTL:** Found values (tracking number or fee) → 6 hours. Empty/not-yet-settled → 10 minutes (retried). 429 QuotaExceeded → 90 seconds (auto-retry). Permanent errors (403) → 6 hours.

---

## SP-API Setup (Script Properties)

Set these in **Extensions → Apps Script → Project Settings → Script Properties**:

| Key | Description |
|-----|-------------|
| `LWA_CLIENT_ID` | EU LWA client ID |
| `LWA_CLIENT_SECRET` | EU LWA client secret |
| `LWA_REFRESH_TOKEN` | EU LWA refresh token |
| `LWA_CLIENT_ID_JP` | JP LWA client ID (falls back to `LWA_CLIENT_ID`) |
| `LWA_CLIENT_SECRET_JP` | JP LWA client secret |
| `LWA_REFRESH_TOKEN_JP` | JP LWA refresh token |
| `AWS_ACCESS_KEY_ID` | AWS access key for SigV4 signing |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_SESSION_TOKEN` | (Optional) STS session token for assumed roles |
| `SPAPI_HOST_EU` | Defaults to `sellingpartnerapi-eu.amazon.com` |
| `SPAPI_HOST_FE` | Defaults to `sellingpartnerapi-fe.amazon.com` |
| `SPAPI_REGION_EU` | Defaults to `eu-west-1` |
| `SPAPI_REGION_FE` | Defaults to `us-west-2` |

**Required SP-API roles:**
- `Amazon Fulfillment` — tracking lookup (`AMZTK`), stock lookup, `MCFFee` (both methods)
- `Finance and Accounting` — `MCFFee("FinancesAPI", ...)` only

---

## Backfill Functions (`autoFill.js`)

### `backfillMCFFees()`
Writes MCF fulfillment fees as **static values** into col Y (`Transportation Fee`). Use this instead of `=MCFFee(...)` formulas — bulk formula calls queue indefinitely and ARRAYFORMULA is not supported for API-calling functions.

**Batch fetch approach** (fast): finds the earliest sent date across all pending rows, then fetches all Finances API events in 60-day windows for EU and FE endpoints — typically 2–3 API calls total regardless of how many pending rows there are.

- Reads col Q (order ID), col P (sent date), col B (region) from row 4 down
- Skips rows that already have a valid fee value (never overwrites)
- Rows marked `RETRY` or `ERR:` are retried on the next run
- On 429 during a window fetch: sleeps 15s and retries once
- On unsettled orders: leaves blank — next run retries

```javascript
// Run once manually in GAS editor, or set a daily time-based trigger:
backfillMCFFees()
```

### `backfillTrackingNumbers()`
Same pattern for tracking numbers → writes static values into col Z.

### `retryR429Errors()`
Scans col R (row 1108+) for cells whose live `=AMZTK()`/`=AMZTK_JP()` formula is currently
showing a 429 QuotaExceeded error, and re-fetches those specific orders directly.

- **Tracking number found** → freezes the cell to a static `=HYPERLINK(...)` (same URL format
  the live formula produces). This is deliberate: confirmed live that Sheets' custom-function
  engine does not reliably re-run `AMZTK()`/`AMZTK_JP()` just because Apps Script rewrites the
  identical formula text via the API — the cache was primed correctly but the cell kept showing
  the stale 429 text. Freezing to a static value is the only way to guarantee the sheet actually
  displays the result, and it also drops the row out of the 429 filter so future runs progress to
  new rows instead of re-fetching the same already-resolved orders every hour.
- **No tracking number yet** (order genuinely not ready, no error) → primes the cache `AMZTK`
  reads from, then forces a real recalculation by writing a placeholder formula and then the
  original formula back (two distinct writes — Sheets only re-triggers custom functions on an
  actual content change), so the stale error clears to blank.

Bounded so it can never call SP-API forever in one run:
- stops after 40 rows per execution (`RETRY_R_MAX_ROWS_PER_RUN`)
- aborts the whole run after 5 consecutive rows still come back 429 (`RETRY_R_MAX_CONSEC_429`) —
  quota is clearly still exhausted, so it stops and lets the next hourly trigger pick up where
  it left off, instead of hammering SP-API in a tight loop

An hourly time-based trigger for `retryR429Errors()` is already installed on the live script
(set up via the Apps Script Triggers UI / a one-off installer that has since been removed from
the codebase). Manage or remove it from **Apps Script editor → Triggers** (clock icon).

```javascript
// Can also be run manually in GAS editor:
retryR429Errors()
```

### `retryZeroTransportationFees()`
Cleans up the col Y "literal 0" backlog left over from the GCX fee-type filtering bug (see the
`MCFFee()` note above). `backfillMCFFees()` skips any row whose col Y already has a non-empty
value — including `"0"` — so those rows never get reprocessed on their own even after the fix.

Clears up to 40 zero-fee cells per run (`RETRY_ZERO_FEE_MAX_ROWS_PER_RUN`) back to blank, then
runs `backfillMCFFees()` so they get recomputed correctly. Reuses all of `backfillMCFFees()`'s
own safeguards (429 sleep-and-retry per window) — no separate retry logic needed. Bounded to 40
rows/run so one execution can't try to reprocess the whole historical backlog (which could span
many months of Finances API windows) at once; run hourly and it works through the backlog
gradually.

```javascript
// Run manually, or set up an hourly trigger via Apps Script editor → Triggers:
retryZeroTransportationFees()
```

---

## `onEdit` Automation (`autoFill.js`)

Fires on any edit in the `MCF 발송 로그` sheet (rows 4+):

| Trigger column | Action |
|---------------|--------|
| Col I (9) | Writes today's date to col M if empty |
| Col N (14) | Sets col S to `Pending` if col S is empty |
| Col U (21) | Writes today's date to col P (if empty) and sets col S to `MCF` |
| Col F (6) | Calls `updateMcfStockForRow` to refresh stock in col H |
| Col Y (25) | Writes today's date to col T (if empty) and sets col W to `MCF` |
| Col AB (28) = `STOCK` | Runs stock check only (`runStockCheckOnly`) |
| Col W (23) = `RUN` | Runs full MCF row processing (`processMCFRow`) |

---

## Daily Report (`main.js`)

`MCFReporter` runs on a time-based trigger (weekdays 9 AM KST).  
It scans the `MCF 발송 로그` sheet for rows where col R is filled but col S is empty (order sent, tracking not yet entered) and posts a Google Chat card to the GCX T2 ESC. Ticket space with direct row-jump links.

### Setting triggers

```javascript
// In GAS editor, run once:
triggerTester()    // schedules MCFReporter 1 minute from now for testing
```

---

## Version Control & Deployment

```bash
# Pull latest from GAS
cd ~/Desktop/GCX/GAS_Operations/MCF_Tracking
clasp pull

# Push changes to GAS
clasp push

# Commit and push to GitHub
cd ~/Desktop/GCX
git add MCF_Tracking/
git commit -m "..."
git push
```

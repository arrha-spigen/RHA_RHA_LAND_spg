# TicketDailyReport

Google Apps Script project that generates the Spigen GCX daily Zendesk ticket report — fetches open ticket views from the Zendesk API, updates graph sheets, and posts chart images to Google Chat.

**Script ID:** `1GNowLPF82wfWIrHc1Q9xIDr_L0Kz5iv_YxuNRb7Pzioe9OpsS_O_J5L6`  
**Linked spreadsheet:** `10VYnysCGztKWMXfvXIWBVcE2_zENnRxvXUr9nicHkpo`

---

## Files

| File | Purpose |
|------|---------|
| `main.js` | `runZendeskDailyJob()` — declares the ordered step list, runs it via `runResumableJob_()` |
| `retryRunner.js` | Resilient runner: per-step retry, resume-from-crash, auto catch-up scheduling |
| `ZendeskAPI.js` | Zendesk API helpers — fetch tickets by view (with retry), dedup by ticket ID |
| `All_GraphGen.js` | Appends daily counts to `All_Graph` sheet and renders charts |
| `K_시트Gen.js` | Fills the `K_시트` table with current ticket data |
| `sendChat.js` | Sends chart images to Google Chat via `hcti.io` image API + webhook |
| `testingFunc.js` | Manual test helpers |
| `trigger.js` | Sets up time-based triggers |
| `appsscript.json` | GAS manifest |

---

## Daily job flow (`runZendeskDailyJob`)

`runZendeskDailyJob()` hands an ordered list of named steps to `runResumableJob_()`:

| # | Step (`name`) | Does | Critical? |
|---|---------------|------|-----------|
| 1 | `fetchZendeskViewToSheet`    | fills `Zendesk_Daily` from 9 Zendesk views | yes |
| 2 | `fetchZendeskViewToKsheet_A` | fills `K_시트` B5:Gn table | yes |
| 3 | `appendZendeskDailyStatus`   | counts new/open/pending → **one** `All_Graph` row/day, clears `Zendesk_Daily` | yes |
| 4 | `all_GraphChartToGoogleChat` | posts the `All_Graph` chart image to Google Chat | yes |
| 5 | `collapseOldRowsIfNeeded`    | collapses rows past 4 weeks | **no** (logged & skipped on failure) |
| 6 | `fetchZendeskViewToKsheet_B` | rebuilds `K_시트` for `P_시트` | yes |
| 7 | `kSheetToChat`               | posts the `K_시트` snapshot image to Google Chat | yes |

---

## Resilience (`retryRunner.js`)

Transient failures — most often `Exception: Address unavailable: https://spigenhelp.zendesk.com/api/v2/views/.../tickets.json` — hit this job a few times a month. Handling:

1. **Zendesk fetch retry** — `getZendeskTicketsByView()` retries each call up to `ZENDESK_FETCH_ATTEMPTS` (3), backoff 0/2s/4s, on network error, HTTP 429, HTTP 5xx, or unparseable JSON. Non-transient 4xx (auth / not found) fail fast.
2. **Per-step retry** — each step is retried up to `MAX_STEP_ATTEMPTS` (3), backoff 0/5s/15s.
3. **Resume from crash** — every finished step is recorded in Script Properties under `dailyJobProgress:<KST date>`. If the execution dies, the next run **skips the finished steps and resumes at the one that crashed** — so the chart / table are never re-posted and the `All_Graph` row is never added twice. Progress is wiped on full success and pruned when the date rolls over.
4. **Same-day guard** — `appendZendeskDailyStatus()` checks column A of the last `All_Graph` row. If it already equals today's label it **overwrites that row** instead of appending; if `Zendesk_Daily` is already cleared it leaves the row alone (no zero-out). This holds even if the saved progress is lost.
5. **Auto catch-up** — after retries are exhausted on a critical step, a one-off trigger re-runs `runZendeskDailyJob` in `RESCHEDULE_DELAY_MS` (5 min), up to `MAX_RESCHEDULES` (3) per day. These triggers are tracked by id and cleaned up on the next run / on success. Set `ENABLE_AUTO_RESCHEDULE = false` to rely on the normal daily trigger / a manual re-run instead.

**Manual recovery:** run `runZendeskDailyJob` again — it resumes where it stopped. To force a clean full run, use `runZendeskDailyJob_forceFresh()` (clears today's progress + catch-up triggers first).

---

## Configuration

Zendesk credentials are hardcoded in `ZendeskAPI.js` (top of file):

| Constant | Value |
|----------|-------|
| `ZENDESK_SUBDOMAIN` | `spigenhelp` |
| `ZENDESK_EMAIL` | `kjw@spigen.com` |
| `ZENDESK_TOKEN` | API token (set in file) |

Google Chat webhook is set at the top of `main.js`.

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_Operations/TicketDailyReport
clasp push --force
```

Set a daily time-based trigger on `runZendeskDailyJob` in the GAS editor.

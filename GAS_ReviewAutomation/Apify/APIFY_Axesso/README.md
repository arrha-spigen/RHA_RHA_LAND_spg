# APIFY_Axesso

Google Apps Script project for Apify/Axesso Amazon review scraping and daily distribution into Spigen product spreadsheets.

> **Legacy — do not push from here.** [MasterTrigger](../../MasterTrigger/) (scriptId `1AWrX0Xl8feD`, function `masterDailyJob`) is the canonical, currently-deployed version of this same `dailyJob()` logic. This project is kept for reference/history.

## Files

| File | Purpose |
|------|---------|
| `Master.js` | Daily automation — filters, deduplicates, and distributes reviews into destination spreadsheets |
| `Apify.js` | Apify run lifecycle — start scraper runs, poll status, write raw results into dated source sheets |
| `Sheet_Automation.js` | `dedupeSheetByReviewId_()` — shared dedup helper |
| `trigger.js` | Trigger management + daily Google Chat status report (holiday-aware countdown bar) |

---

## Master.js

### Trigger

Time-based trigger — runs `dailyJob()` once per day (KST). Per-product manual entry points also exist (`dailyJob_Glx26()`, `dailyJob_iPh17e()`, `dailyJob_Pixel10a()`, `dailyJob_SDA()`, `dailyJob_AutoAcc()`, `dailyJob_PowerAcc()`, `dailyJob_Jeonryagpon()`, `dailyJob_유지훈P()`) for re-running a single product via `_runSingle(filterSheet)`.

### Flow

```
dailyJob()
  │
  ├─ step1_deleteNumberedSheets()      Delete conflict/dated sheets not matching today
  ├─ step2_dedupDatedSheets()          Deduplicate today's dated sheets by Review ID
  ├─ step2b_updateTemSheet()           Refresh `tem` sheet with all active Review IDs
  └─ Per-config loop (SHEET_CONFIGS)
        ├─ has15=true  → _processFilterSheet_()
        └─ has15=false → _processTo13_()
```

### SHEET_CONFIGS field reference

| Field | Description |
|-------|-------------|
| `filterSheet` | Tab name in source spreadsheet holding raw scraped reviews. Must have a named filter view `"finalize"`. |
| `destId` | Google Spreadsheet ID of the destination workbook |
| `countries` | Set of country codes to include (`"US"`, `"UK"`, `"DE"`, `"FR"`, `"ES"`, `"IT"`, `"JP"`, `"IN"`) |
| `has15` | `true` = dest has `1-5점` + `1-3점`; `false` = dest has `1-3점` only |
| `seriesFilter` | Extra column filter e.g. `{ colLetter: "Q", contains: "S26" }`. `null` = skip |
| `temCol` | Column name in `tem` sheet for this product's Review IDs |
| `insertAtTop` | (`has15=false`) `true` = insert at row 2; `false` = append at bottom |
| `ratingFilter` | (`has15=false`) Allowed rating values e.g. `[1,2,3]`. `null` = all |

### Key column names

| Column | Purpose |
|--------|---------|
| `Review ID` | Dedup key |
| `Country` | Country filter |
| `Content` | Source body text |
| `본문` | Dest body column (for `=dr()` formula) |
| `대분류` | Dest category column (for `=dr()` formula) |
| `인입사유(AI)` | AI classification formula target in `1-3점` |
| `키워드 (AI 요약)` | AI summary formula column in `1-5점` |
| `Update 날짜` | Date written on copy (KST) |
| `Rating` | Used by `ratingFilter` |

---

## Apify.js

Runs the Apify scrapers themselves and pulls raw results into dated source sheets — upstream of `Master.js`'s distribution step.

| Function | Description |
|----------|-------------|
| `runAllScrapers()` | Starts an Apify run for every configured source, tracked via Script Properties |
| `pollApifyRuns()` | Recurring trigger — checks run status, materializes finished datasets into a new dated sheet (`getUniqueSheetName_`), avoids double-processing via `isRunAlreadyMaterialized_` |
| `ensurePollingTrigger_()` / `removePollingTrigger_()` | Manage the recurring poll trigger |
| `getApifyToken_()` | Reads `APIFY_TOKEN` from Script Properties |

---

## Sheet_Automation.js

`dedupeSheetByReviewId_(sheet)` — shared row-dedup helper used by the dated-sheet cleanup steps in `Master.js`.

---

## trigger.js

| Function | Description |
|----------|-------------|
| `masterDailyJob()` | Entry point wired to the daily time trigger — calls `Master.js`'s `dailyJob()` |
| `createTriggers()` | Installs the daily time-based trigger |
| `sendAllTriggerStatus(webhookOverride)` | Posts a Google Chat card summarizing trigger health, with a Korean-holiday-aware countdown bar (`_isKoreanHoliday_`, `_countRemainingWeekdays_`) |

---

## Script Properties required

| Property | Value |
|----------|-------|
| `APIFY_TOKEN` | Your Apify API token |
| `CHAT_WEBHOOK_URL` | Google Chat incoming webhook URL |

**Source spreadsheet:** `SRC_ID = 1tMbA_msRfCRY0KK40GnyZ_h1uNCldlnk9Cg-_MTcbsw`

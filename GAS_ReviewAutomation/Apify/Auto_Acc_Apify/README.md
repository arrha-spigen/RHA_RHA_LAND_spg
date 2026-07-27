# Auto_Acc_Apify (Auto Accessories — Apify trigger)

Container-bound Google Apps Script for the Auto Accessories review spreadsheet. Config/Trigger/Product/UI split-file architecture — the standard pattern for this repo's simpler per-product Apify triggers (contrast with [GlxZ8_Apify](../GlxZ8_Apify/) / [iPh17e_Monday](../iPh17e_Monday/), which bundle Monday sync + Gemini helpers into the same project).

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results, Google Chat notification |
| `Config.js` | `CONFIG` object — Apify task ID, sheet base name, poll delay, `PREFERRED_HEADERS`, Chat webhook |
| `Trigger.js` | `createApifyWeekdayTriggers()` / `deleteApifyWeekdayTriggers()` — schedules one-off weekday-only (Mon–Fri) triggers |
| `Product.js` | Product-level aggregate data fetch (rating, review count per ASIN) |
| `UI.js` | `onOpen()` menu wiring |
| `appsscript.json` | GAS manifest |

---

## Config (`Config.js`)

| Key | Value |
|-----|-------|
| `CONFIG.sheetBaseName` | `Apify` |
| `CONFIG.actorTaskIdOrSlug` | `TvUlCaUpNvjgC23g5` |
| `CONFIG.POLL_DELAY` | 2 hours (production) / 2 minutes (`TEST_MODE`) |
| `CHAT_WEBHOOK_URL` | TCK GCX Spigen Google Chat space |

## Trigger schedule (`Trigger.js`)

`createApifyWeekdayTriggers()` creates one-off triggers for `runApifyNowAndPollAfter2Hours` at 04:00 KST on every weekday (Mon–Fri) within `APIFY_TRIGGER_WINDOW.startDate`–`endDate`. Re-run to regenerate the window (it clears existing triggers for this handler first).

---

## Script Properties required

| Key | Description |
|-----|-------------|
| `APIFY_TOKEN` | Apify API token |

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_ReviewAutomation/Apify/Auto_Acc_Apify
clasp push --force
```

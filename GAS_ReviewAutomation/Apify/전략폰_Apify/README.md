# 전략폰_Apify (Strategy Phones — Apify trigger)

Container-bound Google Apps Script for the 전략폰 review spreadsheet. Triggers an Apify product/review scraping run, polls for completion, writes results into a dated sheet, and can push items to a Monday board.

**Script ID:** `1b9TGawGmcDUj0sm2OswDEfkUjSIi8C0b90vsMqkmkTGiYpUlH_TEtoZN`
**Linked spreadsheet:** `1yo8CbLhJkuxrf3eXbAqZCb6qBejZhSR3YOt7nFv97fw` (Spigen_전략폰 Series_CustomerReviews (★1~3) 2026_GCX)

> ⚠️ **Known config bug — `config.js` still targets Galaxy S26, not 전략폰.**
> `UPLOAD_SHEET_ID`, `BOARD_ID`, and `GROUP_TITLES` in `config.js` all point at the Galaxy S26 destination sheet (`1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g`) and the "📌Galaxy S26 Case+CP" Monday board — this looks like it was copied from `Glx26_Apify`/`GlxZ8_Apify` and never adapted, the same class of bug previously found in `Pixel11_Apify` (leaking Z8 reviews). Needs the correct 전략폰 destination sheet ID and Monday board ID before this script's Monday-push path is trusted. Not fixed here — flagging only.

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results, Excel export, `FILTER_WHITE_ROWS()` |
| `Products.js` | `PRODUCT` config (Apify task ID) + `PRODUCT_FIELDS` dataset field allowlist |
| `UI.js` | `onOpen()` menu wiring |
| `config.js` | Sheet ID, Monday board/column IDs, header names, group mapping — **see config bug above** |
| `trigger.js` | `createApifyWeekdayTriggers()` / `deleteApifyWeekdayTriggers()` — weekday-only trigger window |
| `appsscript.json` | GAS manifest |

---

## Misc utility functions

| Function | Purpose |
|----------|---------|
| `FILTER_WHITE_ROWS()` | Returns rows from the "신제품 라인업" sheet (cols A:I) whose column-A cell has a white (`#ffffff`) background |

---

## Usage

Open the linked spreadsheet → **Apify → Product → Run Product (auto polling)**.

---

## Script Properties required

| Key | Description |
|-----|-------------|
| `APIFY_TOKEN` | Apify API token |

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_ReviewAutomation/Apify/전략폰_Apify
clasp push --force
```

# iPh17e_Monday (iPhone 17e — Monday.com board sync)

Container-bound Google Apps Script for the iPhone 17e review spreadsheet's Monday.com board sync. Same file bundle pattern as [GlxZ8_Apify](../GlxZ8_Apify/) / [Glx26_Apify](../Glx26_Apify/) (Apify trigger + Gemini classification helpers + Monday sync + uploader sidebar), scoped to iPhone 17e. Complements [iPh17e_Apify](../iPh17e_Apify/), which handles the per-product Apify review-scrape trigger for the same sheet.

**Linked spreadsheet:** `16xRJHH7Ynii4erNOn_905ST4CZs6OLpOYTof4uqsGsQ`
**Monday.com board:** `18419272697` (📌iPhone 17e Case+CP)

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results |
| `main.js` | Sheet → Monday.com upload core (`syncSheetToMonday_core`, item create/update, retry-with-backoff) |
| `Products.js` | Product-level aggregate data fetch (rating, review count per ASIN) |
| `Gemini.js` | Gemini API helpers for AI review summaries |
| `config.js` | `UPLOAD_SHEET_ID`, `BOARD_ID`, poll/props helpers |
| `UI.js` | `onOpen()` menu wiring |
| `uploader_sidebar.html` | Sidebar HTML for manual upload UI |
| `국내.js` | Domestic (Korean) review handling helpers |
| `appsscript.json` | GAS manifest |

---

## Config (`config.js`)

| Key | Value |
|-----|-------|
| `UPLOAD_SHEET_ID` | `16xRJHH7Ynii4erNOn_905ST4CZs6OLpOYTof4uqsGsQ` |
| `BOARD_ID` | `18419272697` |

---

## Script Properties required

| Key | Description |
|-----|-------------|
| `APIFY_TOKEN` | Apify API token |
| `MONDAY_API_KEY` | Monday.com sync |

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_ReviewAutomation/Apify/iPh17e_Monday
clasp push --force
```

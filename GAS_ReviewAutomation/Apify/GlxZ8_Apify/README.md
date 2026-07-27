# GlxZ8_Apify (Galaxy Z8 — Apify + Monday.com)

Container-bound Google Apps Script for the Galaxy Z Fold8 / Flip8 / Fold8 Ultra review spreadsheet. Copy of [Glx26_Apify](../Glx26_Apify/)'s full bundle (Apify trigger + Gemini-assisted classification + Monday.com board sync + manual uploader sidebar) repointed at the Z8 sheet/board. `국내.js` (domestic/Korean review handling) is still S26-legacy and hasn't been re-audited for Z8-specific behavior.

**Linked spreadsheet:** `19OhswglYMx_dxSFFDtWI1WYPWq2jONJn6RK84KITwy4`
**Monday.com board:** `18421346787` (📌Galaxy Z8 Case+CP) — same column IDs as the S26 board

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results |
| `main.js` | Sheet → Monday.com upload core (`syncSheetToMonday_core`, item create/update, retry-with-backoff) |
| `UI.js` | `onOpen()` menu wiring |
| `Products.js` | Product-level aggregate data fetch (rating, review count per ASIN) |
| `Gemini.js` | Gemini API helpers for AI review summaries |
| `config.js` | `UPLOAD_SHEET_ID`, `BOARD_ID`, poll/props helpers |
| `uploader_sidebar.html` | Sidebar HTML for manual upload UI |
| `국내.js` | Domestic (Korean) review handling helpers — S26-legacy, not yet Z8-audited |
| `appsscript.json` | GAS manifest |

---

## Config (`config.js`)

| Key | Value |
|-----|-------|
| `UPLOAD_SHEET_ID` | `19OhswglYMx_dxSFFDtWI1WYPWq2jONJn6RK84KITwy4` |
| `BOARD_ID` | `18421346787` |

---

## Script Properties required

| Key | Description |
|-----|-------------|
| `APIFY_TOKEN` | Apify API token |
| `MONDAY_API_KEY` | Monday.com sync |

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_ReviewAutomation/Apify/GlxZ8_Apify
clasp push --force
```

# ASIN_Master_MondaySync

Container-bound Google Apps Script for the ASIN_Master (먼데이보드) spreadsheet. Two independent features live in one `Code.js`:

1. **Monday.com board sync** — pulls a Monday.com board into the sheet's active tab.
2. **ABM_Relay_Log cleanup** — prunes old rows from a separate `ABM_Relay_Log` tab in the same spreadsheet.

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Both features below |
| `appsscript.json` | GAS manifest |

---

## 1. Monday.com sync

Same modeless-dialog sync engine used by [Monday_CX_Board](../Monday_CX_Board/) — fetches board columns/items via a 3-pass GraphQL query (items, formula columns, then a targeted per-item pass for any still-empty formula cells), then writes to the active sheet preserving header formatting.

| Key | Value |
|-----|-------|
| `BOARD_ID` | `7606389164` |

### Usage

Open the spreadsheet → **Monday.com → 업데이트하기**. Shows a live-log modeless dialog while syncing.

---

## 2. ABM_Relay_Log cleanup

Fully independent of the sync above — operates on a different tab (`ABM_Relay_Log`) written by [GCXReply_GAS](../../GAS_Zendesk/GCXReply_GAS/)'s `upsertAbmRelayLog_()`. That log only grows (one row per ABM relay, upserted in place, never pruned), and every write does a full-sheet scan to find a matching row — so an unbounded log slows down ABM reply relaying for every agent, not just sheet size. This prunes rows older than the retention window.

| Key | Value |
|-----|-------|
| `ABM_LOG_SHEET_NAME_` | `ABM_Relay_Log` |
| `ABM_LOG_RETENTION_DAYS_` | `15` |

### Functions

| Function | Description |
|----------|-------------|
| `cleanupOldAbmRelayLogRows()` | Deletes rows whose Timestamp (col A) is older than 15 days. Deletes highest-row-first so row numbers of still-queued deletions never shift. |
| `installAbmRelayLogCleanupTrigger()` | One-time setup — run manually from the Apps Script editor (not headlessly; trigger creation needs an OAuth consent click). Installs a daily trigger at ~4am Asia/Seoul. Safe to re-run (no-ops if already installed). |

---

## Script Properties required

| Key | Used by |
|-----|---------|
| `MONDAY_API_KEY` | Monday.com sync |

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_Operations/ASIN_Master_MondaySync
clasp push --force
```

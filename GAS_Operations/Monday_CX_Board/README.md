# Monday_CX_Board

Generic container-bound Google Apps Script that syncs a Monday.com board into the active sheet tab, with a modeless dialog UI (Monday.com branding + live log). Same sync engine as the Monday-sync half of [ASIN_Master_MondaySync](../ASIN_Master_MondaySync/), minus the ABM log cleanup feature — use this project when you just need a plain board→sheet sync with no extra per-project logic.

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Full sync engine + UI |
| `appsscript.json` | GAS manifest |

---

## How it works

`syncMondayBoardToSheet(reqId)`:

1. Fetches board columns via GraphQL.
2. Pass 1 — fetches all items with a safe fragment set (universal fields + typed extras like `MirrorValue.display_value`, `StatusValue.label`, etc.), paginated via `items_page` cursor.
3. Pass 2 — re-fetches formula columns specifically (formula values often come back empty on pass 1).
4. Pass 3 — for any item still missing formula values, a targeted root-level `items(ids:[…])` fetch, chunked.
5. Writes the merged result to the active sheet, preserving header row formatting.

Progress is streamed to a modeless dialog via `CacheService.getUserCache()`, polled every 600ms from the client-side dialog HTML.

| Key | Value |
|-----|-------|
| `BOARD_ID` | `5669388007` |

### Usage

Open the spreadsheet → **Monday.com → 업데이트하기**.

---

## Script Properties required

| Key | Used by |
|-----|---------|
| `MONDAY_API_KEY` | Board sync |

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_Operations/Monday_CX_Board
clasp push --force
```

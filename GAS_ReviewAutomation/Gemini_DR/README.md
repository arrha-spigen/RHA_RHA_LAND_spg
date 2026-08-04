# Gemini_DR — Google Apps Script (Glx26 bound)

Google Apps Script project bound to the **Galaxy S26 review spreadsheet** (`1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g`).

clasp script ID: `1sPKcHgYy8kEqrp6Ra_FSw3vpnIVlJgB5dNeFLVTzZrZoptmEeA8lnrMm`

---

## Features

### 1. `=DR()` — Gemini-powered defect classifier (`Gemini.js`)

Custom Sheets formula that classifies customer review text into a predefined defect/issue label.

```
=DR(본문셀)
=DR(본문셀, 대분류)
```

**Flow:**
1. Keyword fast path (heavy/bulky → 두꺼움, yellow → 황변, etc.)
2. Gemini API call — tries `gemini-3.5-flash`, falls back to `gemini-2.5-flash-lite`
3. Strict normalize match → loose contains match against the `Defect` sheet
4. Results cached 6 hours via `CacheService` (key prefix: `DR_CACHE_VERSION`)

**Required:** `GEMINI_API_KEY` in Script Properties.

**Defect data source:** `Defect` sheet in the spreadsheet — columns: `대분류` (col A), `label` (col B), `description` (col C).

Utility functions: `clearDRCache()`, `testDRBatch()`, `DEBUG_DR()`.

---

### 2. Apify Amazon Review Scraper (`Code.js`)

Starts an Apify actor task run asynchronously, polls until completion, writes results to a dated sheet, and notifies Google Chat.

**Entry points (run from GAS editor):**
| Function | Purpose |
|---|---|
| `startApifyRunAndSchedulePoll()` | Start the Apify task run + save run ID |
| `pollApifyRunAndWrite()` | Poller — invoked by recurring time trigger every 1 min |
| `purgeOneOffDelayedPollers_()` | Remove stale one-off triggers |
| `logProjectTriggers_()` | Debug: list all project triggers |

**Flow:**
1. `startApifyRunAndSchedulePoll()` → POSTs to Apify task API, saves `APIFY_LAST_RUN_ID` in Script Properties
2. `_ensureRecurringPoller_()` creates a 1-minute time trigger for `pollApifyRunAndWrite()`
3. On `SUCCEEDED`: fetches all dataset items (paginated, 50k/page), writes to a new dated sheet (`Apify_YYMMDD`), deduplicates by `username+reviewTitle+reviewDescription`, posts completion to Google Chat
4. On `FAILED`/`ABORTED`/timeout (180 min): cleans up state + deletes the trigger

**Required Script Properties:** `APIFY_TOKEN`, `CHAT_WEBHOOK_URL` (optional).

---

### 3. Monday.com Upload Sidebar (`main.js`, `UI.js`, `uploader_sidebar.html`)

Sidebar UI accessible via **CX Upload → Open Uploader**. Uploads rows from the `1-3점` sheet of the Glx26 spreadsheet to the **Galaxy S26 Case+CP** Monday.com board (`BOARD_ID: 18399593191`).

**Features:**
- Filters by `Update 날짜` (date col 15) to select only today's rows
- Deduplicates against existing Monday items by `Review Link`
- Routes items to the correct board group by model name (S26 / S26 Plus / S26 Ultra)
- Auto-translates `본문` column into Korean via the `자동번역` board column
- Default status label: `리뷰` on the `클레임/리뷰` column
- Paged upload (250 rows/page) with progress shown in sidebar

**Required Script Properties:** `MONDAY_API_KEY`.

**UI menus added on open:**
- `CX Upload` → Open Uploader / Apify Product (Run / Cancel)
- `AI Tools` → Summarize selected cells / Run Defect GPT (selected cells)

---

### 4. Apify Product Scraper (`Products.js`)

Separate Apify task (`hhYN1b5uTF8x8yk4Q`) for scraping product data. Writes results to a `Product` sheet (overwrites on each run).

**Entry points:**
| Function | Purpose |
|---|---|
| `uiRunProductNow()` | Start product run (called from CX Upload menu) |
| `pollProductRunAndWrite()` | Recurring poller (1-min trigger) |
| `cancelProductPolling()` | Delete product poll trigger |

---

### 5. Korea Domestic Review Sync (`국내.js`)

`updateScoreSheet()` — copies rows from the **국내 고객배드리뷰** sheet into a separate score spreadsheet's `1-3점` tab, remapping columns and filling today's date in KST.

Run manually from the GAS editor.

---

## Script Properties Required

| Key | Used by |
|---|---|
| `GEMINI_API_KEY` | `DR()` formula |
| `APIFY_TOKEN` | Apify review + product scrapers |
| `MONDAY_API_KEY` | Monday.com uploader |
| `CHAT_WEBHOOK_URL` | Google Chat completion notifications (optional) |

---

## Config (`config.js`)

Key constants:
- `UPLOAD_SHEET_ID` / `UPLOAD_SHEET_NAME` — source sheet for Monday upload (`1-3점`)
- `BOARD_ID`, `LINK_COLUMN_ID`, `CLAIM_REVIEW_COLUMN_ID`, etc. — Monday board column IDs
- `PREFERRED_HEADERS` — column order for Apify output sheets
- `CONFIG.pollIntervalMinutes` (1), `CONFIG.pollMaxMinutes` (180), `CONFIG.timezone` (`Asia/Seoul`)

---

## Deploy

```bash
cd Gemini_DR
clasp push --force
```

> Always push from `Gemini_DR/` — never from `Apify/APIFY_Axesso/` which has a different script ID.

# Amazon.de Rating Scraper

Two container-bound Google Apps Script projects that keep a per-ASIN Amazon.de star rating up to date on their linked spreadsheets, using the same Apify actor and the same core design. This doc covers what they share; each project's own README covers its specifics.

| | [SKUSales_Rating_Apify](SKUSales_Rating_Apify/) | [iPhone18Fold_Rating_Apify](iPhone18Fold_Rating_Apify/) |
|---|---|---|
| **Spreadsheet** | `1_9O8oTHt-yHewG0aGeioeM0psZ2kprf3lgH77-BFLs8` ("해외사업부문 개발 발의 품목_사후관리") | `1XXIMDNVMPBut8WTCV-4gZt4DSxHmGaRR8GkRejAOGq0` ("주요 디바이스별 아마존 세일즈 현황") |
| **Sheets** | `SKU세일즈/리뷰` | `iPhone 18`, `iPhone Fold`, `Apple ETC(26)`, `Pixel 11` |
| **ASIN col → Rating col** | G → I (row 7+) | B → E (row 6+) |
| **Apify task** | `QWtvKi7oXZ6YYR92G` (`product-details-scraper-ljh`) | `CLQ3G6Sokyr7AJtQi` (`product-details-scraper-iphone18-fold`) |
| **Scrape trigger** | Weekly, Monday ~08:00 KST | Daily on weekdays, ~08:00 KST (skips Sat/Sun) |
| **ASIN-sync trigger** | Weekly, Sunday ~07:00 KST | Weekly, Sunday ~07:00 KST |

Both use the `axesso_data/amazon-product-details-scraper` Apify actor, scraping `amazon.de/dp/<ASIN>` for every ASIN in their sheet(s).

---

## Shared design

1. **Kick off** (`runApifyRatingRefreshNow`): starts an async run of the project's Apify task, schedules a 1-minute poller.
2. **Poll & write** (`pollRatingRunAndWrite`): once the run `SUCCEEDED`, fetches the dataset (`asin`, `productRating`), and writes each matched row's rating as `=HYPERLINK("https://www.amazon.de/dp/<ASIN>", <rating>)` — clickable straight to the product page.
   - **Never blanks a rating.** A row whose ASIN gets no result (missing from the dataset, or the actor returned an empty rating — e.g. a 404 for a not-yet-live product) keeps whatever was already in the cell. Only a fresh non-empty result overwrites it.
   - `productRating` comes back locale-formatted (e.g. `"4,5 von 5 Sternen"`) — the leading number is extracted and the decimal comma normalized to a dot.
3. **Weekly ASIN sync** (`syncNewAsinsToApifyTask`, Sunday ~07:00 KST — before the next scrape trigger): scans the sheet(s)' ASIN column(s), diffs against the Apify task's current `input.urls`, and appends `https://www.amazon.de/dp/<ASIN>` for anything new via the Apify API. This is a real Apps Script time-based trigger, so it runs even with no session open — rows added to a sheet during the week get picked up automatically.
   - `_looksLikeAsin_()` requires exactly 10 uppercase-alphanumeric characters before treating a cell as a scrapeable ASIN, so placeholder text some rows carry instead of a real ASIN (e.g. `"TBU"`, `"미판매"` = not sold) is never sent to Apify. (This guard exists because an earlier version of the sync briefly polluted the SKUSales task with exactly that kind of junk URL — see git history.)
4. **Manual recovery** (`reprocessDataset(datasetId)`): re-applies an already-completed run's dataset without starting a new Apify run — useful after a write-logic fix, so you don't have to re-scrape to see the corrected output.

---

## Script Properties required (both projects)

| Key | Description |
|-----|-------------|
| `APIFY_TOKEN` | Apify API token (Project Settings → Script Properties in the Apps Script editor) |

---

## Verified live (2026-09-17)

The daily weekday trigger for iPhone18Fold_Rating_Apify fired automatically the day after setup with no manual intervention — confirmed via the Apps Script Executions log (`dailyWeekdayKickoff` → `pollRatingRunAndWrite`, "220 dataset item(s), 180 row(s) written across 4.0 sheet(s)"). SKUSales_Rating_Apify's triggers are weekly and weren't due yet, but are confirmed installed with no stray state.

---

## What this does *not* do

Neither project touches Amazon **review** data (Review ID, review photos, review text) — that's a separate pipeline (the CaspiLM/Snowflake review-fetch workflow, `SQ.TAHOE.AMAZON_REVIEWS` + `AMAZON_REVIEW_PHOTOS`). These two projects only scrape and write the product-level **star rating**, matched by ASIN.

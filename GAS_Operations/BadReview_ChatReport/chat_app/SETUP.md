# BadReview Chat app — setup

A **proof of concept** that runs alongside the webhook broadcast
(`../badreview_chat_report.py`). It does not replace it. Decide after you've seen it
whether to keep it.

What it does: posts a card with a **date picker + product dropdown + [조회]** button.
Pick a date → the app re-reads the `1-3점` tab and re-renders the Pixel 11 / Galaxy Z8
배드리뷰 (1~3점) report for the rows whose `Update 날짜` matches that date (same card
layout as the webhook: colored 대분류 headers, decoratedText Top 5, day breakdown,
배드리뷰 button).

**Why this needs an app and not a webhook:** an incoming webhook is send-only — it
can't receive the "user picked a date" event. A Chat app has an endpoint that does.

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | all handlers + card builder + sheet crunching |
| `appsscript.json` | manifest — `chat: {}` marks it a Chat app; scopes: `spreadsheets.readonly`, `chat.bot` |

## One-time setup (manual — needs Cloud Console)

1. **Create the Apps Script project.** Either:
   - `clasp create --type standalone --title "BadReview Chat App"` in this folder,
     then `clasp push` (`clasp` must be logged in as the account that can read BOTH
     spreadsheets — see the ID table in `../README.md`), **or**
   - script.google.com → New project → paste `Code.gs`, and in Project Settings tick
     "Show appsscript.json" then paste `appsscript.json`.
2. **Attach a standard GCP project** (Apps Script → Project Settings → Google Cloud
   Platform (GCP) Project → Change project) whose number you control.
3. **Enable the Google Chat API** in that GCP project (APIs & Services → Enable APIs
   → "Google Chat API").
4. **Get a deployment ID:** Apps Script → Deploy → **New deployment** → gear icon →
   there's no "Chat" type in the list; just create the deployment (the default is
   fine) and **copy the Deployment ID**. For quick testing you can instead use
   Deploy → **Test deployments** → copy the **Head deployment** ID.
5. **Configure the Chat app:** GCP Console → Google Chat API → **Configuration**:
   - App name: `BadReview 리포트`  ·  Avatar URL: any 256px HTTPS image  ·  Description
   - Functionality: tick **Receive 1:1 messages** and **Join spaces and group
     conversations**
   - Connection settings: **Apps Script** → paste the **Deployment ID** from step 4
   - Slash commands (optional): add `/badreview` → command id 1
   - Visibility: make available to **specific people** (yourself) first for testing,
     widen later
   - Save
6. **Authorize:** open `Code.gs`, run `onMessage` once from the editor to trigger the
   OAuth consent (grants the sheet + chat scopes). The account must have **read
   access to both spreadsheets**.

## Test

- DM the app, or `@BadReview 리포트` in a space it's added to, or `/badreview`.
- You get the control card + today's Pixel 11 and Z8 report cards.
- Change the date, press **조회** → the message updates in place
  (`actionResponse.type = UPDATE_MESSAGE`).
- Typing a date in the message text also works: `@BadReview 리포트 9/5`.

## Notes / limits

- `긍정 리뷰` 인입사유(tag) is excluded from every count and the card (`EXCLUDED_TAGS`
  in `Code.gs`, mirrors the Python) — user rule 2026-09-08.

- Interaction only works where the **app itself** is present — it won't retrofit onto
  the existing webhook messages in the 12 broadcast rooms.
- `refreshReport` is the button handler (Apps Script routes `CARD_CLICKED` to the
  global named in `onClick.action.function`).
- DATE_ONLY returns a UTC-midnight epoch; `refreshReport` converts it back with
  `getUTC*` so the picked calendar day is preserved regardless of the script TZ.
- Card design is duplicated from `../badreview_chat_report.py` — if the card layout
  changes there, mirror it in `Code.gs`.
- Reads via `SpreadsheetApp.openById`; if the deploying account loses sheet access the
  cards will error.

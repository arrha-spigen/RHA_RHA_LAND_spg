# PuzzleLeaderboard

Backend for the "Piece It Together" sliding-image puzzle embedded in `home_page.hbs`
on the [sq2gcx Amazon Helpcenter](../../Zendesk_Themes/sq2gcx_AmazonHelpcenter/) —
the page shown after a customer submits the Amazon EU claim form. Stores the top
solve times (nickname, country, time) in a bound Google Sheet and serves them back
as JSON via a public Web App.

- **Script ID**: `1lZBI21XoOmSki3NmQmO304_AGKNjLusFw5odPzWAFc_aLETEbGqK02ou`
- **Bound Sheet**: `1a6OF9sfMwZGDOahAv41vD6GbfMl8YY-TpMerQS6qcU4` (single `Leaderboard` tab, columns: Nickname, Country, TimeMs, Timestamp)
- **Web App URL** (called from the puzzle's client JS): `https://script.google.com/macros/s/AKfycbxTqkwIOdQFJEOhqInsdzL963LFuf3IFaj0axFlOVwzusz5-Jvk1QgeHcifpxXNS-E1/exec`

## API

- `GET /exec` → `{ leaderboard: [{ nickname, country, timeMs }, ...] }` (top 5, sorted ascending by time)
- `POST /exec` with JSON body `{ nickname, country, timeMs }` → same shape, after inserting the new score. Server-side validates `nickname` (non-empty, ≤20 chars), `country` (must be one of `de,gb,fr,it,es,in,jp` — matches the flags already used on the page), and `timeMs` (1s–1hr sanity range). The sheet is pruned to the best 20 rows on every write so a public write endpoint can't grow it unbounded.

POST is sent as `Content-Type: text/plain` from the client (not `application/json`) deliberately — Apps Script Web Apps don't handle CORS preflight `OPTIONS` requests, so a plain-text body avoids the browser sending one.

## Known deployment gotcha

**Web App "Who has access: Anyone" cannot be set via `clasp`/the Apps Script API** — it's in the manifest (`appsscript.json` → `webapp.access: "ANYONE_ANONYMOUS"`) but `clasp deploy` does not apply it; the deployment silently stays restricted to the script owner. This has to be set once manually: open the [script editor](https://script.google.com/d/1lZBI21XoOmSki3NmQmO304_AGKNjLusFw5odPzWAFc_aLETEbGqK02ou/edit) → **Deploy → Manage deployments** → edit (pencil icon) the existing deployment → **Execute as: Me**, **Who has access: Anyone** → Deploy.

Similarly, `clasp run <function>` requires OAuth scopes clasp's default login doesn't have — attempted via manifest `executionApi` entry and `--use-project-scopes`, still failed with a permission error. One-off maintenance functions (like `seedLeaderboard`) need to be run manually from the Apps Script editor's function dropdown instead.

## Functions

- `doGet(e)` / `doPost(e)` — the public API, see above.
- `seedLeaderboard()` — clears the sheet and inserts 3 placeholder entries (Spigel/DE, Bib Gourmant/FR, ak47/FR) requested as defaults on 2026-07-29. Times (42s/51s/58s) are estimates, not real recorded solves — run manually once from the Apps Script editor (Run ▶ with `seedLeaderboard` selected in the function dropdown) after fixing Web App access above.

# SheetMirror

Google Apps Script project that copies a large Google Sheet in chunks to a separate destination spreadsheet. Used to mirror `26년 전체문의` (the GCX master inquiry log) to a read-only dashboard sheet.

**Script ID:** `1-t6Z95OM0EWsiXHOsExu-hPHMNRTHZ0HD7bdVoHMmbEPwKksRNyolVch`

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | `mirrorSheet()` + `onOpen()` menu |
| `appsscript.json` | GAS manifest |

---

## Config (top of `Code.js`)

| Key | Value |
|-----|-------|
| `sourceId` | `1sjcCj_P4DRD8rywkmYJhbsrzwFfgiJQuF9nIKwCiKlc` |
| `sourceSheet` | `26년 전체문의` |
| `destId` | `1qxwUjuV3-_0HRS1Bsb3Fsua0n8N6r6GzNnqiv9wRU10` |
| `destSheet` | `RAW` |
| `chunkSize` | `1000` rows per read-write cycle |
| `formulaCols` | `[6, 14]` — columns **F** & **N**: never cleared or overwritten |

---

## Usage

Open the destination spreadsheet → **🔄 Mirror → Mirror now**, or run `mirrorSheet()` directly in the GAS editor.

Each run rewrites the destination from the source, but **preserves the formula columns** listed in `formulaCols`. The `RAW` sheet has ARRAYFORMULAs in:

- **F1** — `Brand(상세) Clean` (derived from column E)
- **N1** — `Product Name Clean` (derived from columns L/M)

`colSegments_()` splits the columns into contiguous runs around F and N, so the whole-sheet `clearContents()` is replaced by clearing only the non-formula segments, and the chunked write skips F and N. Source data is mirrored by **absolute column position** — the source's own F/N columns are not copied; the destination shows the cleaned formulas instead. Reads/writes in `chunkSize`-row chunks to stay within GAS memory limits.

To automate, set a time-based trigger on `mirrorSheet`.

---

## Deployment

```bash
cd ~/Desktop/GCX/SheetMirror
clasp push --force
```

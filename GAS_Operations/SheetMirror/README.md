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
| `formulas` | map of column → canonical ARRAYFORMULA, re-applied every run |

---

## Helper formula columns

The `RAW` sheet keeps two computed columns whose canonical formulas live in
`CONFIG.formulas`. They are the **source of truth** — `mirrorSheet()` skips them
when clearing/writing mirrored data **and** re-applies the formula to row 1 on
every run, so they're always correct even if a cell was edited or wiped:

- **F1** — `Brand(상세) Clean` → `={"Brand(상세) Clean";ARRAYFORMULA(REGEXREPLACE(E2:E, "Spigen\((.*?)\)", "$1"))}`
- **N1** — `Product Name Clean` → `={"Product Name Clean";ARRAYFORMULA(REGEXREPLACE(REGEXREPLACE(IF(ISBLANK(K2:K), L2:L, K2:K), " \(.*?\)", ""), "_.*", ""))}`

> Note: backslashes are **doubled in `Code.js`** (JS escaping); the cell receives single backslashes.

To change a formula, edit `CONFIG.formulas` in `Code.js` — not the cell — so the change survives the next mirror.

---

## Usage

Open the destination spreadsheet → **🔄 Mirror → Mirror now**, or run `mirrorSheet()` directly in the GAS editor.

`colSegments_()` splits the columns into contiguous runs around the formula columns, so the whole-sheet `clearContents()` is replaced by clearing only the non-formula segments, and the chunked write skips them. Source data is mirrored by **absolute column position** — the source's own F/N columns are not copied; the destination shows the cleaned formulas instead. `applyFormulas_()` then re-applies F1/N1 last, so they spill over the freshly mirrored E / K / L data. Reads/writes in `chunkSize`-row chunks to stay within GAS memory limits.

To automate, set a time-based trigger on `mirrorSheet`.

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_Operations/SheetMirror
clasp push --force
```

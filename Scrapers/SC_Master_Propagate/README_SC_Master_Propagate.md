# SC_Master_Propagate

`propagate.py` — funnels a newly added `SC_yymmdd` / `CaspiLM_yymmdd` tab on the
source review spreadsheet (`1tMbA_msRfCRY0KK40GnyZ_h1uNCldlnk9Cg-_MTcbsw`) into
the master `SC` sheet, then distributes the new rows to the 8 downstream product
monitoring spreadsheets.

Full procedure, schemas, filter-view criteria and open questions: Claude Code
skill `sc-review-propagate` (`~/.claude/skills/sc-review-propagate/SKILL.md`).

## Usage

```bash
# Phase A — append the new tab into the master SC sheet (dry-run)
python3 propagate.py --new-sheet SC_260910

# Phase B/C/D — one product, dry-run (prints the worklist)
python3 propagate.py --product GlxZ8

# all 8 products, dry-run
python3 propagate.py --all-products

# actually write Phase A
python3 propagate.py --new-sheet SC_260910 --commit
```

`--commit` currently only implements **Phase A**. Phase B/C/D `--commit` is
deliberately blocked — the first live run of the downstream paste / `tem`
refresh / `=dr()` stamping must be done one product at a time under supervision.

## Config

Everything product-specific lives in the `PRODUCTS` dict at the top of
`propagate.py` (destination book id, which sheet, Review-ID column, whether the
raw Review ID is pasted, insert-at-top vs append, `tem` column, `=dr()` target).
Verified against live sheet headers 2026-09-10 except entries marked `CONFIRM`.

## Credentials

`~/.config/gws_shim/token.json` (kjw@spigen.com, `drive` scope). The script
refreshes and rewrites the token on each run.

## Status

`v0.1.0-unvalidated` — built from a read-only structural sweep, no live write has
been executed yet.

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

```bash
# Phase B/D — paste one product live (A:<boundary> + Update 날짜 + 키워드 =ai()
# + =dr() on today's 1-3점 rows + date restyle)
python3 propagate.py --product GlxZ8 --commit

# re-run only the post-paste steps (idempotent): =dr() on today's
# un-classified 1-3점 rows + Update 날짜 yellow/bold restyle
python3 propagate.py --finish --product GlxZ8 --commit

# Phase C — rewrite tem cols F-K (A-E are IMPORTRANGE, never touched)
python3 propagate.py --refresh-tem --commit
```

Every phase is dry-run without `--commit`. Run products one at a time and read
back the row just above the pasted block afterwards (see the skill's 2026-09-11
lesson).

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

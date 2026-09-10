#!/usr/bin/env python3
"""
SC master-sheet propagation pipeline.

WHAT THIS DOES (established 2026-09-10, see skill `sc-review-propagate`):

  Phase A  After a new `SC_yymmdd` (SC scraper) or `CaspiLM_yymmdd` (Caspi fetch)
           tab is added to the SOURCE spreadsheet, append its data rows
           (WITHOUT header) to the master `SC` sheet, then dedupe the whole
           `SC` sheet by `Review ID` (col K) keeping the FIRST occurrence.
           Also extend the 8 `* finalize` filter views' row ranges to cover
           the new rows.

  Phase B  For each of the 8 downstream products, read its `<Product> finalize`
           filter view on the `SC` sheet, apply that view's criteria to the
           deduped `SC` rows, drop rows whose Review ID is already in the
           destination sheet, and paste the survivors into the product's
           monitoring sheet (1-5점 where the book has both 1-5/1-3, else 1-3점).

  Phase C  Refresh the `tem` sheet column for that product with every Review ID
           now present in the destination sheet's Review-ID column, so the
           `<Product> Tab` helper formula on `SC` flips those rows to "Updated"
           and they are not re-propagated next run.

  Phase D  On the 1-3점 sheet, set the 인입사유(AI) column for the newly added
           rows to `=dr(<본문col><n>, <대분류col><n>)`.
           GlxZ8 / Pixel11 / 유지훈P ONLY. SDA / Auto_Acc / Power_Acc / 전략폰
           skip Phase D (`dr_skip`) — their agents type 인입사유 by hand.

SAFETY: dry-run is the DEFAULT. Nothing is written without `--commit`.
Run ONE product at a time on the first live run and eyeball the sheet after
each: `--product GlxZ8 --commit`.

Credentials: ~/.config/gws_shim/token.json  (kjw@spigen.com, drive scope).
See memory gws_shim_sheets_token / gws_shim_gcp_project.
"""

import argparse
import datetime
import json
import sys

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

TOKEN = "/Users/kevinkim/.config/gws_shim/token.json"
SRC = "1tMbA_msRfCRY0KK40GnyZ_h1uNCldlnk9Cg-_MTcbsw"
SC_SHEET = "SC"
SC_SHEET_GID = 444769313
TEM_SHEET = "tem"

# SC / SC_yymmdd / CaspiLM_yymmdd canonical 14-col data layout (A..N):
#  A ASIN | B Created 날짜 | C 사진 유무 | D Reviewer | E Review Ratings |
#  F Review Title | G 본문 | H 국가 | I Review Link | J Image URL |
#  K Review ID | L Order ID | M Product Rating | N Ratings Count
# O..W on the SC sheet are ARRAYFORMULA/MAP helper columns (Device, <Product> Tab)
# that auto-spill down open-ended ranges — never write to O..W.
SC_DATA_COLS = 14
SC_REVIEW_ID_IDX = 10  # 0-based col K within the A..N block

# tem sheet columns (1-based), header row 1, Review IDs from row 2:
#  A SDA | B iPh17 | C Auto Acc | D 전략폰 | E Power_Acc | F 유지훈P |
#  G Pixel 10a | H Glx26 | I iPh17e | J GlxZ8 | K Pixel11
TEM_COL = {
    "SDA": 1, "Auto_Acc": 3, "전략폰": 4, "Power_Acc": 5,
    "유지훈P": 6, "Glx26": 8, "GlxZ8": 10, "Pixel11": 11,
}

# ─────────────────────────────────────────────────────────────────────────────
# Per-product config. Verified 2026-09-10 against live sheet headers/filter views
# unless marked CONFIRM.
# ─────────────────────────────────────────────────────────────────────────────
PRODUCTS = {
    "GlxZ8": {
        "filter_view": "GlxZ8 finalize",          # FV 721716446
        "dest_id": "19OhswglYMx_dxSFFDtWI1WYPWq2jONJn6RK84KITwy4",
        "dest_sheet": "1-5점",                     # book has 1-5점 AND 1-3점 → paste into 1-5점
        "dest_review_id_col": "K",
        "paste_review_id": True,                   # raw Review ID value IS pasted (CX team relies on it)
        "paste_through_col": "K",                  # paste A..K
        "insert_at_top": False,
        "one_three_sheet": "1-3점",                # mirror/filter of 1-5점 — do NOT paste into it directly
        "dr_sheet": "1-3점",
        "dr_col_header_contains": "인입사유(AI)",   # → col M ("인입사유(AI)  Acc. 74.5%")
        "dr_body_header": "본문",                  # → col G
        "dr_category_header": "대분류",            # → col S
    },
    "Pixel11": {
        "filter_view": "Pixel11 finalize",        # FV 529212369
        "dest_id": "12I6z_FFmDIMHa0rLanltKKFp7kI_yREQj3adkMamPgI",
        "dest_sheet": "1-5점",
        "dest_review_id_col": "K",
        "paste_review_id": True,
        "paste_through_col": "K",
        "insert_at_top": False,
        "one_three_sheet": "1-3점",
        "dr_sheet": "1-3점",
        "dr_col_header_contains": "인입사유(AI)",   # col M ("인입사유(AI)  Acc. 83.9%")
        "dr_body_header": "본문",
        "dr_category_header": "대분류",
    },
    "Glx26": {
        # INACTIVE 2026-09-10: Galaxy S26 is past its monitoring period. Config
        # kept for reference only — skipped by --all-products; the `GlxS26
        # finalize` filter view is no longer maintained. Run explicitly with
        # --product Glx26 only if the user asks.
        "inactive": True,
        "filter_view": "GlxS26 finalize",         # FV 302123587
        "dest_id": "1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g",  # confirmed 2026-09-10 (1-5점 + 1-3점)
        "dest_sheet": "1-5점",
        "dest_review_id_col": "K",
        "paste_review_id": True,
        "paste_through_col": "K",
        "insert_at_top": False,
        "one_three_sheet": "1-3점",
        "dr_sheet": "1-3점",
        "dr_col_header_contains": "인입사유(AI)",   # col M ("인입사유(AI)  Acc. 80.9%")
        "dr_body_header": "본문",
        "dr_category_header": "대분류",
    },
    "유지훈P": {
        "filter_view": "유지훈P_finalize",         # FV 216742354  (note underscore, no space)
        "dest_id": "1dlY6q8trbVMVJAjw_OUoxp1cguA2oTB8WlPhHR01xIw",
        "dest_sheet": "1-3점",                     # book has ONLY 1-3점 (and an unrelated "1~5점")
        "dest_review_id_col": "K",
        "paste_review_id": False,                  # K is auto-filled from Review Link (I) by a formula
        "paste_through_col": "J",                  # paste A..J only (through Image URL)
        "insert_at_top": True,                     # insert blank rows at row 2 each run, then fill; keep row-1 arrayformulas intact
        "one_three_sheet": None,
        "dr_sheet": "1-3점",
        "dr_col_header_contains": "인입사유(AI)",   # → col L ("인입사유(AI)")
        "dr_body_header": "본문",                  # → col G
        "dr_category_header": "대분류",            # → col S
    },
    # ── SDA / Auto_Acc / Power_Acc / 전략폰 ──────────────────────────────────
    # NO =dr() (confirmed 2026-09-10): CX agents type the 인입사유 column by hand
    # on these four. Phase D is skipped — `dr_skip: True`.
    "SDA": {
        "filter_view": "SDA finalize",            # FV 1125062509
        "dest_id": "1sxapIqJgXcJdeqyCf9bAxCNXrVMsVjsZE9QWPwEm0R4",
        "dest_sheet": "1-3점",                     # ONLY 1-3점
        "dest_review_id_col": "J",
        "paste_review_id": False,                  # J is derived from Review Url (I) by a formula
        "paste_through_col": "I",                  # paste A..I ONLY. J = Review ID (auto from I).
        # Everything from J onward is agent-typed or arrayformula — never pasted.
        "insert_at_top": False,
        "one_three_sheet": None,
        "dr_skip": True,
    },
    "Auto_Acc": {
        "filter_view": "AutoAcc finalize",        # FV 1131952515
        "dest_id": "1mEYb1b92D6BIOaSYkAnMit6THuw5ewtymhA-mSIVDfs",
        "dest_sheet": "1-3점",
        "dest_review_id_col": "J",
        "paste_review_id": False,
        "paste_through_col": "I",                  # paste A..I ONLY (J onward = auto / agent-typed)
        "insert_at_top": False,
        "one_three_sheet": None,
        "dr_skip": True,
    },
    "Power_Acc": {
        "filter_view": "PowerAcc finalize",       # FV 1414549791
        "dest_id": "1QC8Is6UvTnFXaOeXviKM_331i3Fo_CBIYx80VS696LI",
        "dest_sheet": "1-3점",
        "dest_review_id_col": "J",
        "paste_review_id": False,
        "paste_through_col": "I",                  # paste A..I ONLY (J onward = auto / agent-typed)
        "insert_at_top": False,
        "one_three_sheet": None,
        "dr_skip": True,
    },
    "전략폰": {
        "filter_view": "전략폰 finalize",          # FV 1853891342
        "dest_id": "1yo8CbLhJkuxrf3eXbAqZCb6qBejZhSR3YOt7nFv97fw",
        "dest_sheet": "1-3점",
        "dest_review_id_col": "J",
        "paste_review_id": False,
        "paste_through_col": "I",                  # paste A..I ONLY (J onward = auto / agent-typed)
        "insert_at_top": False,
        "one_three_sheet": None,
        "dr_skip": True,
    },
}

# `SC` sheet helper columns O..W (0-based within A..W) → the tem column each
# `<Product> Tab` formula compares against, for reference:
#   O(14) Device | P(15) GlxZ8 Tab→tem J | Q(16) Pixel11 Tab→tem K |
#   R(17) 유지훈P Tab→tem F | S(18) AutoAcc Tab→tem C | T(19) PowerAcc Tab→tem E |
#   U(20) SDA Tab→tem A | V(21) 전략폰 Tab→tem D | W(22) GlxS26 Tab→tem H


def a1_col_to_idx(letter):
    idx = 0
    for ch in letter:
        idx = idx * 26 + (ord(ch.upper()) - ord("A") + 1)
    return idx  # 1-based


def idx_to_a1_col(idx):
    s = ""
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(ord("A") + rem) + s
    return s


def get_service():
    with open(TOKEN) as f:
        info = json.load(f)
    creds = Credentials.from_authorized_user_info(info)
    creds.refresh(Request())
    with open(TOKEN, "w") as f:
        f.write(creds.to_json())
    return build("sheets", "v4", credentials=creds)


def load_filter_views(svc):
    meta = svc.spreadsheets().get(
        spreadsheetId=SRC,
        fields="sheets(properties(sheetId,title),filterViews(filterViewId,title,range,criteria))",
    ).execute()
    for s in meta["sheets"]:
        if s["properties"]["title"] == SC_SHEET:
            return {fv["title"]: fv for fv in s.get("filterViews", [])}
    raise SystemExit("SC sheet not found on source spreadsheet")


def row_passes(row, criteria):
    """row: list of cell strings (A.. order). criteria: filterView['criteria']
    dict keyed by 0-based column index string."""
    for col_s, crit in criteria.items():
        col = int(col_s)
        val = row[col] if col < len(row) else ""
        hidden = crit.get("hiddenValues")
        if hidden is not None and val in hidden:
            return False
        cond = crit.get("condition")
        if cond:
            t = cond["type"]
            cvals = [v.get("userEnteredValue", "") for v in cond.get("values", [])]
            if t == "TEXT_CONTAINS":
                if cvals and cvals[0] not in val:
                    return False
            elif t == "TEXT_NOT_CONTAINS":
                if cvals and cvals[0] in val:
                    return False
            elif t in ("DATE_AFTER", "DATE_ON_OR_AFTER", "DATE_BEFORE",
                       "DATE_ON_OR_BEFORE", "DATE_EQ"):
                try:
                    d = datetime.date.fromisoformat(val[:10])
                    ref = datetime.date.fromisoformat(cvals[0][:10])
                except ValueError:
                    return False
                if t == "DATE_AFTER" and not d > ref:
                    return False
                if t == "DATE_ON_OR_AFTER" and not d >= ref:
                    return False
                if t == "DATE_BEFORE" and not d < ref:
                    return False
                if t == "DATE_ON_OR_BEFORE" and not d <= ref:
                    return False
                if t == "DATE_EQ" and not d == ref:
                    return False
            else:
                raise SystemExit(f"Unhandled filter condition type {t!r} — extend row_passes()")
    return True


def col_values(svc, sid, sheet, col_letter, start_row=2):
    rng = f"'{sheet}'!{col_letter}{start_row}:{col_letter}"
    r = svc.spreadsheets().values().get(spreadsheetId=sid, range=rng).execute()
    return [x[0] if x else "" for x in r.get("values", [])]


def header_row(svc, sid, sheet):
    r = svc.spreadsheets().values().get(spreadsheetId=sid, range=f"'{sheet}'!1:1").execute()
    return r.get("values", [[]])[0] if r.get("values") else []


def find_col(headers, want_exact=None, contains=None):
    for i, h in enumerate(headers):
        if want_exact is not None and h.strip() == want_exact:
            return i + 1
        if contains is not None and contains in h:
            return i + 1
    return None


# ─────────────────────────────────────────────────────────────────────────────
def phase_a_append_and_dedupe(svc, new_sheet, dry_run=True):
    """Append `new_sheet` data rows (no header) to `SC`, dedupe SC by Review ID."""
    src_vals = svc.spreadsheets().values().get(
        spreadsheetId=SRC, range=f"'{new_sheet}'!A:N"
    ).execute().get("values", [])
    if not src_vals:
        raise SystemExit(f"{new_sheet} is empty")
    body = src_vals[1:]  # drop header
    body = [r + [""] * (SC_DATA_COLS - len(r)) for r in body if any(c.strip() for c in r)]

    sc_vals = svc.spreadsheets().values().get(
        spreadsheetId=SRC, range=f"'{SC_SHEET}'!A:N"
    ).execute().get("values", [])
    sc_body = sc_vals[1:]
    seen = set()
    for r in sc_body:
        if len(r) > SC_REVIEW_ID_IDX:
            seen.add(r[SC_REVIEW_ID_IDX])

    to_add = []
    dup_in_batch = 0
    for r in body:
        rid = r[SC_REVIEW_ID_IDX]
        if rid in seen:
            dup_in_batch += 1
            continue
        seen.add(rid)
        to_add.append(r)

    print(f"  {new_sheet}: {len(body)} rows in tab, "
          f"{dup_in_batch} already in SC (skipped), {len(to_add)} new to append")
    new_total = 1 + len(sc_body) + len(to_add)  # header + existing + new
    print(f"  SC row count: {1 + len(sc_body)} → {new_total}")

    if dry_run:
        print("  [dry-run] would append and extend 8 filter-view ranges to", new_total)
        return to_add

    if to_add:
        svc.spreadsheets().values().append(
            spreadsheetId=SRC, range=f"'{SC_SHEET}'!A1",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": to_add},
        ).execute()
    # extend filter view ranges
    fvs = load_filter_views(svc)
    reqs = []
    for fv in fvs.values():
        rng = dict(fv["range"])
        if rng.get("endRowIndex", 0) < new_total:
            rng["endRowIndex"] = new_total
            reqs.append({"updateFilterView": {
                "filter": {"filterViewId": fv["filterViewId"], "range": rng},
                "fields": "range",
            }})
    if reqs:
        svc.spreadsheets().batchUpdate(spreadsheetId=SRC, body={"requests": reqs}).execute()
        print(f"  extended {len(reqs)} filter-view ranges to row {new_total}")
    return to_add


# ─────────────────────────────────────────────────────────────────────────────
def phase_b_c_d_product(svc, product, dry_run=True):
    cfg = PRODUCTS[product]
    fvs = load_filter_views(svc)
    if cfg["filter_view"] not in fvs:
        raise SystemExit(f"filter view {cfg['filter_view']!r} not found on SC")
    crit = fvs[cfg["filter_view"]].get("criteria", {})

    sc_vals = svc.spreadsheets().values().get(
        spreadsheetId=SRC, range=f"'{SC_SHEET}'!A2:W"
    ).execute().get("values", [])
    cand = []
    for row in sc_vals:
        row = row + [""] * (23 - len(row))
        if row_passes(row, crit):
            cand.append(row)
    print(f"[{product}] filter view {cfg['filter_view']!r}: {len(cand)} rows pass criteria")

    dest_id, dest_sheet = cfg["dest_id"], cfg["dest_sheet"]
    existing_ids = set(col_values(svc, dest_id, dest_sheet, cfg["dest_review_id_col"]))
    new_rows = [r for r in cand if r[SC_REVIEW_ID_IDX] not in existing_ids]
    print(f"[{product}] {len(existing_ids)} already in {dest_sheet}; "
          f"{len(new_rows)} genuinely new")
    if not new_rows:
        return

    through = a1_col_to_idx(cfg["paste_through_col"])
    payload = []
    for r in new_rows:
        block = list(r[:through])
        if not cfg["paste_review_id"]:
            rid_i = a1_col_to_idx(cfg["dest_review_id_col"]) - 1
            if rid_i < len(block):
                block[rid_i] = ""
        payload.append(block)

    print(f"[{product}] will write {len(payload)} rows × {through} cols (A:{cfg['paste_through_col']}) into "
          f"'{dest_sheet}' ({'insert@row2' if cfg['insert_at_top'] else 'append@bottom'}); "
          f"paste_review_id={cfg['paste_review_id']}  "
          f"(everything past col {cfg['paste_through_col']} is auto-formula / agent-typed — never written)")

    dr_note = ("Phase D skipped (agents type 인입사유 by hand)"
               if cfg.get("dr_skip")
               else f"set 인입사유(AI) =dr() on '{cfg['dr_sheet']}'")
    if dry_run:
        print(f"[{product}] [dry-run] sample row:", payload[0][:12], "...")
        print(f"[{product}] [dry-run] would then {dr_note} and refresh tem col "
              f"{idx_to_a1_col(TEM_COL[product])}")
        return

    raise SystemExit(
        f"[{product}] --commit path intentionally not implemented yet. "
        "First live run must be done step-by-step under supervision "
        "(insert-at-top row math, dr() column resolution, and tem refresh each "
        "carry production risk). Use this dry-run output as the worklist."
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--new-sheet", help="SC_yymmdd or CaspiLM_yymmdd tab to funnel into SC (Phase A)")
    ap.add_argument("--product", choices=list(PRODUCTS), help="run Phase B/C/D for one product")
    ap.add_argument("--all-products", action="store_true", help="Phase B/C/D for all 8 (dry-run only)")
    ap.add_argument("--commit", action="store_true", help="actually write (default: dry-run)")
    args = ap.parse_args()
    dry = not args.commit
    svc = get_service()

    if args.new_sheet:
        print("=== Phase A ===")
        phase_a_append_and_dedupe(svc, args.new_sheet, dry_run=dry)

    if args.all_products:
        prods = [p for p, c in PRODUCTS.items() if not c.get("inactive")]
    else:
        prods = [args.product] if args.product else []
    for p in prods:
        print(f"=== Phase B/C/D: {p} ===")
        phase_b_c_d_product(svc, p, dry_run=dry)

    if not args.new_sheet and not prods:
        ap.print_help()


if __name__ == "__main__":
    main()

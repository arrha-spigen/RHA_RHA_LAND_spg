# KPI_Report

Single-function, manual-run script that populates the team's quarterly/half-year KPI narrative cells on a specific KPI tracking spreadsheet. Not a general-purpose reporting tool — the KPI text itself is hardcoded in the script and must be rewritten each period.

---

## Files

| File | Purpose |
|------|---------|
| `populateKPIResults.gs` | `populateKPIResults()` — writes hardcoded KPI narrative strings into column L |
| `appsscript.json` | GAS manifest |

---

## What it does

`populateKPIResults()` opens a fixed spreadsheet/sheet and writes 4 hardcoded Korean-language KPI result strings (one per KPI item — Amazon review rating improvement, SIREN issue escalation, MCF/CX profit improvement, CX satisfaction & automation) into `L4:L7`, wrapped and top-aligned.

| Key | Value |
|-----|-------|
| `SHEET_ID` | `15Jh6ZFDBIbpv4OANVtD3g4wFBJxoof9SHWDUEU3GiXI` |
| `SHEET_NAME` | `'26 상_김지우` |
| Target range | `L4:L7` |

**To reuse for a new period:** edit the `kpiValues` array in `populateKPIResults.gs` with the new period's numbers/text, update `SHEET_NAME` if the tab changed, then run `populateKPIResults()` from the Apps Script editor.

---

## Deployment

```bash
cd ~/Desktop/GCX/GAS_Operations/KPI_Report
clasp push --force
```

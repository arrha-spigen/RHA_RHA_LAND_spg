# Zendesk_Themes

Version-controlled export of the two Zendesk Guide Help Center themes used in the
Spigen GCX claim-form flow. Each theme is edited live via the Zendesk "Customize
design" (theming) editor in the browser — files here are a full local mirror for
version control, not a build artifact that gets deployed back automatically.

## Sites

| Folder | Zendesk brand | Theme ID | Purpose |
|--------|---------------|----------|---------|
| `sq2gcx_AmazonHelpcenter/` | `sq2gcx.zendesk.com` | `01983e92-f744-4e6e-9b9e-16eac05b500f` | Help Center shown after a customer submits the **Amazon EU claim form**. Redirects shoppers to Amazon Store pages (DE/UK/FR/IT/ES/IN/JP). |
| `spigen-eu_ShopifyHelpcenter/` | `spigen-eu.zendesk.com` | `c773e8a3-5558-4dc3-8620-c1802e889f3c` | Help Center shown after a customer submits the **Spigen EU (Shopify-run) claim form**. Redirects shoppers to Spigen's own Shopify storefronts (spigen.de/co.uk/fr/it/es). Community feature is not enabled on this brand, so the `community_*` templates are intentionally empty. |

Both themes share the same 20-template Zendesk Guide structure (`templates/*.hbs`)
plus theme-level `script.js` and `style.css`.

## sq2gcx `home_page.hbs` puzzle

`home_page.hbs` on sq2gcx includes a "Piece It Together" sliding-image puzzle
(3×3, built from the Spigen Official Store promo image, tap-two-tiles-to-swap —
started at 4×4 but the banner's plain white background made several tiles look
blank, so it was shrunk to 3×3) with a live mm:ss.mmm timer. Solving under
30/20/10 seconds triggers a tiered canvas-confetti celebration (bronze/silver/
gold — pulsing border + message), all client-side, no backend. An earlier
version had a top-5 leaderboard backed by a Google Sheet + Apps Script Web App;
that was removed in favor of the confetti effects, and the backend project
(`GAS_Zendesk/PuzzleLeaderboard`) was deleted from the repo. The Google Sheet /
Script / Web App deployment it used still exist in Drive but are now orphaned —
not referenced by any live code — and can be deleted manually if desired.

## Editing

Edits are made directly in the live theming editor via Playwright (CDP-attached to
the logged-in Chrome session for `kjw@spigen.com`), then mirrored back to this repo
and committed/pushed — see the `zendesk_theme_editing_workflow` memory for the
editor URL pattern and CodeMirror extraction details.

`home_page.hbs` is the page a customer lands on immediately after claim-form
submission; it's the most frequently touched file in each theme.

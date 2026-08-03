# Tampermonkey Scripts — Spigen GCX

Tampermonkey userscripts for the Spigen GCX Amazon operations workflow.

---

## Scripts

### GCX Reply (`v3.5.2`)
**Matches:** `spigenhelp.zendesk.com/agent/tickets/*`

Floating panel on Zendesk tickets. Fetches Amazon order data and Spigen product info, then fills all relevant ticket fields in one click. Also handles Amazon Buyer Message (ABM) replies and "No Response Needed" directly against Seller Central — no ChannelReply dependency.

**Order lookup:**
- Auto-detects order ID from Zendesk custom fields, ticket description, and page text
- Shows clickable chips when multiple order IDs are found; auto-fetches if only one is found
- Displays: Order ID (linked to Seller Central), Order Status, Purchase Date, Amount, Delivery Level, Ship Date, Fulfillment Channel, Ship Service Level, Buyer Name
- Shipping Address (collapsible)
- Items list with SKU, quantity, and title
- Return ASIN (linked to Amazon product page)
- 구매이력 (2yr): total ITEM quantity purchased/refunded across all of the buyer's orders in the last 2 years (not raw order count — a customer with 4 orders totaling 5 items shows 5), linked to Seller Central order search

**Product info:**
- Auto-detects ASIN from Zendesk custom fields or page text
- Looks up: SKU, 모델명, 브랜드, 제조사명, 기종명, 색상명, 대분류, 생산업체, 원산지정보
- Data source priority: ASIN Master (Sheet1) → market sheet (Sheet2) → Amazon product page (fallback scrape)
- 판매 마켓 badges showing which marketplaces carry the product
- ASIN Sources panel (collapsed by default): shows Sheet1, Sheet2, and Amazon data side by side

**Auto-Fill Form button** (appears after order data loads):
- Opens an editable "Confirm Auto-Fill" popup — every row matches its real Zendesk field type (searchable dropdown for tagger/dropdown fields, editable text input for free-text fields), so an agent can correct a wrong or missing value before submitting, not just accept/reject it
- Fills all Zendesk custom fields via the Zendesk API in one click on confirm:
  Order ID, ASIN, 문의SKU, Customer Name, Purchase Date, Order Status, Order Total, Delivery Level, Country, Point of Purchase, Brand(상세), Device, Product Name, Fulfillment, ❗사진/영상 유무❗, ✅전체 주문, ❎전체 환불
- Device and Product Name fields are matched to dropdown options using token similarity, with a candidate picker shown when genuinely ambiguous
- A "what's new" popup shows once per version bump after Auto-Fill/panel changes ship

**→ MCF button** (appears after order data loads):
- Opens the Amazon MCF create-order page (global or JP) in a new tab
- Pre-fills recipient name, address, ASIN, and order ID via URL hash, picked up by the MCF Autofill script
- Also runs its own embedded MCF-page autofill (SKU search + auto-select highest-fulfillable-quantity result, shipping speed, Order ID lookup) independent of the standalone MCF Autofill script below

**Amazon Buyer Message (ABM) handling:**
- "Mark as NRN" button calls Seller Central's own internal messaging API directly (no ChannelReply) to mark a case resolved — works on any ABM ticket, order or not (case resolved from the buyer proxy address's embedded case ID)
- Public replies to ABM tickets are auto-relayed to the matching Seller Central case via the agent's own SC session; a reconciliation sweep catches replies that failed to relay (no SC session, page not open, etc.)
- Relay success/failure toasts and the floating "N replies not yet delivered" badge can be muted per-agent (⚙ → Alerts → ABM 전송 알림); the panel header's static **ABM** button always shows the undelivered count and opens the full relay-status log on demand — per-ticket links, per-row Retry / Mark delivered, checkbox selection with "Retry selected" (plus select-all) alongside "Retry all"
- Persistent banner warns when a required marketplace's Seller Central login session is missing, with direct login links

**Panel UX:**
- Draggable (grab header) and resizable (drag bottom-right corner)
- Minimize / close buttons; "Order Lookup" toggle button to reopen
- Compact layout mode auto-activates when panel width < 260px
- Auto-resets when navigating between tickets (SPA-aware)
- Load log at the bottom shows live fetch steps for debugging
- Settings drawer (⚙): Liquid Glass effect toggle, per-section data-fetch toggles (Order/Shipping/Product Info)

**Fallbacks:**
- If SP-API lacks buyer PII permission, fetches buyer email and 2-year order/item stats from the agent's existing Seller Central session
- If SP-API GetOrderItems is blocked (403), queries Seller Central orders-api for items using the agent's SC session

---

### Amazon MCF Autofill (`v1.4.3`)
**Matches:** `sellercentral.amazon.*` and `sellercentral-europe.amazon.*` — MCF create-order pages

Injects a floating panel on the MCF order creation page (EU marketplaces: UK, DE, FR, IT, ES). Autofills recipient name, address, and line items from order data passed by GCX Reply's MCF button (via URL hash, with a clipboard-paste fallback), reducing manual data entry when placing Multi-Channel Fulfillment orders.

- Auto-selects the SKU search result with the highest fulfillable quantity, skipping internal `amzn.*` SKUs — quantity is parsed from the leading digit count in the result badge so this works regardless of Seller Central's display language (e.g. "192 fulfillable" in English, "192 주문 처리 가능" in Korean)
- Auto-selects Standard shipping speed
- Works with Seller Central's Korean-language field labels (전체 이름, 상세 주소, 도시, 시/도, 우편번호, 전화번호, 이메일 주소, 국가) in addition to English
- Reads a Ctrl+V clipboard paste as a fallback autofill path when the URL-hash bridge from GCX Reply didn't carry data

---

### Amazon JP MCF Autofill (`v1.5.2`)
**Matches:** `sellercentral-japan.amazon.com` — MCF create-order pages

JP-specific variant of the MCF Autofill script. Picks up order data from GCX Reply's MCF button, maps Japanese prefecture names to their romanized equivalents, and autofills the JP MCF order form.

---

### Amazon Invoice Automation (`v1.5`)
**Matches:** `sellercentral.amazon.de` — individual order pages

Adds a "Run Now" button on Amazon.de Seller Central order pages. On click, attempts to download the deemed resale/supply invoice first, falling back to the Amazon-generated invoice. Copies the result to clipboard via `GM_setClipboard`.

---

### GChat Reply Suggest (`v2.1.0`)
**Matches:** `chat.google.com/*` and `spigenhelp.zendesk.com/agent/tickets/*` (works inside the Chrome-PWA "desktop app" install too, since it's the same Chrome origin/extension context)

Alt+G behaves differently depending on the Chat room:

**In most rooms** — suggests 3 short candidate reply sentences for the current conversation as clickable chips docked above the compose box (AI-generated). Click a chip to insert it at the cursor; Esc dismisses the bar.
- Grabs the tail (~2000 chars) of `[role="main"]`'s `innerText` as conversation context — deliberately avoids Google Chat's hashed/obfuscated class names, which rotate on redeploy
- Picks the last visible `[role="textbox"][contenteditable="true"]` on the page as the active compose box (Google Chat renders more than one; the others are hidden thread/history boxes)
- Calls a **local** backend (`../gchat_reply_suggest_server.py`, listens on `127.0.0.1:8765`) rather than a cloud API — the backend shells out to the existing `claude` CLI (`~/.local/bin/claude -p`), so it reuses the Claude Code subscription with no separate API key or per-token billing
- Backend must be running for suggestions to work: `python3 ~/Desktop/GCX/Browser_Extensions/gchat_reply_suggest_server.py` (not yet wired to auto-start on login — run manually, or ask to set up a LaunchAgent)

**In designated "ticket forward" rooms** — Alt+G instead shows a **deterministic, no-AI** ticket-forward picker:
- Rooms are matched by Chat **space ID** (the `/app/chat/<ID>` segment of the URL), not by display name — `document.title` turned out to be unreliable for this (Chat rewrites it for unread counts, "X messaged you", etc., not just a stable "RoomName - Chat" string). Configured in `TEMPLATE_ROOM_IDS` near the top of the script. Currently only `Private` (`AAQAc9NQmJQ`) is confirmed; **to add another room** (e.g. GCX전략xADS3), open it, press Option+G once, then check the browser console — the script logs the current space ID and name every time, ready to copy into the config
- The Zendesk-side half of this same script (`@match spigenhelp.zendesk.com/agent/tickets/*`) records Country/Device/Product Name/ASIN (same custom-field IDs as GCX Reply's `ZD` constant) for every ticket you visit, into a shared list of the 10 most recent
- Alt+G in a template room shows that list (most recent pre-highlighted); **↑/↓ arrow keys browse older tickets, Enter confirms** (mouse click also works). Picking one inserts:
  ```
  안녕하세요 프로님, 담당하시는 제품 관련 (사유) 문의가 들어와 전달드립니다. 확인 후 회신해 주시면 감사하겠습니다!

  **{일련번호} {국가} {기종}용 {제품명} [{ASIN}]**
  {티켓 링크, 실제 하이퍼링크}
  ```
  The reference line renders **bold** and the ticket link is a real clickable hyperlink — both verified to survive an actual send, not just the draft view. (Chat's compose box enforces a Trusted Types CSP that blocks `execCommand("insertHTML", ...)`; formatting is applied by inserting plain text first, then wrapping the exact substrings with real DOM nodes — `document.createElement("b"/"a")` — which sidesteps Trusted Types entirely since no HTML string is ever parsed.)
  The index number is a per-room (by space ID), per-day (KST) counter that auto-increments on each forward
- After a forward, the script watches for the next incoming message in that room and auto-offers a confirm-reply chip (`@{답변자} 확인 감사합니다 프로님...`, reusing the same bold/hyperlinked ticket reference line), with the @mention defaulting to whoever just replied — click a name chip to insert
- **Known limitation:** the `@mention` inserted is plain text, not a real Google Chat mention chip (that would require automating Chat's own live autocomplete) — re-type `@` yourself if you need the person actually pinged

---

## Installation

1. Install the [Tampermonkey extension](https://www.tampermonkey.net/) in Chrome.
2. Get the `.user.js` file for the script you want to install.
3. Drag the file into the Tampermonkey Dashboard, or open it and click "Install" when prompted.

Once installed, Tampermonkey checks the `@updateURL` in the script header and auto-updates when a new version is pushed.

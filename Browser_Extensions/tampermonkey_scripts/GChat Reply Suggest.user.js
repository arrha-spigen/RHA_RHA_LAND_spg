// ==UserScript==
// @name         GChat Reply Suggest
// @namespace    https://spigen.com/gcx
// @version      2.1.1
// @description  Alt+G suggests AI reply sentences in most Google Chat rooms; in designated "ticket forward" rooms it instead offers a deterministic ticket-forward template (no AI) sourced from recently-visited Zendesk tickets
// @author       Spigen GCX
// @updateURL    https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/Browser_Extensions/tampermonkey_scripts/GChat%20Reply%20Suggest.user.js
// @downloadURL  https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/Browser_Extensions/tampermonkey_scripts/GChat%20Reply%20Suggest.user.js
// @match        https://chat.google.com/*
// @match        https://spigenhelp.zendesk.com/agent/tickets/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // Rooms that get the deterministic ticket-forward template instead of
  // AI-suggested replies, keyed by Chat "space" ID — the /app/chat/<ID>
  // segment of the URL. This is NOT the room's display name: document.title
  // is unreliable (Chat rewrites it for unread counts, "X messaged you",
  // etc.), so the space ID is the only stable identifier. To add a room:
  // open it, press Option+G once (even if it falls through to AI-suggest),
  // and check the browser console — this script logs the current space ID
  // and name every time so you can copy it in here.
  const TEMPLATE_ROOM_IDS = {
    AAQAc9NQmJQ: "Private", // confirmed 2026-08-03
    AAAAKwBoZPU: "GCX전략 x ADS3", // confirmed 2026-08-03 (note: space around "x", not "GCX전략xADS3")
  };

  // Same custom-field IDs GCX Reply.user.js already uses (ZD constant there),
  // kept in sync so both scripts read the same ticket data the same way.
  const ZD = {
    ASIN: 360021934312,
    COUNTRY: 4513936822297,
    DEVICE: 360022185671,
    PRODUCT_NAME: 360022185891,
    INQUIRY_1: 360022182831, // "1차 Defect Reason or Inquiries"
    ESC_REASON: 900007557523, // "ESC. 사유"
  };

  const RECENT_TICKETS_KEY = "grs_recent_tickets";
  const MAX_RECENT_TICKETS = 10;
  const FIELD_OPTS_CACHE_KEY = "grs_zd_field_opts_cache";
  const FIELD_OPTS_TTL_MS = 24 * 60 * 60 * 1000;
  const PENDING_CONFIRM_PREFIX = "grs_pending_confirm_";
  const DAILY_INDEX_PREFIX = "grs_idx_";

  function todayKST() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  // =====================================================================
  // ZENDESK SIDE — records recently-visited tickets for the Chat side to
  // pick from. Runs only on spigenhelp.zendesk.com/agent/tickets/*.
  // =====================================================================
  async function getFieldOptsCached() {
    const cached = GM_getValue(FIELD_OPTS_CACHE_KEY, null);
    if (cached && Date.now() - cached.ts < FIELD_OPTS_TTL_MS) return cached.data;

    const res = await fetch("/api/v2/ticket_fields.json?locale=ko", { credentials: "include" });
    const data = await res.json();
    const wantedIds = [ZD.COUNTRY, ZD.DEVICE, ZD.PRODUCT_NAME, ZD.INQUIRY_1, ZD.ESC_REASON];
    const out = {};
    for (const f of data.ticket_fields) {
      if (!wantedIds.includes(f.id)) continue;
      const map = {};
      for (const o of f.custom_field_options || []) map[o.value] = o.name;
      out[f.id] = map;
    }
    GM_setValue(FIELD_OPTS_CACHE_KEY, { ts: Date.now(), data: out });
    return out;
  }

  async function recordCurrentTicket() {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    if (!m) return;
    const ticketId = m[1];

    try {
      const [ticketRes, fieldOpts] = await Promise.all([
        fetch(`/api/v2/tickets/${ticketId}.json`, { credentials: "include" }).then((r) => r.json()),
        getFieldOptsCached(),
      ]);
      const ticket = ticketRes.ticket || {};
      const cfMap = {};
      for (const f of ticket.custom_fields || []) cfMap[f.id] = f.value;

      const resolve = (fieldId) => {
        const val = cfMap[fieldId];
        if (!val) return "";
        const opts = fieldOpts[fieldId] || {};
        return opts[val] || val;
      };

      const entry = {
        id: ticketId,
        url: `https://spigenhelp.zendesk.com/agent/tickets/${ticketId}`,
        subject: ticket.subject || "(no subject)",
        country: resolve(ZD.COUNTRY),
        device: resolve(ZD.DEVICE),
        productName: resolve(ZD.PRODUCT_NAME),
        asin: cfMap[ZD.ASIN] || "",
        inquiryReason: resolve(ZD.INQUIRY_1) || resolve(ZD.ESC_REASON) || "",
        visitedAt: Date.now(),
      };

      let list = GM_getValue(RECENT_TICKETS_KEY, []);
      list = list.filter((t) => t.id !== entry.id);
      list.unshift(entry);
      list = list.slice(0, MAX_RECENT_TICKETS);
      GM_setValue(RECENT_TICKETS_KEY, list);
    } catch (e) {
      console.error("[GChat Reply Suggest] failed to record ticket", e);
    }
  }

  // =====================================================================
  // CHAT SIDE
  // =====================================================================
  const BACKEND_URL = "http://127.0.0.1:8765/suggest";
  const TRANSCRIPT_CHAR_LIMIT = 2000;
  const BAR_ID = "gchat-reply-suggest-bar";

  GM_addStyle(`
    #${BAR_ID} {
      position: fixed;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      max-width: 520px;
      pointer-events: none;
    }
    #${BAR_ID} .grs-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      pointer-events: none;
    }
    #${BAR_ID} .grs-chip {
      pointer-events: auto;
      background: #1a73e8;
      color: #fff;
      border-radius: 14px;
      padding: 6px 12px;
      font-size: 13px;
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${BAR_ID} .grs-chip:hover { background: #1558b3; }
    #${BAR_ID} .grs-chip.grs-loading { background: #5f6368; cursor: default; }
    #${BAR_ID} .grs-chip.grs-error { background: #d93025; cursor: default; white-space: normal; }
    #${BAR_ID} .grs-panel {
      pointer-events: auto;
      background: #fff;
      color: #202124;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      padding: 6px;
      max-width: 480px;
      max-height: 320px;
      overflow-y: auto;
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      font-size: 13px;
    }
    #${BAR_ID} .grs-panel-title {
      font-weight: 600;
      padding: 4px 8px;
      color: #5f6368;
      font-size: 11px;
      text-transform: uppercase;
    }
    #${BAR_ID} .grs-item {
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    #${BAR_ID} .grs-item:hover { background: #f1f3f4; }
    #${BAR_ID} .grs-item.grs-item-default { background: #e8f0fe; }
    #${BAR_ID} .grs-item-subject { font-weight: 500; }
    #${BAR_ID} .grs-item-meta { color: #5f6368; font-size: 11px; margin-top: 2px; }
  `);

  function getComposeBox() {
    const boxes = Array.from(
      document.querySelectorAll('[role="textbox"][contenteditable="true"]')
    ).filter((el) => el.offsetParent !== null);
    return boxes.length ? boxes[boxes.length - 1] : null;
  }

  function getSpaceId() {
    const m = location.pathname.match(/\/chat\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // Best-effort display name, only used for logging/labels — never for the
  // template-room decision itself (see TEMPLATE_ROOM_IDS comment above).
  function getRoomName() {
    return (document.title || "")
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*-\s*Chat\s*$/, "")
      .trim();
  }

  function isTemplateRoom() {
    return getSpaceId() in TEMPLATE_ROOM_IDS;
  }

  function getTranscriptTail() {
    const main = document.querySelector('[role="main"]');
    if (!main) return "";
    const text = (main.innerText || "").trim();
    return text.slice(-TRANSCRIPT_CHAR_LIMIT);
  }

  // Best-effort sender-name scrape. Google Chat's classes are hashed/rotate
  // on redeploy — if these stop matching, this degrades to an empty list
  // (manual @mention typing still works, nothing crashes).
  function getRecentSenders(limit = 8) {
    const main = document.querySelector('[role="main"]');
    if (!main) return [];
    const nodes = main.querySelectorAll(".MsqITd, .njhDLd.O5OMdc");
    const seen = [];
    for (let i = nodes.length - 1; i >= 0 && seen.length < limit; i--) {
      const name = (nodes[i].textContent || "").trim();
      if (name && !seen.includes(name)) seen.push(name);
    }
    return seen;
  }

  function removeBar() {
    pickerState = null;
    const existing = document.getElementById(BAR_ID);
    if (existing) existing.remove();
  }

  function positionBarAbove(el, bar) {
    const rect = el.getBoundingClientRect();
    bar.style.left = `${Math.max(8, rect.left)}px`;
    bar.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
  }

  function insertIntoCompose(box, text) {
    box.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false); // cursor at end
    sel.addRange(range);
    document.execCommand("insertText", false, text);
  }

  // Chat's compose box enforces a Trusted Types CSP, so execCommand("insertHTML", ...)
  // throws. Instead: find the plain text we just inserted and wrap it with real
  // DOM nodes (createElement + appendChild — no HTML-string parsing involved,
  // so Trusted Types doesn't apply), then fire an input event so Chat's own
  // compose-state sync picks up the change. Verified this survives an actual
  // send (not just the draft view).
  function wrapSubstringWithElement(box, needle, makeWrapper) {
    if (!needle) return false;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(needle);
      if (idx === -1) continue;
      const after = node.splitText(idx);
      after.splitText(needle.length);
      const wrapper = makeWrapper();
      after.parentNode.insertBefore(wrapper, after);
      wrapper.appendChild(after);
      return true;
    }
    return false;
  }

  function applyReferenceLineFormatting(box, refLineText, url) {
    wrapSubstringWithElement(box, refLineText, () => document.createElement("b"));
    wrapSubstringWithElement(box, url, () => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    });
    box.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
  }

  function renderChips(box, suggestions) {
    removeBar();
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    const row = document.createElement("div");
    row.className = "grs-row";
    suggestions.forEach((s) => {
      const chip = document.createElement("div");
      chip.className = "grs-chip";
      chip.textContent = s;
      chip.title = s;
      chip.addEventListener("click", () => {
        insertIntoCompose(box, s);
        removeBar();
      });
      row.appendChild(chip);
    });
    bar.appendChild(row);
    document.body.appendChild(bar);
    positionBarAbove(box, bar);
  }

  function renderStatus(box, text, cls) {
    removeBar();
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    const row = document.createElement("div");
    row.className = "grs-row";
    const chip = document.createElement("div");
    chip.className = `grs-chip ${cls}`;
    chip.textContent = text;
    row.appendChild(chip);
    bar.appendChild(row);
    document.body.appendChild(bar);
    positionBarAbove(box, bar);
  }

  // ---- AI-suggest flow (non-template rooms) ----
  function requestAiSuggestions() {
    const box = getComposeBox();
    if (!box) return;

    const transcript = getTranscriptTail();
    if (!transcript) {
      renderStatus(box, "No conversation found to suggest from", "grs-error");
      setTimeout(removeBar, 2500);
      return;
    }

    renderStatus(box, "Thinking…", "grs-loading");

    GM_xmlhttpRequest({
      method: "POST",
      url: BACKEND_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ transcript }),
      timeout: 30000,
      onload: (res) => {
        try {
          const body = JSON.parse(res.responseText);
          if (body.suggestions && body.suggestions.length) {
            renderChips(box, body.suggestions);
          } else {
            renderStatus(box, body.error || "No suggestions returned", "grs-error");
            setTimeout(removeBar, 3000);
          }
        } catch (e) {
          renderStatus(box, "Bad response from backend", "grs-error");
          setTimeout(removeBar, 3000);
        }
      },
      onerror: () => {
        renderStatus(box, "Backend not running (localhost:8765)", "grs-error");
        setTimeout(removeBar, 3500);
      },
      ontimeout: () => {
        renderStatus(box, "Backend timed out", "grs-error");
        setTimeout(removeBar, 3000);
      },
    });
  }

  // ---- Ticket-forward template flow (template rooms) ----
  function referenceLineText(t, index) {
    return `${index} ${t.country} ${t.device}용 ${t.productName} [${t.asin}]`;
  }

  function referenceBlock(t, index) {
    return `${referenceLineText(t, index)}\n${t.url}`;
  }

  function buildForwardText(t, index) {
    // Zendesk's own option labels sometimes already carry parens (e.g.
    // "(Urgent)_리스팅오류") — strip a wrapping pair so we don't double up.
    const reason = (t.inquiryReason || "문의").trim().replace(/^\((.*)\)$/, "$1");
    return `안녕하세요 프로님, 담당하시는 제품 관련 (${reason}) 문의가 들어와 전달드립니다. 확인 후 회신해 주시면 감사하겠습니다!\n\n${referenceBlock(t, index)}`;
  }

  function buildConfirmText(senderName, pending) {
    return `@${senderName} 확인 감사합니다 프로님. 주신 답변 확인 후 처리하도록 하겠습니다!\n\n${referenceBlock(pending, pending.index)}`;
  }

  function nextIndexForToday(spaceId) {
    const key = DAILY_INDEX_PREFIX + spaceId + "_" + todayKST();
    const next = GM_getValue(key, 0) + 1;
    GM_setValue(key, next);
    return next;
  }

  function relativeTime(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  // Active ticket-picker state (null when picker isn't open). Tracks the
  // currently arrow-key-highlighted ticket so Up/Down/Enter can drive it.
  let pickerState = null;

  function confirmPickerSelection() {
    if (!pickerState) return;
    const { tickets, selectedIndex, box } = pickerState;
    const t = tickets[selectedIndex];
    const spaceId = getSpaceId();
    const index = nextIndexForToday(spaceId);
    insertIntoCompose(box, buildForwardText(t, index));
    applyReferenceLineFormatting(box, referenceLineText(t, index), t.url);
    GM_setValue(PENDING_CONFIRM_PREFIX + spaceId, {
      index,
      country: t.country,
      device: t.device,
      productName: t.productName,
      asin: t.asin,
      url: t.url,
      awaiting: true,
      setAt: Date.now(),
    });
    removeBar();
  }

  function highlightPickerSelection() {
    if (!pickerState) return;
    const items = document.querySelectorAll(`#${BAR_ID} .grs-item`);
    items.forEach((el, i) => {
      el.classList.toggle("grs-item-default", i === pickerState.selectedIndex);
    });
    const active = items[pickerState.selectedIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function showTicketPicker() {
    const box = getComposeBox();
    if (!box) return;

    const tickets = GM_getValue(RECENT_TICKETS_KEY, []);
    if (!tickets.length) {
      renderStatus(box, "No recent tickets — open a Zendesk ticket first", "grs-error");
      setTimeout(removeBar, 3500);
      return;
    }

    removeBar();
    pickerState = { tickets, selectedIndex: 0, box };

    const bar = document.createElement("div");
    bar.id = BAR_ID;
    const panel = document.createElement("div");
    panel.className = "grs-panel";

    const title = document.createElement("div");
    title.className = "grs-panel-title";
    title.textContent = "Forward which ticket? (↑↓ to browse, Enter to pick)";
    panel.appendChild(title);

    tickets.forEach((t, i) => {
      const item = document.createElement("div");
      item.className = "grs-item" + (i === 0 ? " grs-item-default" : "");
      const subject = document.createElement("div");
      subject.className = "grs-item-subject";
      subject.textContent = `#${t.id} — ${t.subject}`;
      const meta = document.createElement("div");
      meta.className = "grs-item-meta";
      meta.textContent = `${t.country || "?"} · ${t.device || "?"} · ${t.productName || "?"} · ${t.asin || "?"} · ${relativeTime(t.visitedAt)}`;
      item.appendChild(subject);
      item.appendChild(meta);
      item.addEventListener("click", () => {
        if (pickerState) pickerState.selectedIndex = i;
        confirmPickerSelection();
      });
      panel.appendChild(item);
    });

    bar.appendChild(panel);
    document.body.appendChild(bar);
    positionBarAbove(box, bar);
  }

  function showConfirmSuggestion(pending, defaultSender) {
    const box = getComposeBox();
    if (!box) return;

    removeBar();
    const bar = document.createElement("div");
    bar.id = BAR_ID;

    const senders = getRecentSenders();
    const names = defaultSender && !senders.includes(defaultSender) ? [defaultSender, ...senders] : senders;

    const row = document.createElement("div");
    row.className = "grs-row";
    (names.length ? names : [defaultSender || "(name)"]).slice(0, 4).forEach((name) => {
      const chip = document.createElement("div");
      chip.className = "grs-chip";
      chip.textContent = `Reply as confirm to: ${name}`;
      chip.title = buildConfirmText(name, pending);
      chip.addEventListener("click", () => {
        insertIntoCompose(box, buildConfirmText(name, pending));
        applyReferenceLineFormatting(box, referenceLineText(pending, pending.index), pending.url);
        GM_setValue(PENDING_CONFIRM_PREFIX + getSpaceId(), { ...pending, awaiting: false });
        removeBar();
      });
      row.appendChild(chip);
    });
    bar.appendChild(row);
    document.body.appendChild(bar);
    positionBarAbove(box, bar);
  }

  // Watches for a new incoming message while a forward is pending
  // confirmation in a template room, and offers the confirm-reply chip.
  function setupPendingConfirmWatcher() {
    const main = document.querySelector('[role="main"]');
    if (!main) return;

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (!isTemplateRoom()) return;
      const pending = GM_getValue(PENDING_CONFIRM_PREFIX + getSpaceId(), null);
      if (!pending || !pending.awaiting) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const senders = getRecentSenders(1);
        const latestSender = senders[0] || "";
        showConfirmSuggestion(pending, latestSender);
      }, 800);
    });
    observer.observe(main, { childList: true, subtree: true });
  }

  function requestSuggestions() {
    // Self-service room-ID discovery: to add a new template room, open it,
    // press Option+G once, then check this log line and copy the id into
    // TEMPLATE_ROOM_IDS above.
    console.log(`[GChat Reply Suggest] space id: ${getSpaceId()} | name: ${getRoomName()} | isTemplateRoom: ${isTemplateRoom()}`);

    if (isTemplateRoom()) {
      showTicketPicker();
    } else {
      requestAiSuggestions();
    }
  }

  function initChatSide() {
    document.addEventListener("keydown", (e) => {
      if (pickerState) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          pickerState.selectedIndex = Math.min(pickerState.selectedIndex + 1, pickerState.tickets.length - 1);
          highlightPickerSelection();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          pickerState.selectedIndex = Math.max(pickerState.selectedIndex - 1, 0);
          highlightPickerSelection();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          confirmPickerSelection();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          removeBar();
          return;
        }
      }

      // Use e.code (physical key), not e.key: on Mac, Option+G produces "©"
      // as e.key (dead-key/diacritic composition), not the letter "g".
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        requestSuggestions();
      }
      if (e.key === "Escape") removeBar();
    });

    // [role="main"] renders after the conversation loads; retry briefly.
    let tries = 0;
    const tryObserve = setInterval(() => {
      tries++;
      if (document.querySelector('[role="main"]')) {
        setupPendingConfirmWatcher();
        clearInterval(tryObserve);
      } else if (tries > 40) {
        clearInterval(tryObserve);
      }
    }, 500);
  }

  // =====================================================================
  // ENTRY POINT
  // =====================================================================
  if (location.hostname === "chat.google.com") {
    initChatSide();
  } else if (location.hostname === "spigenhelp.zendesk.com") {
    recordCurrentTicket();
  }
})();

// ==UserScript==
// @name         GChat Reply Suggest
// @namespace    https://spigen.com/gcx
// @version      2.0.0
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

  // Rooms (Chat "space" title, whitespace-insensitive match) that get the
  // deterministic ticket-forward template instead of AI-suggested replies.
  // Add more room names here as needed.
  const TEMPLATE_ROOMS = ["GCX전략xADS3", "Private"];

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

  function normalizeRoomName(s) {
    return (s || "").replace(/\s+/g, "").trim();
  }

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

  function getRoomName() {
    return (document.title || "").replace(/\s*-\s*Chat\s*$/, "").trim();
  }

  function isTemplateRoom() {
    const current = normalizeRoomName(getRoomName());
    return TEMPLATE_ROOMS.some((r) => normalizeRoomName(r) === current);
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
  function referenceLine(t, index) {
    return `${index} ${t.country} ${t.device}용 ${t.productName} [${t.asin}]\n${t.url}`;
  }

  function buildForwardText(t, index) {
    // Zendesk's own option labels sometimes already carry parens (e.g.
    // "(Urgent)_리스팅오류") — strip a wrapping pair so we don't double up.
    const reason = (t.inquiryReason || "문의").trim().replace(/^\((.*)\)$/, "$1");
    return `안녕하세요 프로님, 담당하시는 제품 관련 (${reason}) 문의가 들어와 전달드립니다. 확인 후 회신해 주시면 감사하겠습니다!\n\n${referenceLine(t, index)}`;
  }

  function buildConfirmText(senderName, pending) {
    return `@${senderName} 확인 감사합니다 프로님. 주신 답변 확인 후 처리하도록 하겠습니다!\n\n${referenceLine(pending, pending.index)}`;
  }

  function nextIndexForToday(room) {
    const key = DAILY_INDEX_PREFIX + normalizeRoomName(room) + "_" + todayKST();
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
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    const panel = document.createElement("div");
    panel.className = "grs-panel";

    const title = document.createElement("div");
    title.className = "grs-panel-title";
    title.textContent = "Forward which ticket? (most recent pre-highlighted)";
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
        const room = getRoomName();
        const index = nextIndexForToday(room);
        insertIntoCompose(box, buildForwardText(t, index));
        GM_setValue(PENDING_CONFIRM_PREFIX + normalizeRoomName(room), {
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
        const room = getRoomName();
        GM_setValue(PENDING_CONFIRM_PREFIX + normalizeRoomName(room), { ...pending, awaiting: false });
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
      const room = getRoomName();
      const pending = GM_getValue(PENDING_CONFIRM_PREFIX + normalizeRoomName(room), null);
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
    if (isTemplateRoom()) {
      showTicketPicker();
    } else {
      requestAiSuggestions();
    }
  }

  function initChatSide() {
    document.addEventListener("keydown", (e) => {
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

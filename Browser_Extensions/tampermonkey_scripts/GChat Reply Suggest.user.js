// ==UserScript==
// @name         GChat Reply Suggest
// @namespace    https://spigen.com/gcx
// @version      1.0.1
// @description  Alt+G suggests 3 AI reply sentences for the current Google Chat conversation, via a local Claude CLI backend
// @author       Spigen GCX
// @updateURL    https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/Browser_Extensions/tampermonkey_scripts/GChat%20Reply%20Suggest.user.js
// @downloadURL  https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/Browser_Extensions/tampermonkey_scripts/GChat%20Reply%20Suggest.user.js
// @match        https://chat.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const BACKEND_URL = "http://127.0.0.1:8765/suggest";
  const TRANSCRIPT_CHAR_LIMIT = 2000;
  const BAR_ID = "gchat-reply-suggest-bar";

  GM_addStyle(`
    #${BAR_ID} {
      position: fixed;
      z-index: 999999;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px;
      max-width: 640px;
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
  `);

  function getComposeBox() {
    const boxes = Array.from(
      document.querySelectorAll('[role="textbox"][contenteditable="true"]')
    ).filter((el) => el.offsetParent !== null);
    return boxes.length ? boxes[boxes.length - 1] : null;
  }

  function getTranscriptTail() {
    const main = document.querySelector('[role="main"]');
    if (!main) return "";
    const text = (main.innerText || "").trim();
    return text.slice(-TRANSCRIPT_CHAR_LIMIT);
  }

  function removeBar() {
    const existing = document.getElementById(BAR_ID);
    if (existing) existing.remove();
  }

  function positionBarAbove(el, bar) {
    const rect = el.getBoundingClientRect();
    bar.style.left = `${Math.max(8, rect.left)}px`;
    bar.style.top = `${Math.max(8, rect.top - 44)}px`;
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
    suggestions.forEach((s) => {
      const chip = document.createElement("div");
      chip.className = "grs-chip";
      chip.textContent = s;
      chip.title = s;
      chip.addEventListener("click", () => {
        insertIntoCompose(box, s);
        removeBar();
      });
      bar.appendChild(chip);
    });
    document.body.appendChild(bar);
    positionBarAbove(box, bar);
  }

  function renderStatus(box, text, cls) {
    removeBar();
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    const chip = document.createElement("div");
    chip.className = `grs-chip ${cls}`;
    chip.textContent = text;
    bar.appendChild(chip);
    document.body.appendChild(bar);
    positionBarAbove(box, bar);
  }

  function requestSuggestions() {
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

  document.addEventListener("keydown", (e) => {
    // Use e.code (physical key), not e.key: on Mac, Option+G produces "©" as
    // e.key (dead-key/diacritic composition), not the letter "g".
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyG") {
      e.preventDefault();
      requestSuggestions();
    }
    if (e.key === "Escape") removeBar();
  });
})();

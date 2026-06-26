// ==UserScript==
// @name         GCX Reply
// @namespace    https://spigen.com/gcx
// @version      2.18.8
// @description  Amazon order data via GAS web app + Spigen product info + Zendesk auto-fill
// @author       Spigen GCX
// @updateURL    https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/GCX%20Reply.user.js
// @downloadURL  https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/GCX%20Reply.user.js
// @match        https://spigenhelp.zendesk.com/agent/tickets/*
// @match        https://spigenhelp.zendesk.com/agent/filters
// @match        https://spigenhelp.zendesk.com/agent/filters/*
// @match        https://*.zdusercontent.com/*
// @match        https://*.apps.zdusercontent.com/*
// @match        https://www.channelreply.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// ==/UserScript==

(function () {
  'use strict';

  // ── ChannelReply bridge (TEMPORARY) ────────────────────────────────────────
  // The "No response needed" button lives in ChannelReply's cross-origin app
  // iframe (*.zdusercontent.com), so the panel on the Zendesk page can't click
  // it directly. This script also loads inside that iframe; here (any non-top
  // frame) we listen for the panel's postMessage and click the real button,
  // re-broadcasting down the frame tree so nested app frames are reached too.
  // TODO: replace with a direct SP-API/SC status change once a path is found.
  if (window.top !== window.self) {
    const findNrnBtn_ = () => {
      // ChannelReply Angular attribute selectors (standard tickets)
      const byAttr = [...document.querySelectorAll(
        'a[ng-click*="noResponse"], a[ng-click*="NoResponse"], ' +
        'a[ng-click*="updateNoResponseNeeded"], a[ng-click*="updateNoResponse"], ' +
        'a.no-select, [ng-click*="noResponse"], [ng-click*="NoResponse"]'
      )].find(el => /no.?response.?needed/i.test((el.textContent || '').trim()));
      if (byAttr) return byAttr;
      // Text-based fallback — catches ABM and other ChannelReply button variants
      return [...document.querySelectorAll('a, button, [role="button"], li, [class*="action"]')]
        .find(el => /no.?response.?needed/i.test((el.textContent || '').trim()));
    };
    const shown_ = el => !!el && getComputedStyle(el).display !== 'none';
    // "Actionable" = ChannelReply still shows the "Mark as …" span (not yet marked).
    // Lenient: only treat as NOT actionable when the "No response needed" (done)
    // span is the one visible; anything ambiguous defaults to actionable.
    const actionable_ = a => {
      if (!a) return false;
      const nm = a.querySelector('.not-marked-as-no-response-text');
      const m  = a.querySelector('.marked-as-no-response-text');
      if (nm || m) { if (shown_(m) && !shown_(nm)) return false; return true; }
      if (a.getAttribute('aria-disabled') === 'true' || a.classList.contains('disabled')) return false;
      // ABM/generic: check if a sibling "marked" state indicator is visible
      const container = a.closest('[class*="action"], [class*="response"], li, td');
      if (container) {
        const marked = container.querySelector('[class*="marked"], [class*="completed"], [class*="done"]');
        if (marked && shown_(marked)) return false;
      }
      return true;
    };
    const cascade_ = msg => [...document.querySelectorAll('iframe')].forEach(f => {
      try { f.contentWindow.postMessage(msg, '*'); } catch (_) {}
    });
    // Push state proactively — don't wait for a query that may never arrive if
    // this frame is nested behind an intermediate frame the top window can't reach.
    const sendState_ = () => {
      const a = findNrnBtn_();
      // Only the frame that actually has the NRN button should speak — silence
      // means "not my business" (wrapper frames, non-ABM tickets).  Sending
      // found:false from every frame causes button to blink between states.
      if (!a) return;
      try { window.top.postMessage({ __gcxNRN: 'state', found: true, actionable: actionable_(a) }, '*'); } catch (_) {}
    };
    const hello_ = () => { try { window.top.postMessage({ __gcxNRN: 'hello', href: (location.href || '').slice(0, 90), hasBtn: !!findNrnBtn_() }, '*'); } catch (_) {} };

    window.addEventListener('message', ev => {
      const d = ev.data;
      if (!d || !d.__gcxNRN) return;

      if (d.__gcxNRN === 'query') {
        cascade_({ __gcxNRN: 'query' });
        sendState_(); // always reply, even if found:false
        return;
      }

      if (d.__gcxNRN === 'click') {
        cascade_({ __gcxNRN: 'click' });
        let tries = 0;
        (function tick() {
          const a = findNrnBtn_();
          if (a) {
            if (actionable_(a)) {
              // ChannelReply uses AngularJS — ng-click requires $apply to run the
              // handler; a plain link.click() only dispatches a DOM event without
              // triggering the Angular digest cycle.
              let clicked = false;
              try {
                if (typeof angular !== 'undefined') {
                  const scope = angular.element(a).scope();
                  const expr  = a.getAttribute('ng-click');
                  if (scope && expr) { scope.$apply(expr); clicked = true; }
                }
              } catch (_) {}
              if (!clicked) a.click(); // plain fallback (non-Angular pages)
              try { window.top.postMessage({ __gcxNRN: 'done', ok: true }, '*'); } catch (_) {}
            } else {
              try { window.top.postMessage({ __gcxNRN: 'done', ok: false, reason: 'not-actionable' }, '*'); } catch (_) {}
            }
          } else if (++tries < 12) {
            setTimeout(tick, 200);
          }
        })();
      }
    });
    // Announce + push state immediately, then periodically so Angular's async
    // render of the NRN element is caught even if query messages never arrive.
    hello_();
    sendState_();
    [800, 2000, 4000].forEach(ms => { setTimeout(hello_, ms); setTimeout(sendState_, ms); });
    setInterval(sendState_, 3000);
    return; // never build the floating panel inside an app iframe
  }

  const GAS_URL    = 'https://script.google.com/macros/s/AKfycbw2Vdwk197LXB6oUAzuHS8sKamD5uqKZJDLvcHzbftWJk-M65XV1fAnTqiZo7ZEm4hk/exec';
  const SHEET_URL  = 'https://docs.google.com/spreadsheets/d/1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo/edit?gid=0#gid=0';
  const ORDER_RE   = /\b(\d{3}-\d{7}-\d{7})\b/g;
  const ASIN_RE    = /\b(B[A-Z0-9]{9})\b/g;
  const PANEL_ID   = 'sp-order-panel';
  const SHEET_COLS = ['SKU', '모델명', '브랜드', '제조사명', '기종명', '색상명', '대분류', '생산업체', '원산지정보'];

  // One-click copy button appended to each value row (no drag + Cmd+C needed).
  const COPY_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const COPY_BTN = `<button class="sp-copy" title="Copy" tabindex="-1" aria-label="Copy">${COPY_SVG}</button>`;

  // ── Zendesk custom field IDs ─────────────────────────────────────────────
  const ZD = {
    ORDER_ID:      360021934132,
    ASIN:          360021934312,
    SKU:           900008676703,
    CUST_NAME:     360021999951,
    ORDER_STATUS:  360021934152,
    ORDER_TOTAL:   360021934172,
    DELIVERY_LVL:  900003828503,
    PURCHASE_DATE: 360019586172,
    COUNTRY:       4513936822297,
    FULFILLMENT:   900002781823,
    POINT_OF_PUR:  20016270875033,
    DEVICE:        360022185671,
    PRODUCT_NAME:  360022185891,
    BRAND_DETAIL:  5495572594201,
    PHOTO_EXIST:   26936618247577,
    TOTAL_ORDERS:  21714421937305,
    TOTAL_REFUNDS: 21745453864345,
    SPIGEN_REFUND: 21745465897369,
    DAEBUNRYU:     58529165213721,
    SAENGSAN:      58529176884761,
    ORIGIN_INFO:   58529167605273,
  };

  const COUNTRY_MAP = {
    US:'us', GB:'uk', DE:'de', FR:'fr', IT:'it', ES:'es', JP:'jp',
    NL:'nl', SE:'se', IE:'ie', PL:'pl', TR:'tr', BE:'be', IN:'in',
    SG:'sg', AU:'au', CA:'ca', MX:'mx', KR:'kr',
  };

  const FULFILLMENT_MAP = { AFN: 'fba', MFN: 'merchant__fbm_' };
  const SCRIPT_VER = (typeof GM_info !== 'undefined' ? GM_info?.script?.version : null) || '2.16.9';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Module state ─────────────────────────────────────────────────────────
  let lastOrderData    = null;
  let lastProductData  = null;
  let _panelSession    = 0; // incremented on every resetPanel(); guards stale async callbacks
  let _productReady    = false; // true once product lookup finishes (or is determined impossible)
  let _gcrFilledThisTicket = false; // true after Auto-Fill confirmed & submitted on current ticket
  let _panelEl         = null; // live reference to the panel (survives React detaching it when docked)

  // ── UI state persistence ──────────────────────────────────────────────────
  function loadUi() {
    try { return JSON.parse(localStorage.getItem('gcx_ui') || '{}'); } catch { return {}; }
  }
  function saveUi(patch) {
    try { localStorage.setItem('gcx_ui', JSON.stringify(Object.assign(loadUi(), patch))); } catch {}
  }
  function applySectionState(container) {
    const c = loadUi().collapsed || {};
    container.querySelectorAll('[data-sp-section]').forEach(block => {
      const key = block.dataset.spSection;
      if (!(key in c)) return;
      if (c[key]) block.classList.add('collapsed');
      else block.classList.remove('collapsed');
    });
  }

  // ── Data fetch toggle preferences ──────────────────────────────────────────
  function getDataFetchPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem('gcx_data_fetch_prefs') || '{}');
      return {
        fetchOrder: prefs.fetchOrder !== false,
        fetchShipping: prefs.fetchShipping !== false,
        fetchProduct: prefs.fetchProduct !== false,
      };
    } catch { return { fetchOrder: true, fetchShipping: true, fetchProduct: true }; }
  }
  function saveDataFetchPrefs(prefs) {
    try { localStorage.setItem('gcx_data_fetch_prefs', JSON.stringify(prefs)); } catch {}
  }
  let lastAmazonProduct = null;
  let lastAiReason      = null;

  // ── Zendesk API: read order ID + ASIN from ticket custom fields ──────────
  function getTicketFields(cb) {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    if (!m) return cb(null, null, []);
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${m[1]}.json`,
      onload(res) {
        if (res.status !== 200) return cb(null, null, []);
        try {
          const ticket  = JSON.parse(res.responseText).ticket || {};
          const fields  = ticket.custom_fields || [];
          const vals    = fields.map(f => String(f.value || ''));
          const orderId = vals.find(v => /^\d{3}-\d{7}-\d{7}$/.test(v)) || null;
          const asin    = vals.find(v => /^B[A-Z0-9]{9}$/.test(v)) || null;
          // Also scan the customer message body for order IDs
          const desc    = ticket.description || '';
          const bodyIds = [...new Set([...desc.matchAll(/\b(\d{3}-\d{7}-\d{7})\b/g)].map(x => x[1]))];
          cb(orderId, asin, bodyIds);
        } catch { cb(null, null, []); }
      },
      onerror() { cb(null, null, []); },
    });
  }

  // ── Auto-fill helpers ────────────────────────────────────────────────────

  function salesChannelToPOP(ch) {
    if (!ch) return null;
    const s = ch.toLowerCase();
    if (s.includes('.co.uk'))  return 'amazon_united_kingdom';
    if (s.includes('.co.jp'))  return 'amazon_japan';
    if (s.includes('.com.sg')) return 'amazon_singapore';
    if (s.includes('.in'))     return 'amazon_india';
    if (s.includes('.de') || s.includes('.fr') || s.includes('.it') ||
        s.includes('.es') || s.includes('.nl')) return 'amazon_eu';
    return 'others';
  }

  const COUNTRY_SC = {
    DE:'amazon.de', FR:'amazon.fr', IT:'amazon.it', ES:'amazon.es',
    NL:'amazon.nl', PL:'amazon.pl', SE:'amazon.se', BE:'amazon.be',
    GB:'amazon.co.uk', JP:'amazon.co.jp', IN:'amazon.in',
    SG:'amazon.com.sg', AU:'amazon.com.au', CA:'amazon.ca',
    MX:'amazon.com.mx', TR:'amazon.com.tr', US:'amazon.com',
  };

  function sellerCentralUrl(orderId, salesChannel, countryCode) {
    if (!orderId) return null;
    const domain = salesChannel ? salesChannel.toLowerCase()
      : (countryCode ? (COUNTRY_SC[countryCode] || null) : null);
    return domain ? `https://sellercentral.${domain}/orders-v3/order/${orderId}` : null;
  }

  // Build Seller Central buyer order history search URL (last 2 years)
  function sellerCentralSearchUrl_(salesChannel, countryCode, buyerEmail) {
    if (!buyerEmail) return null;
    const domain = salesChannel ? salesChannel.toLowerCase()
      : (countryCode ? (COUNTRY_SC[countryCode] || null) : null);
    if (!domain) return null;
    const now         = Date.now();
    const twoYearsAgo = Math.round(now - 2 * 365.25 * 24 * 3600 * 1000);
    return `https://sellercentral.${domain}/orders-v3/search?qt=email&q=${encodeURIComponent(buyerEmail)}&date-range=${twoYearsAgo}-${now}`;
  }

  // Derive amazon.XX domain from order SalesChannel / CountryCode
  function amazonDomain_(salesChannel, countryCode) {
    if (salesChannel) return salesChannel.toLowerCase(); // "amazon.in", "amazon.co.jp", etc.
    return countryCode ? (COUNTRY_SC[countryCode] || 'amazon.com') : 'amazon.com';
  }

  // Try to extract Spigen model name from product title
  // "Spigen Liquid Air | iPhone 15 Case"   → "Liquid Air"
  // "Spigen Case for iPhone 15 Liquid Air Case..." → "Liquid Air"
  function modelFromTitle_(title) {
    if (!title) return '';
    // Pattern 1: "Brand Model | Device ..." — model between brand and pipe
    const pipeMatch = title.match(/^[A-Za-z]+\s+(.+?)\s+[|｜]/);
    if (pipeMatch && !/^(case|cover|protector|glass|film)/i.test(pipeMatch[1]))
      return pipeMatch[1].trim();
    // Pattern 2: strip "Spigen (Case|Cover) for" prefix, then strip device name, grab until next Case/Cover
    const noBrand = title.replace(/^[A-Za-z]+\s+/i, '').replace(/^(?:Case|Cover)\s+for\s+/i, '');
    const devStrip = noBrand.replace(
      /^(?:for\s+)?(?:iPhone|Samsung(?:\s+Galaxy)?|Galaxy|Google\s+Pixel|Pixel|iPad|Huawei|Xiaomi|OnePlus|LG)\s+[\w\s]*?(?=\b[A-Z][a-z])/,
      ''
    );
    const modelMatch = devStrip.match(/^([A-Z][^\|]+?)\s+(?:Case|Cover|Protector|Glass|Film|Screen)\b/i);
    if (modelMatch) return modelMatch[1].trim();
    return '';
  }

  // Parse Amazon product page static HTML → sheet-column-shaped object.
  // Handles both tech-spec table (amazon.in/com) and po-* overview rows (amazon.de etc.)
  function parseAmazonPage_(doc) {
    const spec = {};

    // Tech spec table — amazon.com, amazon.in, amazon.co.jp (with ?language=en_GB)
    doc.querySelectorAll(
      '#productDetails_techSpec_section_1 tr, #productDetails_db_sections tr, .prodDetTable tr'
    ).forEach(tr => {
      const k = tr.querySelector('th')?.textContent?.trim();
      const v = tr.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim();
      if (k && v) spec[k] = v;
    });

    // Product overview rows — amazon.de, amazon.fr, etc. (after ?language=en_GB → English keys)
    doc.querySelectorAll('tr[class*="po-"]').forEach(row => {
      const k = row.querySelector('.a-span3 span, td:first-child span')?.textContent?.trim();
      const v = row.querySelector('.a-span9 span, td:last-child span')?.textContent?.trim();
      if (k && v) spec[k] = v;
    });

    const title = doc.querySelector('#productTitle')?.textContent?.trim() || '';
    const mfr   = (spec['Manufacturer'] || '').split('/')[0].replace(/,.*$/, '').trim();

    return {
      _title:   title,   // full Amazon product page title (#productTitle)
      SKU:      spec['Model Number']                                              || '',
      '모델명':  spec['Model Name']  || modelFromTitle_(title)                   || '',
      '브랜드':  spec['Brand Name']  || spec['Brand']                            || 'Spigen',
      '제조사명': mfr,
      '기종명':  spec['Compatible Phone Models'] || spec['Compatible phone models'] ||
                 spec['Compatible Devices']      || spec['Compatible devices']      || '',
      '색상명':  spec['Colour'] || spec['Color']                                 || '',
      '대분류':  spec['Form Factor'] || spec['Item Type Name']                   || '',
      '생산업체': mfr,
      '원산지정보': spec['Country of Origin'] || spec['Country of origin']       || '',
    };
  }

  // Fetch amazon.XX/dp/{asin} HTML and parse product info; cb(product|null, pageUrl)
  // Falls back through: order's marketplace → amazon.co.jp → amazon.com
  function fetchAmazonProduct_(asin, cb) {
    const primaryDomain = amazonDomain_(lastOrderData?.order?.SalesChannel, lastOrderData?.address?.CountryCode);
    const primaryUrl    = `https://www.${primaryDomain}/dp/${asin}`;

    const fallbacks = [primaryDomain];
    if (!fallbacks.includes('amazon.co.jp')) fallbacks.push('amazon.co.jp');
    if (!fallbacks.includes('amazon.com'))   fallbacks.push('amazon.com');

    function tryDomain(idx) {
      if (idx >= fallbacks.length) return cb(null, primaryUrl);
      const domain    = fallbacks[idx];
      const langParam = domain === 'amazon.com' ? '' : '?language=en_GB';
      const url       = `https://www.${domain}/dp/${asin}${langParam}`;
      GM_xmlhttpRequest({
        method:   'GET',
        url,
        headers:  { 'Accept-Language': 'en-GB,en;q=0.9', 'Accept': 'text/html' },
        redirect: 'follow',
        timeout:  20000,
        onload(res) {
          if (res.status !== 200) return tryDomain(idx + 1);
          try {
            const doc     = new DOMParser().parseFromString(res.responseText, 'text/html');
            const product = parseAmazonPage_(doc);
            if (Object.values(product).some(v => v)) return cb(product, url);
            tryDomain(idx + 1);
          } catch { tryDomain(idx + 1); }
        },
        onerror()   { tryDomain(idx + 1); },
        ontimeout() { tryDomain(idx + 1); },
      });
    }

    tryDomain(0);
  }

  // Normalize label text: strip ★ * ( ) . and trim, lowercase
  function normLabel(s) {
    return s.replace(/[^가-힣a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Fill a Zendesk React-controlled text/date input by label text
  function fillZdInput(labelText, value) {
    if (!value) return false;
    const needle = normLabel(labelText);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl && normLabel(lbl.textContent).startsWith(needle)) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  }

  // All Zendesk text/date field labels that GCX Reply ever writes via fillZdInput.
  // Used by clearAllZdFields_() to wipe React state on ticket navigation so stale
  // values from a previous ticket never get submitted when the agent marks Solved/Pending.
  const ZD_TEXT_FIELD_LABELS = [
    'Order ID', 'ASIN', '문의SKU', 'Customer Full Name', 'Purchase Date',
    'Order Status', 'Order Total', 'Delivery Level', '대분류', '생산업체', '원산지정보',
  ];

  function clearAllZdFields_() {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const needle_list = ZD_TEXT_FIELD_LABELS.map(normLabel);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      if (!input.value) continue; // already empty — skip
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl) {
          const t = normLabel(lbl.textContent);
          if (needle_list.some(n => t.startsWith(n))) {
            setter.call(input, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            break;
          }
        }
      }
    }
  }

  // Read the current value of a Zendesk React text/date input by label text
  function readZdInput_(labelText) {
    const needle = normLabel(labelText);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl && normLabel(lbl.textContent).startsWith(needle)) return input.value || '';
      }
    }
    return '';
  }

  // Returns the actual DOM label text for the ZD field whose label starts with `labelPrefix`.
  function resolveZdLabel_(labelPrefix) {
    const needle = normLabel(labelPrefix);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl && normLabel(lbl.textContent).startsWith(needle)) return lbl.textContent.trim();
      }
    }
    return null;
  }

  // Fetch Zendesk field options (for Device / Product Name matching)
  function fetchZdFieldOpts(fieldId, cb) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/ticket_fields/${fieldId}.json`,
      onload(res) {
        try { cb(JSON.parse(res.responseText).ticket_field?.custom_field_options || []); }
        catch { cb([]); }
      },
      onerror() { cb([]); },
    });
  }

  // Tokenize: split camelCase + letter↔digit boundaries, lowercase, strip dots/specials.
  // Letter↔digit split ensures "Fold7"→"Fold 7" and "Flip7"→"Flip 7" match dropdown options.
  function tokenize_(s) {
    return s.replace(/([a-z])([A-Z])/g, '$1 $2')      // camelCase: "MagFit" → "Mag Fit"
            .replace(/([a-zA-Z])(\d)/g, '$1 $2')       // letter→digit: "Fold7" → "Fold 7"
            .replace(/(\d)([a-zA-Z])/g, '$1 $2')       // digit→letter: "7Pro" → "7 Pro"
            .toLowerCase().replace(/\./g, '').replace(/[^a-z0-9가-힣]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  }

  // Jaccard similarity between two token arrays (set-based)
  function jaccard_(a, b) {
    const sa = new Set(a), sb = new Set(b);
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    const union = sa.size + sb.size - inter;
    return union ? inter / union : 0;
  }

  // Find the best-matching Product Name dropdown option.
  // Strips brand/category prefix before "_" (SP_, CYRILL_, (New Biz)_) before scoring.
  function bestMatchOptVal(opts, label, stripPrefix) {
    if (!label || !opts.length) return null;
    const labelToks = tokenize_(label);
    let bestVal = null, bestScore = 0;
    for (const o of opts) {
      const name  = stripPrefix ? o.name.replace(/^[^_]+_/, '') : o.name;
      const score = jaccard_(tokenize_(name), labelToks);
      if (score > bestScore) { bestScore = score; bestVal = o.value; }
    }
    return bestScore >= 0.5 ? bestVal : null;
  }

  // Find the best-matching Device dropdown option.
  // Handles "/" in 기종명 (e.g. "Series 11/10(42mm)") by treating "/" as a space so all
  // tokens are preserved. Among equally-scoring candidates, prefers the latest model
  // (highest leading version number). If the ticket text explicitly mentions one of the
  // candidates, that takes priority over the "latest" default.
  function bestDeviceOptVal(opts, label, ticketText) {
    if (!label || !opts.length) return null;
    const labelToks = tokenize_(label.replace(/\//g, ' '));
    let maxScore = 0;
    const scored = opts.map(o => {
      const score = jaccard_(tokenize_(o.name), labelToks);
      if (score > maxScore) maxScore = score;
      return { val: o.value, name: o.name, score };
    });
    if (maxScore < 0.25) return null;

    // Candidates within 95% of best score
    const top = scored.filter(c => c.score >= maxScore * 0.95);
    if (top.length === 1) return top[0].val;

    // If ticket text explicitly names one candidate (without size suffix), prefer it
    if (ticketText) {
      const t = ticketText.toLowerCase();
      const mentioned = top.filter(c => {
        const base = c.name.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
        return base.length > 4 && t.includes(base);
      });
      if (mentioned.length === 1) return mentioned[0].val;
    }

    // Default: prefer highest leading version number (= most recent model)
    top.sort((a, b) => {
      const aVer = parseInt((a.name.match(/\d+/) || ['0'])[0]);
      const bVer = parseInt((b.name.match(/\d+/) || ['0'])[0]);
      return bVer - aVer;
    });
    return top[0].val;
  }

  // Map 대분류 value → Brand(상세) tagger tag, SP/CASE first
  function brandFromDaebunryu(d) {
    if (!d) return null;
    if (d.includes('보호필름'))                  return 'spigen_sp_';
    if (d === '휴대폰케이스')                    return 'spigen_case_';
    if (d.includes('차량'))                     return 'spigen_new_biz_';
    if (/래저|음향|워치|주변기기|거치대/.test(d)) return 'spigen_sda_';
    return null;
  }

  // Fetch ticket comments; cb(true) if any customer comment has image/video attachment
  function fetchTicketComments(ticketId, cb) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${ticketId}/comments.json?include=users`,
      onload(res) {
        if (res.status !== 200) return cb(false);
        try {
          const data     = JSON.parse(res.responseText);
          const comments = data.comments || [];
          const users    = data.users    || [];
          const agentIds = new Set(users.filter(u => u.role !== 'end-user').map(u => u.id));
          const hasPhoto = comments.some(c =>
            !agentIds.has(c.author_id) &&
            (c.attachments || []).some(a => /^(image|video)\//.test(a.content_type))
          );
          cb(hasPhoto);
        } catch { cb(false); }
      },
      onerror() { cb(false); },
    });
  }

  // ── Fill confirmation modal ──────────────────────────────────────────────

  function showFillConfirm_(rows, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.id = 'sp-fill-confirm-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2147483646',
      'display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const fillable = rows.filter(r => r.after);
    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff;border-radius:8px;padding:20px 24px 16px',
      'max-width:680px;width:94vw;max-height:82vh;overflow-y:auto',
      'box-shadow:0 8px 40px rgba(0,0,0,0.28);display:flex;flex-direction:column;gap:0',
    ].join(';');

    function esc_(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-weight:700;font-size:13px;color:#1f2d3d;">Confirm Auto-Fill</span>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#555;cursor:pointer;user-select:none;">
          <input type="checkbox" id="sp-chk-all" style="margin:0;cursor:pointer;" ${fillable.length ? 'checked' : ''}> Select all
        </label>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead>
          <tr style="border-bottom:2px solid #e4e8ed;">
            <th style="width:22px;padding:4px 6px;"></th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600;white-space:nowrap;">Field</th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600;min-width:130px;">Before</th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600;min-width:160px;">After</th>
          </tr>
        </thead>
        <tbody id="sp-confirm-tbody">
          ${rows.map((r, i) => {
            const hasBefore = r.before && r.before !== r.after;
            const noChange  = r.before && r.before === r.after;
            const rowStyle  = noChange ? 'opacity:0.5;' : '';
            const afterColor = r.after ? (noChange ? '#888' : '#1a6e3a') : '#aaa';
            return `<tr data-idx="${i}" style="border-bottom:1px solid #f2f4f7;${rowStyle}">
              <td style="padding:5px 6px;text-align:center;">
                <input type="checkbox" data-row="${i}" style="margin:0;cursor:pointer;"
                  ${r.after && !noChange ? 'checked' : ''} ${!r.after ? 'disabled' : ''}>
              </td>
              <td style="padding:5px 8px;font-weight:500;color:#1f2d3d;white-space:nowrap;">${esc_(r.label)}</td>
              <td style="padding:5px 8px;color:#999;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="${esc_(r.before)}">${esc_(r.before) || '<span style="color:#ccc">—</span>'}</td>
              <td style="padding:5px 8px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${afterColor};font-weight:${r.after && !noChange ? '600' : 'normal'};"
                  title="${esc_(r.after)}">${esc_(r.after) || '<span style="color:#ccc">—</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:1px solid #eef0f3;">
        <span id="sp-confirm-count" style="font-size:11px;color:#888;margin-right:auto;"></span>
        <button id="sp-confirm-cancel" style="padding:6px 16px;border:1px solid #d0d5dd;border-radius:5px;background:#fff;cursor:pointer;font-size:12px;color:#444;">Cancel</button>
        <button id="sp-confirm-ok" style="padding:6px 16px;border:none;border-radius:5px;background:#2a7a50;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Fill Selected</button>
      </div>`;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const allChk  = card.querySelector('#sp-chk-all');
    const countEl = card.querySelector('#sp-confirm-count');
    const rowChks = () => [...card.querySelectorAll('input[data-row]:not([disabled])')]

    function refreshCount() {
      const n = rowChks().filter(c => c.checked).length;
      countEl.textContent = `${n} field${n !== 1 ? 's' : ''} selected`;
      card.querySelector('#sp-confirm-ok').disabled = n === 0;
    }
    refreshCount();

    allChk.addEventListener('change', () => {
      rowChks().forEach(c => c.checked = allChk.checked);
      refreshCount();
    });
    card.querySelector('#sp-confirm-tbody').addEventListener('change', e => {
      if (!e.target.matches('input[data-row]')) return;
      const all = rowChks();
      const checkedCount = all.filter(c => c.checked).length;
      allChk.indeterminate = checkedCount > 0 && checkedCount < all.length;
      allChk.checked = checkedCount === all.length;
      refreshCount();
    });

    card.querySelector('#sp-confirm-cancel').addEventListener('click', () => {
      overlay.remove(); onCancel?.();
    });
    card.querySelector('#sp-confirm-ok').addEventListener('click', () => {
      const sel = new Set(rowChks().filter(c => c.checked).map(c => +c.dataset.row));
      overlay.remove();
      onConfirm(rows.filter((_, i) => sel.has(i)));
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); onCancel?.(); } });
  }

  // ── Auto-fill status helpers ─────────────────────────────────────────────

  function setFillStatus(panel, msg) {
    const el = panel?.querySelector('#sp-fill-status');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'inline' : 'none';
  }

  function maybeShowAutoFill(panel) {
    const bar = panel?.querySelector('#sp-autofill-bar');
    const btn = panel?.querySelector('#sp-autofill-btn');
    if (bar && lastOrderData) {
      bar.style.display = 'block';
      // Only touch button state when not mid-fill (Preparing… / Filling…)
      if (btn && btn.textContent !== 'Preparing…' && btn.textContent !== 'Filling…') {
        btn.disabled = !_productReady;
        btn.textContent = _productReady ? 'Auto-Fill Form' : 'Loading…';
        btn.title = _productReady ? '' : 'Product info still loading — please wait';
      }
    }
    const mcfBar = panel?.querySelector('#sp-mcf-bar');
    if (mcfBar && lastOrderData) mcfBar.style.display = 'block';
  }

  // ── MCF: 티켓 본문 읽기 ────────────────────────────────────────────────────
  function getTicketBodyText_() {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    const pane = (m && document.querySelector(`[data-test-id="ticket-${m[1]}-standard-layout"]`)) || document.body;
    const inputText = [...pane.querySelectorAll('input, textarea')].map(el => el.value || '').join('\n');
    return (pane.innerText || '') + '\n' + inputText;
  }

  // ── AI 인입사유용 텍스트 추출 (고객 메시지 + Spigen CS 요약) ─────────────────
  function getAiInputText_() {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    const ticketId = m?.[1];
    const pane = (ticketId && document.querySelector(`[data-test-id="ticket-${ticketId}-standard-layout"]`)) || document.body;

    // Priority 1: Zendesk comment body elements (avoids sidebar metadata)
    const commentEls = pane.querySelectorAll(
      '[data-test-id*="comment-body"], [data-test-id*="comment-viewer"], ' +
      '[data-test-id*="event-message"], [data-test-id*="rich-text"], ' +
      '.rich_text, [data-garden-id*="comment"], [class*="CommentContent"]'
    );
    if (commentEls.length > 0) {
      const texts = [...commentEls].map(el => el.innerText.trim()).filter(t => t.length > 20);
      if (texts.length > 0) {
        return texts.slice(0, 4).join('\n\n').slice(0, 2500);
      }
    }

    // Priority 2: Find CS summary then extract surrounding conversation
    const full = (pane.innerText || '').replace(/[ \t]+/g, ' ').trim();
    if (!full) return '';

    const CS_NAME = 'Spigen Customer Service';
    const csIdx   = full.indexOf(CS_NAME);

    if (csIdx !== -1) {
      // Take content immediately BEFORE CS comment (actual conversation, not sidebar start)
      const start       = Math.max(0, csIdx - 1200);
      const customerPart = full.slice(start, csIdx).trim();
      const csPart       = full.slice(csIdx + CS_NAME.length, csIdx + CS_NAME.length + 600).trim();
      return [customerPart, csPart ? `[CS요약]\n${csPart}` : ''].filter(Boolean).join('\n\n---\n\n').slice(0, 2500);
    }

    // Priority 3: Skip first ~600 chars (usually sidebar metadata) and take the rest
    return full.slice(600, 2600);
  }

  // ── MCF: 티켓 본문에서 고객 주소 파싱 (MCF Autofill parseClipboard와 동일 로직) ─
  const _MCF_PHONE_CC = {
    PT:'+351',ES:'+34',DE:'+49',FR:'+33',IT:'+39',NL:'+31',SE:'+46',FI:'+358',
    BE:'+32',AT:'+43',IE:'+353',PL:'+48',RO:'+40',HU:'+36',GR:'+30',CZ:'+420',
    SK:'+421',LT:'+370',LV:'+371',EE:'+372',MT:'+356',CY:'+357',SI:'+386',
    HR:'+385',BG:'+359',LU:'+352',DK:'+45',GB:'+44',US:'+1',CA:'+1',IN:'+91',JP:'+81',
  };
  function _mcfNormCountry(tok) {
    if (!tok) return '';
    const t = tok.trim();
    if (/^UK$/i.test(t) || /^United\s*Kingdom$/i.test(t) || /^Grande.Bretagne$/i.test(t)) return 'GB';
    if (/^DEU?$/i.test(t) || /^Germany$/i.test(t) || /^Deutschland$/i.test(t) || /^Allemagne$/i.test(t)) return 'DE';
    if (/^Espa/i.test(t) || /^Spain$/i.test(t)) return 'ES';
    if (/^Portugal/i.test(t)) return 'PT';
    if (/^France$/i.test(t) || /^Francia$/i.test(t)) return 'FR';
    if (/^Italy$/i.test(t) || /^Itali[ae]$/i.test(t) || /^Italie$/i.test(t)) return 'IT';
    if (/^Netherlands$/i.test(t) || /^Holland$/i.test(t) || /^Pays.Bas$/i.test(t)) return 'NL';
    if (/^Belgium$/i.test(t) || /^Belgique$/i.test(t) || /^Belgien$/i.test(t)) return 'BE';
    if (/^Sweden$/i.test(t) || /^Sverige$/i.test(t)) return 'SE';
    if (/^Poland$/i.test(t) || /^Polen$/i.test(t)) return 'PL';
    if (/^Austria$/i.test(t) || /^[OÖ]sterreich$/i.test(t)) return 'AT';
    if (/^Ireland$/i.test(t) || /^Irland$/i.test(t)) return 'IE';
    if (/^Denmark$/i.test(t) || /^D[äa]nemark$/i.test(t)) return 'DK';
    if (/^Finland$/i.test(t) || /^Finnland$/i.test(t)) return 'FI';
    if (/^Greece$/i.test(t) || /^Griechenland$/i.test(t)) return 'GR';
    if (/^Romania$/i.test(t) || /^Roumanie$/i.test(t)) return 'RO';
    if (/^Hungary$/i.test(t) || /^Ungarn$/i.test(t)) return 'HU';
    if (/^Czech/i.test(t) || /^Tschechien$/i.test(t)) return 'CZ';
    if (/^Slovenia$/i.test(t) || /^Slowenien$/i.test(t)) return 'SI';
    if (/^Slovakia$/i.test(t) || /^Slowakei$/i.test(t)) return 'SK';
    if (/^Croatia$/i.test(t) || /^Kroatien$/i.test(t)) return 'HR';
    if (/^Bulgaria$/i.test(t) || /^Bulgarie$/i.test(t)) return 'BG';
    if (/^Estonia$/i.test(t) || /^Estland$/i.test(t)) return 'EE';
    if (/^Latvia$/i.test(t) || /^Lettland$/i.test(t)) return 'LV';
    if (/^Lithuania$/i.test(t) || /^Litauen$/i.test(t)) return 'LT';
    if (/^Malta$/i.test(t)) return 'MT';
    if (/^Cyprus$/i.test(t) || /^Zypern$/i.test(t)) return 'CY';
    if (/^Luxembourg$/i.test(t)) return 'LU';
    if (/^India$/i.test(t) || /^Inde$/i.test(t)) return 'IN';
    if (/^Japan$/i.test(t) || /^日本$/.test(t)) return 'JP';
    if (/^United\s*States$/i.test(t) || /^USA?$/i.test(t)) return 'US';
    if (/^Canada$/i.test(t)) return 'CA';
    return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : '';
  }
  function parseTicketAddress_(txt) {
    if (!txt) return {};
    const t = txt.replace(/\r/g,'').replace(/[–—]/g,'-').replace(/ /g,' ').replace(/[ \t]+/g,' ').trim();
    const emailAll = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    const email = [...emailAll].reverse().find(e =>
      !/spigen\.com|zendesk\./i.test(e) &&
      !(/amazon\.(com|co\.uk|de|fr|es|it|nl|se)/i.test(e) && !/marketplace\.amazon\./i.test(e))
    ) || '';
    const asin = (t.match(/\bASIN\b[^\w]{0,5}(B[A-Z0-9]{9})\b/i) || [])[1] || '';
    const sku  = (t.match(/\bSKU\b[^\w]{0,5}([\w.-]{5,})/i) || [])[1] || '';
    let cRaw = (t.match(/Country\*?\s*[:\-：]\s*([^\n]+)/i) || [])[1]
            || (t.match(/^Country\*\n([A-Za-z]{2})\s*$/m) || [])[1]
            || (t.match(/국가\s*[:\-：]\s*([^\n]+)/i) || [])[1] || '';
    cRaw = cRaw.trim().replace(/\W+$/, '').trim();
    const blocks = [];
    let cur = null;
    const pushCur = () => { if (cur && Object.values(cur).some(Boolean)) blocks.push(cur); cur = null; };
    for (const line of t.split('\n').map(s => s.trim()).filter(Boolean)) {
      const m = line.match(/^\s*\(?(\d+)\)?[.)]\s*(.+)$/i);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      const val = m[2].trim().replace(/^(.+?):\s*/i,'').replace(/^(.+?)\s+--?\s*/i,'').trim();
      if (idx === 1) { pushCur(); cur = { name:'',street:'',city:'',state:'',postal:'',phone:'' }; }
      if (!cur) cur = { name:'',street:'',city:'',state:'',postal:'',phone:'' };
      if      (idx === 1) cur.name   = val;
      else if (idx === 2) cur.street = val;
      else if (idx === 3) cur.city   = val;
      else if (idx === 4) cur.state  = val;
      else if (idx === 5) cur.postal = val;
      else if (idx === 6) cur.phone  = val;
      if (idx === 6) pushCur();
    }
    pushCur();
    const addr = blocks.length ? blocks[blocks.length - 1] : {};
    const phoneCountry = Object.entries(_MCF_PHONE_CC).find(([, cc]) => (addr.phone || '').includes(cc))?.[0] || '';
    const country = _mcfNormCountry(cRaw) || phoneCountry;
    return {
      name:   addr.name   || '', street: addr.street || '', city:   addr.city   || '',
      state:  addr.state  || '', postal: addr.postal || '', phone:  addr.phone  || '',
      email, q: asin || sku, country,
    };
  }

  // ── MCF: 주문 API + 티켓 본문 주소를 합쳐 해시 페이로드 생성 ─────────────────
  function buildMcfPayload_(panelEl, emailOverride) {
    const o  = lastOrderData?.order   || {};
    const ad = lastOrderData?.address || {};
    const b  = lastOrderData?.buyer   || {};
    const itemAsins = (lastOrderData?.items || []).map(i => i.ASIN).filter(Boolean);
    const asin    = itemAsins[0] || panelEl?.querySelector('#sp-asin-input')?.value.trim() || '';
    const orderId = panelEl?.querySelector('#sp-order-input')?.value.trim() || '';
    // 고객이 티켓에 직접 쓴 주소가 주문 API 주소보다 우선 (MCF 배송지이므로)
    const ta = parseTicketAddress_(getTicketBodyText_());
    const country = ta.country || ad.CountryCode || '';
    return {
      name:    ta.name   || b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '',
      street:  ta.street || ad.AddressLine1 || '',
      city:    ta.city   || ad.City || '',
      state:   ta.state  || ad.StateOrRegion || '',
      postal:  ta.postal || ad.PostalCode || '',
      phone:   ta.phone  || ad.Phone || '',
      email:   emailOverride || ta.email  || b.BuyerEmail || '',
      country,
      asin:    ta.q || asin,
      orderId,
      region:  country === 'JP' ? 'JP' : 'global',
    };
  }

  // Customer context 탭에서 고객 이메일 추출.
  // 탭이 접혀 있으면 먼저 클릭해서 열고, 패널 텍스트에서 이메일을 뽑아낸다.
  async function getCustomerContextEmail_() {
    const EXCLUDE = /spigen\.com|zendesk\./i;
    function extractEmail_(el) {
      const text = (el && (el.textContent || el.innerText)) || '';
      const all = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
      return all.find(e => !EXCLUDE.test(e)) || '';
    }

    const btn = document.querySelector('[data-test-id="omnipanel-selector-item-customer-context"]');
    if (!btn) return '';

    if (btn.getAttribute('aria-pressed') !== 'true') {
      btn.click();
      await sleep(700);
    }

    // Try specific panel selectors first
    for (const sel of [
      '[data-test-id="customer-context-pane"]',
      '[data-test-id="omnipanel-content"]',
      '[data-garden-id="omnipanel.body"]',
      '[data-cy-test-element="customer-context-pane"]',
    ]) {
      const e = extractEmail_(document.querySelector(sel));
      if (e) return e;
    }

    // Walk up: button → span → li → ul → parent (omnipanel container)
    const container = btn.closest('ul')?.parentElement || btn.closest('[data-garden-id]')?.parentElement;
    const fromContainer = extractEmail_(container);
    if (fromContainer) return fromContainer;

    // Broadest fallback: right sidebar
    return extractEmail_(
      document.querySelector('[data-test-id="sidebar"]') ||
      document.querySelector('aside') ||
      document.querySelector('[role="complementary"]')
    );
  }

  async function sendToMCF(panel) {
    if (!lastOrderData) return;
    const status = panel.querySelector('#sp-mcf-status');
    const showSt = t => { if (status) { status.textContent = t; status.style.display = 'block'; } };

    showSt('고객 이메일 확인 중…');
    const ctxEmail = await getCustomerContextEmail_();

    const payload = buildMcfPayload_(panel, ctxEmail);
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    const _mcfW = window.open(getMcfBase_(payload.country) + '#spigen_mcf=' + encoded, '_blank');
    if (_mcfW) { try { _mcfW.name = 'spigen_mcf:' + encoded; } catch(e) {} }
    showSt('✓ MCF 탭 열림 — 자동입력 대기중');
    setTimeout(() => { if (status) status.style.display = 'none'; }, 4000);
  }

  // ── No Response Needed ────────────────────────────────────────────────────
  // ChannelReply renders inside a zdusercontent.com iframe (Zendesk app sandbox).
  // The NRN element only exists when 'Requested Channel type*' = Amazon Buyer Message.
  // Primary: iframe bridge (top-of-file code runs in CR iframe → postMessage).
  // Fallback: direct DOM search (for Zendesk configs that inline the app).
  function findNrnBtnDirect_() {
    // Primary: exact ChannelReply Angular selectors
    const cands = [...document.querySelectorAll(
      '.button-no-response-needed a.no-select, ' +
      'a[ng-click*="updateNoResponseNeeded"], ' +
      '[ng-click*="updateNoResponseNeeded"]'
    )].filter(el => !el.closest('#sp-order-panel') &&
                    /no.?response.?needed/i.test((el.textContent || '').trim()));
    // No text-only fallback: CR always runs in a cross-origin iframe so the main
    // page DOM will never contain a real NRN button.  A broad text scan caused
    // false positives (Zendesk macros / tooltips) that blocked the iframe bridge
    // from updating _lastBridgeAt, triggering the 8s silence timeout and blinking.
    return cands[0] || null;
  }

  function isNrnActionable_(a) {
    if (!a) return false;
    // Wrapper div gets class "marked-as-no-response" once marked
    const wrap = a.closest('.button-no-response-needed, [class*="no-response"]');
    if (wrap && wrap.classList.contains('marked-as-no-response')) return false;
    // Span visibility: .not-marked-as-no-response-text visible → actionable
    const nm = a.querySelector('.not-marked-as-no-response-text');
    const m  = a.querySelector('.marked-as-no-response-text');
    if (nm || m) {
      const vis = el => el && getComputedStyle(el).display !== 'none';
      if (vis(m) && !vis(nm)) return false;
    }
    return true;
  }

  function markNoResponseNeeded(panel) {
    const status = panel.querySelector('#sp-nrn-status');
    const show = (msg, color) => {
      if (!status) return;
      status.textContent = msg;
      status.style.color = color || '#27ae60';
      status.style.display = 'block';
      setTimeout(() => { status.style.display = 'none'; }, 4000);
    };

    // Try direct DOM first (Zendesk configs that inline the CR app)
    const el = findNrnBtnDirect_();
    if (el) {
      if (!isNrnActionable_(el)) {
        show('Already marked as No Response Needed', '#888');
        logStep_('NRN: already marked (direct DOM)');
        return;
      }
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      show('✓ Marked as "No response needed"');
      logStep_('NRN: clicked directly in page DOM');
      return;
    }

    // Iframe bridge (CR runs in zdusercontent.com sandbox)
    let acked = false;
    const onAck = ev => {
      if (!ev.data || ev.data.__gcxNRN !== 'done') return;
      acked = true;
      window.removeEventListener('message', onAck);
      if (ev.data.ok) {
        show('✓ Marked as "No response needed"');
        logStep_('NRN: marked via CR iframe bridge');
      } else {
        show(ev.data.reason === 'not-actionable' ? 'Already marked' : '✗ Failed', '#888');
        logStep_('NRN: iframe bridge — ' + (ev.data.reason || 'unknown'));
      }
    };
    window.addEventListener('message', onAck);
    // Send to the cached CR iframe directly (works even when it's nested behind
    // intermediate frames that don't cascade), plus broadcast to all direct children.
    const clickTargets = new Set([
      window.__gcxNrnSource,
      ...[...document.querySelectorAll('iframe')].map(f => { try { return f.contentWindow; } catch (_) { return null; } }),
    ].filter(Boolean));
    clickTargets.forEach(w => { try { w.postMessage({ __gcxNRN: 'click' }, '*'); } catch (_) {} });
    show('Marking…', '#888');
    logStep_('NRN: dispatching click to CR iframe…');
    setTimeout(() => {
      window.removeEventListener('message', onAck);
      if (!acked) show('✗ ChannelReply not responding', '#c0392b');
    }, 4000);
  }

  // ── Auto-fill: PUT all fields to Zendesk API, fill text fields in DOM ────

  function autoFillTicket(panel) {
    const ticketId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
    if (!ticketId || !lastOrderData) return;

    const btn = panel.querySelector('#sp-autofill-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    setFillStatus(panel, '');

    const o  = lastOrderData.order   || {};
    const ad = lastOrderData.address || {};
    const b  = lastOrderData.buyer   || {};
    const p  = lastProductData || {};

    const orderId   = panel.querySelector('#sp-order-input')?.value.trim() || '';
    const panelAsin = panel.querySelector('#sp-asin-input')?.value.trim()  || '';
    const itemAsins  = (lastOrderData.items || []).map(i => i.ASIN).filter(Boolean);
    const asinValue  = itemAsins.length ? itemAsins.join(', ') : panelAsin;
    const rawSellerSku = lastOrderData.items?.[0]?.SellerSKU || '';
    // Sheet SKU (p.SKU) always takes priority. Only accept rawSellerSku when it matches the
    // Spigen SKU pattern (3 uppercase letters + 5 digits, e.g. "ACH06437", "ACS06557PAN").
    // Rejects barcodes ("8809613760408"), model names ("PE2213IN 35w"), and non-Spigen codes ("PE2213IN").
    const itemSku = p.SKU || (!/^[A-Z]{3}\d{5}/.test(rawSellerSku) ? '' : rawSellerSku) || '';
    const totalPurchases = lastOrderData.totalPurchases ?? lastOrderData.orderCount;
    const totalRefunds   = lastOrderData.totalRefunds;
    const purchasesVal   = totalPurchases != null ? `q${Math.min(totalPurchases, 50)}` : null;
    const refundsVal     = totalRefunds   != null ? `q${Math.min(totalRefunds,   50)}` : null;
    const buyerName    = b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '';
    const orderTotal   = o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : '';
    const purchaseDateIso = purchaseDateLocal_(o.PurchaseDate, ad.CountryCode);
    const purchaseDateDom = purchaseDateIso
      ? new Date(purchaseDateIso + 'T00:00:00Z').toLocaleDateString('en-US',
          { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : '';
    const amz = lastAmazonProduct || {};
    const daebunryu  = p['대분류']     || amz['대분류']     || '';
    const saengsan   = p['생산업체']   || amz['생산업체']   || '';
    const originInfo = p['원산지정보'] || amz['원산지정보'] || '';
    const deviceLabel    = p['기종명'] || '';
    const productLabel   = p['모델명']  || '';
    const ticketText     = document.body.innerText || '';
    // PAN EU detection must check the raw SP-API SellerSKU (e.g. "ACS06557PAN"), NOT the
    // sheet SKU — the sheet stores the base SKU without the PAN/EUP suffix.
    const skuHasPan      = /pan|eup/i.test(rawSellerSku);
    const fulfillChannel = o.FulfillmentChannel || '';
    const brandTag       = brandFromDaebunryu(p['대분류'] || '');
    const pop            = salesChannelToPOP(o.SalesChannel);

    // DOM text-field rows — read current values for "before" column
    const DOM_DEFS = [
      { label: 'Order ID',           zdId: ZD.ORDER_ID,     after: orderId,           apiVal: orderId },
      { label: 'ASIN',               zdId: ZD.ASIN,         after: asinValue,          apiVal: asinValue },
      { label: '문의SKU',            zdId: ZD.SKU,          after: itemSku,            apiVal: itemSku },
      { label: 'Customer Full Name', zdId: ZD.CUST_NAME,    after: buyerName,          apiVal: buyerName },
      { label: 'Purchase Date',      zdId: ZD.PURCHASE_DATE,after: purchaseDateDom,    apiVal: purchaseDateIso, isDate: true },
      { label: 'Order Status',       zdId: ZD.ORDER_STATUS, after: o.OrderStatus||'',  apiVal: o.OrderStatus||'' },
      { label: 'Order Total',        zdId: ZD.ORDER_TOTAL,  after: orderTotal,         apiVal: orderTotal },
      { label: 'Delivery Level',     zdId: ZD.DELIVERY_LVL, after: o.ShipmentServiceLevelCategory||'', apiVal: o.ShipmentServiceLevelCategory||'' },
      { label: '대분류',             zdId: ZD.DAEBUNRYU,    after: daebunryu,          apiVal: daebunryu },
      { label: '생산업체',           zdId: ZD.SAENGSAN,     after: saengsan,           apiVal: saengsan },
      { label: '원산지정보',         zdId: ZD.ORIGIN_INFO,  after: originInfo,         apiVal: originInfo },
    ];
    const textRows = DOM_DEFS.map(d => ({
      label: resolveZdLabel_(d.label) || d.label, before: readZdInput_(d.label), after: d.after,
      dom: d, // carry definition for execution phase
    }));

    // Async-resolved rows (Device, Product Name, Fulfillment, Photo, API-only fields)
    let resolvedDevice   = null; // { val, name, opts }
    let resolvedProduct  = null; // { val, name }
    let resolvedFulfill  = null; // { val, name }
    let fulfillOpts      = [];   // all fulfillment opts — for before display name
    let resolvedHasPhoto = null;
    let currentCfMap     = {};   // fieldId → raw value from current ticket
    let ticketSubject    = '';   // captured from ticket JSON — used for invoice detection

    // Always fetch device opts (was conditional on deviceLabel); needed for invoice override
    let remain = 1 + (productLabel ? 1 : 0) + 3; // device + fulfillment + comments + ticket

    const BRAND_TAG_LABEL = {
      spigen_case_: 'CASE', spigen_sp_: 'SP', spigen_sda_: 'SDA',
      'spigen_pacc._': 'PAcc.', spigen_new_biz_: 'Newbiz', 'n/a': 'n/a',
    };

    function buildAndShow() {
      if (--remain > 0) return;

      // Invoice ticket override: if subject contains "invoice", force Device to the invoice option
      if (/invoice/i.test(ticketSubject) && resolvedDevice?.opts) {
        const invoiceOpt = resolvedDevice.opts.find(o => /invoice/i.test(o.name));
        if (invoiceOpt) resolvedDevice = { val: invoiceOpt.value, name: invoiceOpt.name, opts: resolvedDevice.opts };
      }

      // Refresh textRows "before" from ZD API (currentCfMap) — more reliable than DOM snapshot
      for (const row of textRows) {
        const cf = currentCfMap[row.dom.zdId];
        if (cf !== undefined) row.before = cf;
      }

      // API-only rows (no DOM text field counterpart)
      const apiOnlyRows = [
        { label: 'Device*', before: resolvedDevice?.opts?.find(o => o.value === currentCfMap[ZD.DEVICE])?.name || currentCfMap[ZD.DEVICE] || '',
          after: resolvedDevice?.name || '', api: resolvedDevice?.val ? { id: ZD.DEVICE, value: resolvedDevice.val } : null },
        { label: 'Product Name *', before: '', // resolved below using product opts
          after: resolvedProduct?.name || '', api: resolvedProduct?.val ? { id: ZD.PRODUCT_NAME, value: resolvedProduct.val } : null },
        { label: 'Country*',      before: currentCfMap[ZD.COUNTRY]     || '', after: COUNTRY_MAP[ad.CountryCode] || '', api: COUNTRY_MAP[ad.CountryCode] ? { id: ZD.COUNTRY, value: COUNTRY_MAP[ad.CountryCode] } : null },
        { label: 'Point of Purchase', before: currentCfMap[ZD.POINT_OF_PUR] || '', after: pop || '', api: pop ? { id: ZD.POINT_OF_PUR, value: pop } : null },
        { label: 'Amazon Fulfillment Methods*', before: fulfillOpts.find(o => o.value === currentCfMap[ZD.FULFILLMENT])?.name || currentCfMap[ZD.FULFILLMENT] || '', after: resolvedFulfill?.name || '', api: resolvedFulfill?.val ? { id: ZD.FULFILLMENT, value: resolvedFulfill.val } : null },
        { label: 'Brand(상세)*', before: BRAND_TAG_LABEL[currentCfMap[ZD.BRAND_DETAIL]] || currentCfMap[ZD.BRAND_DETAIL] || '', after: brandTag || '', api: brandTag ? { id: ZD.BRAND_DETAIL, value: brandTag } : null },
        { label: '✅전체 주문 (Product Issue, 아크테크X)*', before: currentCfMap[ZD.TOTAL_ORDERS]  || '', after: purchasesVal || '', api: purchasesVal ? { id: ZD.TOTAL_ORDERS, value: purchasesVal } : null },
        { label: '❎전체 환불*', before: currentCfMap[ZD.TOTAL_REFUNDS] || '', after: refundsVal || '', api: refundsVal ? { id: ZD.TOTAL_REFUNDS, value: refundsVal } : null },
        { label: '❗사진/영상 유무❗*', before: currentCfMap[ZD.PHOTO_EXIST] || '', after: resolvedHasPhoto != null ? (resolvedHasPhoto ? 'yes' : 'no') : '', api: resolvedHasPhoto != null ? { id: ZD.PHOTO_EXIST, value: resolvedHasPhoto ? 'yes' : 'no' } : null },
      ];

      // Resolve Product Name "before" using product opts
      const pnRow = apiOnlyRows.find(r => r.label === 'Product Name *');
      if (pnRow && resolvedProduct?.opts) {
        pnRow.before = resolvedProduct.opts.find(o => o.value === currentCfMap[ZD.PRODUCT_NAME])?.name?.replace(/^[^_]+_/, '') || currentCfMap[ZD.PRODUCT_NAME] || '';
      }

      const allRows = [...textRows, ...apiOnlyRows];

      if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }

      showFillConfirm_(allRows, selectedRows => {
        _gcrFilledThisTicket = true; // track that GCX Reply filled this ticket's fields
        if (btn) { btn.disabled = true; btn.textContent = 'Filling…'; }

        // DOM fills first
        let dispatchEsc = false;
        for (const r of selectedRows) {
          if (!r.dom) continue;
          fillZdInput(r.dom.label, r.dom.after);
          if (r.dom.isDate && r.dom.after) dispatchEsc = true;
        }
        if (dispatchEsc) {
          setTimeout(() => document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
          ), 150);
        }

        // Build API payload from selected rows
        const af = [];
        for (const r of selectedRows) {
          if (r.api?.value) { af.push(r.api); continue; }
          if (!r.dom) continue;
          // DOM rows also write via API
          const v = r.dom.label === 'Purchase Date' ? r.dom.apiVal : r.dom.after;
          if (v) af.push({ id: r.dom.zdId, value: v });
        }

        putZdTicket(ticketId, af, btn, panel);
      }, () => {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
      });
    }

    // Async fetches — device opts always fetched (invoice detection needs opts even without product)
    fetchZdFieldOpts(ZD.DEVICE, opts => {
      if (deviceLabel) {
        const v = bestDeviceOptVal(opts, deviceLabel, ticketText);
        resolvedDevice = v ? { val: v, name: opts.find(o => o.value === v)?.name || v, opts } : { val: null, name: '', opts };
      } else {
        resolvedDevice = { val: null, name: '', opts }; // no product, but keep opts for invoice override
      }
      buildAndShow();
    });
    if (productLabel) {
      fetchZdFieldOpts(ZD.PRODUCT_NAME, opts => {
        const v = bestMatchOptVal(opts, productLabel, true);
        resolvedProduct = { val: v, name: v ? opts.find(o => o.value === v)?.name?.replace(/^[^_]+_/, '') || v : '', opts };
        buildAndShow();
      });
    }
    fetchZdFieldOpts(ZD.FULFILLMENT, opts => {
      fulfillOpts = opts;
      let fv = null;
      if (skuHasPan) { const o2 = opts.find(x => /pan\s*eu/i.test(x.name)); if (o2) fv = o2.value; }
      if (!fv && fulfillChannel) {
        const kw = fulfillChannel === 'AFN' ? 'fba' : fulfillChannel === 'MFN' ? 'merchant' : null;
        if (kw) { const o2 = opts.find(x => x.name.toLowerCase().startsWith(kw)); if (o2) fv = o2.value; }
      }
      resolvedFulfill = fv ? { val: fv, name: opts.find(o => o.value === fv)?.name || fv } : null;
      buildAndShow();
    });
    fetchTicketComments(ticketId, hasPhoto => { resolvedHasPhoto = hasPhoto; buildAndShow(); });
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${ticketId}.json`,
      onload(res) {
        try {
          const t = JSON.parse(res.responseText).ticket || {};
          for (const f of (t.custom_fields || [])) currentCfMap[f.id] = f.value || '';
          ticketSubject = t.subject || '';
        } catch {}
        buildAndShow();
      },
      onerror() { buildAndShow(); },
    });
  }

  function putZdTicket(ticketId, af, btn, panel) {
    if (!af.length) {
      if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
      setFillStatus(panel, 'Nothing to fill.');
      return;
    }
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
    GM_xmlhttpRequest({
      method:  'PUT',
      url:     `https://spigenhelp.zendesk.com/api/v2/tickets/${ticketId}.json`,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      data:    JSON.stringify({ ticket: { custom_fields: af } }),
      onload(res) {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
        setFillStatus(panel, res.status === 200 ? `✓ ${af.length} fields saved` : `API error ${res.status}`);
      },
      onerror() {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
        setFillStatus(panel, 'Network error');
      },
    });
  }

  // ── AI 인입사유 ───────────────────────────────────────────────────────────
  function showAiReasonBtn_(category) {
    const container = document.getElementById('sp-ai-reason-result');
    if (!container) return;
    container.innerHTML = `
      <div style="padding:0 14px 0;">
        <div style="border-top:1px solid #e9ebec;padding:7px 0 6px;">
          <button id="sp-ai-reason-btn" style="background:rgba(124,58,237,0.88);color:#fff;border:none;border-radius:8px;padding:5px 0;cursor:pointer;font-size:12px;width:100%;backdrop-filter:blur(4px);">✦ AI 인입사유 분석</button>
        </div>
      </div>`;
    container.querySelector('#sp-ai-reason-btn').addEventListener('click', () => {
      const review = getAiInputText_();
      fetchAiReason_(review, category);
    });
  }

  function fetchAiReason_(review, category) {
    const container = document.getElementById('sp-ai-reason-result');
    if (!container || !review) return;
    const _session = _panelSession;
    container.innerHTML = `<div style="padding:0 14px;"><div style="font-size:11px;color:#aaa;padding:6px 0;">AI 인입사유 분석 중…</div></div>`;
    logStep_('AI 인입사유 분석 중…');
    logStep_('AI 입력텍스트: ' + review.slice(0, 600).replace(/\n+/g, ' / '));
    GM_xmlhttpRequest({
      method:   'GET',
      url:      `${GAS_URL}?action=inferReason&review=${encodeURIComponent(review.slice(0, 2000))}&category=${encodeURIComponent(category || '')}`,
      redirect: 'follow',
      timeout:  35000,
      onload(res) {
        if (_panelSession !== _session || !container.isConnected) return;
        try {
          const data = JSON.parse(res.responseText);
          if (data.error) logStep_(`AI GAS오류: ${data.error}`);
          lastAiReason = data.reason || null;
          renderAiReason_(lastAiReason);
          logStep_(`AI 인입사유: ${lastAiReason || '(결과 없음)'}`);
        } catch (err) {
          renderAiReason_(null);
          logStep_(`AI 인입사유 오류: JSON파싱실패 — ${res.responseText.slice(0, 120)}`);
        }
      },
      onerror(res) {
        if (_panelSession !== _session) return;
        container.innerHTML = '';
        logStep_(`AI 인입사유 오류: network error (status=${res.status})`);
      },
      ontimeout() {
        if (_panelSession !== _session) return;
        container.innerHTML = '';
        logStep_('AI 인입사유 오류: timeout (35s 초과)');
      },
    });
  }

  function renderAiReason_(reason) {
    const container = document.getElementById('sp-ai-reason-result');
    if (!container) return;
    const color = reason ? '#7c3aed' : '#9ca3af';
    const fill  = reason ? '#7c3aed' : '#9ca3af';
    container.innerHTML = `
      <div style="padding:0 14px 0;">
        <div class="sp-block" data-sp-section="ai_reason">
          <div class="sp-block-title" style="color:${color};border-top:1px solid #e9ebec;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${fill}" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2l1.09 6.26L19 6l-4.26 4.91L21 12l-6.26 1.09L19 19l-4.91-4.26L12 21l-1.09-6.26L5 18l4.26-4.91L3 12l6.26-1.09L5 6l4.91 4.26L12 2z"/>
            </svg>
            AI 인입사유
            <span class="sp-chevron">▾</span>
          </div>
          <div class="sp-block-body">
            ${row('인입사유', reason || '(분류 불가)')}
          </div>
        </div>
      </div>`;
    container.querySelectorAll('.sp-block-title').forEach(t => {
      t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
    });
    applySectionState(container);
    // Always expand after a fresh analysis — user just asked for it
    const _aiBlock = container.querySelector('[data-sp-section="ai_reason"]');
    if (_aiBlock) _aiBlock.classList.remove('collapsed');
  }

  // ── Product info renderer ────────────────────────────────────────────────

  function renderProductInfo(asin) {
    renderAllProducts([asin]);
  }

  function renderAllProducts(asins, _retry, _forceExpand) {
    const container = document.getElementById('sp-product-result');
    if (!container) return;
    if (!asins.length) { container.innerHTML = ''; return; }
    const _session = _panelSession;
    container.innerHTML = `<div style="font-size:11px;color:#aaa;padding:4px 14px;">Loading product info…</div>`;
    if (!_retry) logStep_(`GAS product lookup: ${asins.join(', ')}`);

    let loaded = 0;
    const results = new Array(asins.length).fill(null);

    function done(idx) { if (++loaded === asins.length) finish(); }

    asins.forEach((asin, idx) => {
      GM_xmlhttpRequest({
        method:   'GET',
        url:      `${GAS_URL}?asin=${encodeURIComponent(asin)}`,
        redirect: 'follow',
        timeout:  30000,
        onload(res) {
          if (res.responseText.trimStart().startsWith('<')) {
            results[idx] = { asin, product: null, source: null, marketplaces: [], error: '__html__', allSources: null };
            done(idx);
            return;
          }
          try {
            const data = JSON.parse(res.responseText);
            const mkts = data.marketplaces || [];
            if (data.product && data.productSource !== 'market') {
              // Full data from sheet1 or sheet2 — use directly
              logStep_(`Product: found in ${data.productSource || 'sheet'} (${asin})`);
              results[idx] = { asin, product: data.product, source: data.productSource || 'sheet', marketplaces: mkts, allSources: data.allSources || null };
              done(idx);
            } else if (data.product && data.productSource === 'market') {
              // Partial from country sheet (기종명 col A, 모델명 col B) — merge with Amazon
              logStep_(`Product: market sheet partial (${asin}), fetching Amazon…`);
              const partial = data.product;
              fetchAmazonProduct_(asin, (amazonProduct, amazonUrl) => {
                let merged = partial, src = 'market';
                if (amazonProduct) {
                  merged = Object.assign({}, amazonProduct);
                  if (partial['기종명']) merged['기종명'] = partial['기종명'];
                  if (partial['모델명']) merged['모델명'] = partial['모델명'];
                  src = 'market+amazon';
                }
                logStep_(amazonProduct ? `Product: Amazon merged (${asin})` : `Product: Amazon not found (${asin})`);
                results[idx] = { asin, product: merged, source: src, sourceUrl: amazonUrl, marketplaces: mkts, allSources: data.allSources || null, amazonProduct: amazonProduct || null, amazonUrl };
                done(idx);
              });
            } else {
              // Not in any sheet → fall back to Amazon product page
              logStep_(`Product: not in sheets (${asin}), fetching Amazon…`);
              fetchAmazonProduct_(asin, (amazonProduct, amazonUrl) => {
                logStep_(amazonProduct ? `Product: Amazon (${asin})` : `Product: not found anywhere (${asin})`);
                results[idx] = {
                  asin,
                  product:      amazonProduct,
                  source:       amazonProduct ? 'amazon' : null,
                  sourceUrl:    amazonUrl,
                  marketplaces: mkts,
                  error:        amazonProduct ? null : `${asin} not found in any sheet or Amazon page.`,
                  allSources:   data.allSources || null,
                  amazonProduct: amazonProduct || null,
                  amazonUrl,
                };
                done(idx);
              });
            }
          } catch (err) {
            results[idx] = { asin, product: null, source: null, marketplaces: [], error: 'Parse error: ' + err.message, allSources: null };
            done(idx);
          }
        },
        onerror() {
          results[idx] = { asin, product: null, source: null, error: 'Cannot reach GAS endpoint.', allSources: null };
          done(idx);
        },
      });
    });

    function sourceBadge_(source, sourceUrl) {
      const MKTSS   = '172fDVw4tu-hgbpV5FShWj4_SAMxeB54-v5BUlVgJUoA';
      const sheet2Url = `https://docs.google.com/spreadsheets/d/${MKTSS}/edit?gid=583143689`;
      const b = (href, label, bg) =>
        `<a href="${esc(href || '#')}" target="_blank" rel="noopener"
          style="font-size:10px;font-weight:normal;background:${bg};color:#fff;
                 padding:1px 6px;border-radius:3px;margin-left:4px;text-decoration:none;">${label}</a>`;
      if (source === 'sheet' || source === 'sheet1') return b(SHEET_URL, 'Sheet', '#34a853');
      if (source === 'sheet2')                        return b(sheet2Url, 'Sheet', '#34a853');
      if (source === 'market')                        return b(sheet2Url, 'Mkt',   '#e67e22');
      if (source === 'market+amazon')                 return b(sheet2Url, 'Mkt', '#e67e22') + b(sourceUrl, 'Amazon', '#FF9900');
      if (source === 'amazon')                        return b(sourceUrl, 'Amazon', '#FF9900');
      return '';
    }

    function finish() {
      if (_panelSession !== _session || !container.isConnected) return;
      if (!_retry && results.every(r => r.error === '__html__')) {
        logStep_('GAS not ready, retrying product lookup…');
        container.innerHTML = `<div style="font-size:11px;color:#aaa;padding:4px 14px;">Retrying…</div>`;
        setTimeout(() => renderAllProducts(asins, true, _forceExpand), 2000);
        return;
      }
      results.forEach(r => { if (r.error === '__html__') r.error = 'GAS error — refresh and try again'; });
      const valid = results.filter(r => r.product);
      // Prefer sheet data for auto-fill (sheet1 > sheet2 > market+amazon > amazon > market)
      lastProductData =
        valid.find(r => r.source === 'sheet' || r.source === 'sheet1' || r.source === 'sheet2')?.product ||
        valid.find(r => r.source === 'market+amazon')?.product ||
        valid[0]?.product || null;
      // Store Amazon product for fallback (대분류/생산업체/원산지정보 may be empty in sheet)
      const amzResult = valid.find(r => r.amazonProduct);
      if (amzResult?.amazonProduct) lastAmazonProduct = amzResult.amazonProduct;
      _productReady = true;  // product lookup finished — enable Auto-Fill Form button
      maybeShowAutoFill(document.getElementById(PANEL_ID));

      const aiCategory = lastProductData?.['대분류'] || '';
      showAiReasonBtn_(aiCategory);

      container.innerHTML = `<div style="padding:0 14px 8px;">${results.map(({ asin, product, source, sourceUrl, error, marketplaces }) => {
        if (!product) {
          const msg = error || `${esc(asin)} not found.`;
          return `<div style="font-size:11px;color:${error ? '#c00' : '#aaa'};padding:4px 0;">${esc(msg)}</div>`;
        }
        const label = asins.length > 1 ? esc(asin) : 'Product Info';
        return `
          <div class="sp-block" style="margin-top:0;" data-sp-section="product_${esc(asin)}">
            <div class="sp-block-title" style="border-top:1px solid #e9ebec;">
              ${label}${sourceBadge_(source, sourceUrl)}
              <span class="sp-chevron">▾</span>
            </div>
            <div class="sp-block-body">
              ${marketplacesRow_(marketplaces)}
              ${SHEET_COLS.map(col => row(col, product[col])).join('')}
            </div>
          </div>`;
      }).join('')}</div>`;

      container.querySelectorAll('.sp-block-title').forEach(t => {
        t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
      });

      if (_forceExpand) {
        // ASIN-only ticket: apply saved state for non-product sections only;
        // product blocks stay expanded (default) so product info is the focus
        const _c = loadUi().collapsed || {};
        container.querySelectorAll('[data-sp-section]').forEach(block => {
          const key = block.dataset.spSection;
          if (key.startsWith('product_')) return;
          if (!(key in _c)) return;
          if (_c[key]) block.classList.add('collapsed'); else block.classList.remove('collapsed');
        });
      } else {
        applySectionState(container);
      }
      appendSourcesSection_(container, results);
    }
  }

  // ── ASIN source blocks ────────────────────────────────────────────────────

  function buildSourceBlock_(title, linkUrl, product) {
    const link = linkUrl
      ? ` <a href="${esc(linkUrl)}" target="_blank" rel="noopener"
           style="font-size:10px;font-weight:normal;color:#5ba4cf;text-decoration:none;margin-left:4px;">↗</a>`
      : '';
    // Full product page title (Amazon source only) — shown as a "Title" row above SKU.
    const titleRow = product._title
      ? `<div class="sp-row"><span class="sp-label" style="font-size:11.5px;">Title</span><span class="sp-val" style="font-size:11.5px;line-height:1.35;">${esc(product._title)}</span>${COPY_BTN}</div>`
      : '';
    const fields = SHEET_COLS.map(col => {
      const val = product[col];
      if (!val) return '';
      return `<div class="sp-row"><span class="sp-label" style="font-size:11.5px;">${esc(col)}</span><span class="sp-val" style="font-size:11.5px;">${esc(val)}</span>${COPY_BTN}</div>`;
    }).filter(Boolean).join('');
    return `
      <div class="sp-block collapsed" style="margin-top:0;">
        <div class="sp-block-title" style="border-top:1px solid #e9ebec;font-size:11.5px;">
          ${esc(title)}${link}<span class="sp-chevron" style="margin-left:auto;">▾</span>
        </div>
        <div class="sp-block-body">
          ${titleRow}${fields || '<div class="sp-row"><span class="sp-val" style="color:#aaa;font-size:11px;">No data</span></div>'}
        </div>
      </div>`;
  }

  function addCollapseListeners_(el) {
    el.querySelectorAll('.sp-block-title').forEach(t => {
      t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
    });
  }

  function appendSourcesSection_(container, results) {
    const SHEET1_LINK = 'https://docs.google.com/spreadsheets/d/1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo/edit?gid=0#gid=0';
    const SHEET2_LINK = 'https://docs.google.com/spreadsheets/d/172fDVw4tu-hgbpV5FShWj4_SAMxeB54-v5BUlVgJUoA/edit?gid=716900287';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:0 14px 4px;';

    // Collapsible header — collapsed by default
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:11.5px;font-weight:600;color:#5ba4cf;padding:8px 0 4px;border-top:1px solid #e9ebec;margin-top:4px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;';
    const hdrText = document.createElement('span');
    hdrText.textContent = 'ASIN Sources';
    const hdrChevron = document.createElement('span');
    hdrChevron.textContent = '▸';
    hdrChevron.style.cssText = 'font-size:10px;color:#aaa;';
    hdr.appendChild(hdrText);
    hdr.appendChild(hdrChevron);

    const body = document.createElement('div');
    const _asinSrcCollapsed = (loadUi().collapsed || {})['asin_sources'] !== false;
    body.style.display = _asinSrcCollapsed ? 'none' : '';
    hdrChevron.textContent = _asinSrcCollapsed ? '▸' : '▾';

    hdr.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      hdrChevron.textContent = open ? '▸' : '▾';
      const c = loadUi().collapsed || {};
      c['asin_sources'] = open;
      saveUi({ collapsed: c });
    });

    wrap.appendChild(hdr);
    wrap.appendChild(body);
    container.appendChild(wrap);
    logStep_('Checking ASIN sources…');

    results.forEach(r => {
      if (!r || !r.asin) return;
      const { asin, allSources } = r;

      if (results.length > 1) {
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:11px;font-weight:600;color:#888;padding:2px 0;font-family:monospace;';
        lbl.textContent = asin;
        body.appendChild(lbl);
      }

      // ASIN Master (Sheet1)
      const s1el = document.createElement('div');
      if (allSources === null) {
        s1el.innerHTML = `<div style="font-size:11px;color:#c00;padding:2px 0;">ASIN Master — fetch error</div>`;
        logStep_(`Source: ASIN Master fetch error (${asin})`);
      } else {
        const s1 = allSources.sheet1;
        if (s1) {
          s1el.innerHTML = buildSourceBlock_('✓ ASIN Master', SHEET1_LINK, s1);
          logStep_(`Source: ASIN Master found (${asin})`);
        } else {
          s1el.innerHTML = `<div style="font-size:11px;color:#bbb;padding:2px 0;">✗ ASIN Master — not found</div>`;
          logStep_(`Source: ASIN Master not found (${asin})`);
        }
      }
      body.appendChild(s1el);
      addCollapseListeners_(s1el);

      // Sheet2
      const s2el = document.createElement('div');
      if (allSources === null) {
        s2el.innerHTML = `<div style="font-size:11px;color:#c00;padding:2px 0;">Sheet2 — fetch error</div>`;
        logStep_(`Source: Sheet2 fetch error (${asin})`);
      } else {
        const s2 = allSources.sheet2;
        if (s2) {
          s2el.innerHTML = buildSourceBlock_('✓ Sheet2', SHEET2_LINK, s2);
          logStep_(`Source: Sheet2 found (${asin})`);
        } else {
          s2el.innerHTML = `<div style="font-size:11px;color:#bbb;padding:2px 0;">✗ Sheet2 — not found</div>`;
          logStep_(`Source: Sheet2 not found (${asin})`);
        }
      }
      body.appendChild(s2el);
      addCollapseListeners_(s2el);

      // Amazon (async — reuse if already fetched during Product Info lookup)
      const amzEl = document.createElement('div');
      amzEl.innerHTML = `<div style="font-size:11px;color:#aaa;padding:2px 0;">Amazon — checking…</div>`;
      body.appendChild(amzEl);

      function setAmz(product, url) {
        if (product) lastAmazonProduct = product; // fallback for 대분류/생산업체/원산지정보
        if (!amzEl.isConnected) return;
        if (product) {
          amzEl.innerHTML = buildSourceBlock_('✓ Amazon', url || null, product);
          logStep_(`Source: Amazon found (${asin})`);
        } else {
          amzEl.innerHTML = `<div style="font-size:11px;color:#bbb;padding:2px 0;">✗ Amazon — not found</div>`;
          logStep_(`Source: Amazon not found (${asin})`);
        }
        addCollapseListeners_(amzEl);
      }

      // amazonProduct is undefined → not yet fetched (sheet1/sheet2 path); null → fetched+not found
      if (r.amazonProduct !== undefined) {
        setAmz(r.amazonProduct, r.amazonUrl);
      } else {
        logStep_(`Source: Amazon fetching… (${asin})`);
        fetchAmazonProduct_(asin, setAmz);
      }
    });
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  // GM_addStyle may be undefined if Chrome MV3 restricts Tampermonkey grants;
  // fall back to a plain <style> element so the UI still renders.
  function safeAddStyle_(css) {
    try { if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; } } catch (_) {}
    try {
      const el = document.createElement('style');
      el.textContent = css;
      (document.head || document.documentElement || document.body).appendChild(el);
    } catch (_) {}
  }
  safeAddStyle_(`
    /* ── Main panel ─────────────────────────────────────────────────────── */
    #sp-order-panel {
      position: fixed;
      right: 16px;
      top: 72px;
      width: 330px;
      min-width: 280px;
      max-width: 700px;
      max-height: calc(100vh - 80px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: rgb(244,246,251);
      border: 1px solid rgba(0,0,0,0.10);
      border-radius: 22px;
      box-shadow:
        0 10px 28px rgba(0,0,0,0.10),
        0 3px 8px rgba(0,0,0,0.06),
        inset 0 1px 0 rgba(255,255,255,0.70);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 12.5px;
      color: #1c1c1e;
      z-index: 99999;
    }

    #sp-order-panel * { box-sizing: border-box; }

    /* ── Header ─────────────────────────────────────────────────────────── */
    #sp-panel-header {
      position: relative;
      z-index: 1;
      padding: 9px 12px;
      background: rgb(236,239,248);
      border-bottom: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 22px 22px 0 0;
      display: flex;
      align-items: center;
      gap: 7px;
      cursor: move;
      font-weight: 600;
      font-size: 13px;
      user-select: none;
    }
    #sp-settings-btn {
      margin-left: auto;
      cursor: pointer;
      opacity: .5;
      font-size: 14px;
      line-height: 1.4;
      padding: 2px 5px;
      border-radius: 6px;
    }
    #sp-settings-btn:hover { opacity: 1; background: rgba(180,185,210,0.35); }
    #sp-minimize-btn {
      cursor: pointer;
      opacity: .5;
      font-size: 18px;
      line-height: .7;
      padding: 2px 6px 4px;
      border-radius: 6px;
    }
    #sp-minimize-btn:hover { opacity: 1; background: rgba(180,185,210,0.35); }
    #sp-panel-close {
      cursor: pointer;
      opacity: .5;
      font-size: 15px;
      line-height: 1;
      padding: 2px 5px;
      border-radius: 6px;
    }
    #sp-panel-close:hover { opacity: 1; background: rgba(180,185,210,0.35); }

    /* ── Settings drawer ──────────────────────────────────────────────────── */
    #sp-settings-drawer {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.25s ease;
      position: relative;
      z-index: 2;
    }
    #sp-settings-drawer.sp-settings-open {
      max-height: 220px;
      border-bottom: 1px solid rgba(255,255,255,0.18);
    }
    .sp-settings-inner {
      padding: 8px 12px 10px;
      background: rgba(255,255,255,0.06);
    }
    /* Body text is selectable/copyable (drag the title bar to move the panel). */
    #sp-panel-body, #sp-panel-body .sp-val, #sp-panel-body .sp-label,
    #sp-panel-body .sp-item-card, #sp-panel-body #sp-notes-content {
      -webkit-user-select: text;
      user-select: text;
      cursor: auto;
    }
    /* Collapsible section headers stay click-to-toggle, not selectable. */
    #sp-panel-body .sp-block-title { -webkit-user-select: none; user-select: none; cursor: pointer; }

    #sp-order-panel.minimized #sp-panel-body { display: none; }
    #sp-order-panel.minimized #sp-settings-drawer { display: none; }
    #sp-order-panel.minimized:not(.sp-docked) #sp-panel-header { border-radius: 22px; border-bottom: none; cursor: pointer; }

    /* ── Edge-resize grips (invisible overlay divs, bypass scrollbar) ────── */
    .sp-re { position: absolute; z-index: 9998; pointer-events: auto; }
    .sp-re-n  { top: 0;    left: 10px;  right: 10px;  height: 8px; cursor: n-resize; }
    .sp-re-s  { bottom: 0; left: 10px;  right: 10px;  height: 8px; cursor: s-resize; }
    .sp-re-e  { right: 0;  top: 10px;   bottom: 10px; width:  8px; cursor: e-resize; }
    .sp-re-w  { left: 0;   top: 10px;   bottom: 10px; width:  8px; cursor: w-resize; }
    .sp-re-ne { top: 0;    right: 0;    width: 14px;  height: 14px; cursor: ne-resize; }
    .sp-re-nw { top: 0;    left: 0;     width: 14px;  height: 14px; cursor: nw-resize; }
    .sp-re-se { bottom: 0; right: 0;    width: 14px;  height: 14px; cursor: se-resize; }
    .sp-re-sw { bottom: 0; left: 0;     width: 14px;  height: 14px; cursor: sw-resize; }
    /* Buttons must sit above edge grips so clicks always reach them */
    #sp-settings-btn, #sp-minimize-btn, #sp-panel-close { position: relative; z-index: 10000; }
    /* Hide lower grips when minimized (body is hidden, bottom edge is gone) */
    #sp-order-panel.minimized .sp-re-s,
    #sp-order-panel.minimized .sp-re-se,
    #sp-order-panel.minimized .sp-re-sw,
    #sp-order-panel.minimized .sp-re-e,
    #sp-order-panel.minimized .sp-re-w  { display: none; }

    /* ── Scrollable body ────────────────────────────────────────────────── */
    #sp-panel-body {
      position: relative;
      z-index: 1;
      padding: 10px 14px 8px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    #sp-order-panel.sp-compact .sp-row { flex-direction: column; gap: 1px; }
    #sp-order-panel.sp-compact .sp-label { min-width: 0; font-size: 10.5px; }
    #sp-order-panel.sp-compact .sp-val   { font-size: 11.5px; }

    /* ── Input bars ─────────────────────────────────────────────────────── */
    #sp-id-bar {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 8px;
    }
    #sp-order-input {
      flex: 1;
      background: rgba(255,255,255,0.38);
      border: 1px solid rgba(180,190,220,0.40);
      border-radius: 8px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: monospace;
      outline: none;
      color: #1a1a2e;
    }
    #sp-order-input:focus { border-color: #5ba4cf; box-shadow: 0 0 0 2px rgba(91,164,207,.20); background: rgba(255,255,255,0.58); }
    #sp-asin-input {
      flex: 1;
      background: rgba(255,255,255,0.38);
      border: 1px solid rgba(180,190,220,0.40);
      border-radius: 8px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: monospace;
      outline: none;
      color: #1a1a2e;
    }
    #sp-asin-input:focus { border-color: #f0a500; box-shadow: 0 0 0 2px rgba(240,165,0,.20); background: rgba(255,255,255,0.58); }

    /* ── Buttons ────────────────────────────────────────────────────────── */
    #sp-lookup-btn {
      background: rgba(91,164,207,0.88);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      backdrop-filter: blur(4px);
    }
    #sp-lookup-btn:hover { background: rgba(74,143,186,0.95); }
    #sp-product-btn {
      background: rgba(240,165,0,0.88);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      backdrop-filter: blur(4px);
    }
    #sp-product-btn:hover { background: rgba(217,146,0,0.95); }

    #sp-autofill-bar { margin-bottom: 8px; display: none; }
    #sp-autofill-btn {
      background: rgba(39,174,96,0.88);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 0;
      cursor: pointer;
      font-size: 12px;
      width: 100%;
      backdrop-filter: blur(4px);
    }
    #sp-autofill-btn:hover:not(:disabled) { background: rgba(33,154,82,0.96); }
    #sp-autofill-btn:disabled { background: rgba(168,213,181,0.7); cursor: default; }
    #sp-fill-status {
      display: none;
      font-size: 11px;
      color: #27ae60;
      margin-top: 4px;
      text-align: center;
    }

    /* ── Order ID chips ─────────────────────────────────────────────────── */
    #sp-detected-ids { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px; min-height: 0; }
    .sp-chip {
      background: rgba(91,164,207,0.12);
      border: 1px solid rgba(91,164,207,0.30);
      color: #2a6496;
      border-radius: 12px;
      padding: 2px 10px;
      font-size: 11.5px;
      cursor: pointer;
      font-family: monospace;
      user-select: none;
      backdrop-filter: blur(8px);
    }
    .sp-chip:hover { background: rgba(91,164,207,0.22); }

    #sp-status {
      text-align: center;
      padding: 14px 8px;
      color: #6e6e73;
      font-size: 12px;
    }

    /* ── Collapsible blocks ─────────────────────────────────────────────── */
    .sp-block { margin-top: 4px; }
    .sp-block-title {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 0 4px;
      font-weight: 600;
      font-size: 12.5px;
      color: #1c1c1e;
      cursor: pointer;
      user-select: none;
      border-top: 1px solid rgba(0,0,0,0.08);
    }
    .sp-block-title .sp-chevron { margin-left: auto; transition: transform .18s; color: rgba(110,110,115,0.8); }
    .sp-block.collapsed .sp-block-title .sp-chevron { transform: rotate(-90deg); }
    .sp-block.collapsed .sp-block-body { display: none; }

    /* ── Data rows ──────────────────────────────────────────────────────── */
    .sp-row {
      display: flex;
      align-items: flex-start;
      padding: 4px 0;
      gap: 6px;
    }
    .sp-row:nth-child(odd) {
      background: rgba(255,255,255,0.38);
      margin: 0 -14px;
      padding: 4px 14px;
      border-radius: 6px;
    }
    .sp-label { color: #3a6ea8; min-width: 128px; flex-shrink: 0; font-size: 12px; }
    .sp-val   { color: #1c1c1e; font-weight: 500; word-break: break-all; font-size: 12px; }
    .sp-val.link { color: #3a6ea8; text-decoration: underline; cursor: pointer; }

    /* Per-row one-click copy button */
    .sp-copy {
      margin-left: auto;
      align-self: flex-start;
      flex-shrink: 0;
      background: none;
      border: none;
      padding: 0 2px;
      cursor: pointer;
      color: #9aa3b2;
      opacity: 0.4;
      line-height: 1;
      transition: opacity 0.12s, color 0.12s;
    }
    .sp-row:hover .sp-copy { opacity: 0.85; }
    .sp-copy:hover { color: #3a6ea8; opacity: 1; }
    .sp-copy.copied { color: #27ae60; opacity: 1; font-size: 12px; }

    .sp-items-title {
      font-weight: 600;
      font-size: 11.5px;
      color: #6e6e73;
      padding: 6px 0 2px;
      border-top: 1px solid rgba(0,0,0,0.07);
      margin-top: 2px;
    }
    .sp-item-card {
      padding: 4px 0 5px;
      border-bottom: 1px solid rgba(0,0,0,0.05);
    }
    .sp-item-card:last-child { border-bottom: none; }
    .sp-item-asin {
      font-size: 11px;
      color: #3a6ea8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 2px;
    }
    .sp-item-sku {
      font-size: 10.5px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sp-item-name {
      font-size: 12px;
      color: #1c1c1e;
      font-weight: 500;
      word-break: break-word;
      line-height: 1.45;
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }
    .sp-item-name .sp-copy { opacity: 0; flex-shrink: 0; margin-top: 1px; }
    .sp-item-card:hover .sp-item-name .sp-copy { opacity: 0.85; }

    /* ── Step log ───────────────────────────────────────────────────────── */
    #sp-load-log {
      flex-shrink: 0;
      position: relative;
      z-index: 2;
    }
    #sp-load-log:not(:has(#sp-log-entries > *)) { display: none; }
    #sp-log-entries {
      font-size: 10px;
      color: #6e6e73;
      padding: 3px 14px 4px;
      border-top: 1px solid rgba(0,0,0,0.07);
      max-height: 56px;
      overflow-y: auto;
      font-family: monospace;
      line-height: 1.6;
    }
    #sp-load-log.sp-log-collapsed { display: none; }

    /* ── Toggle button (shown when panel is closed) ──────────────────────── */
    #sp-toggle-btn {
      position: fixed;
      right: 16px;
      top: 56px;
      background: rgba(91,164,207,0.82);
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.4);
      border-radius: 20px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      z-index: 99999;
      box-shadow: 0 2px 12px rgba(0,0,0,.18);
      display: none;
    }
    #sp-toggle-btn:hover { background: rgba(74,143,186,0.92); }

    /* ── Docked mode: render inline inside Zendesk's Apps panel ───────────── */
    #sp-order-panel.sp-docked {
      position: relative !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto;
      max-height: none !important;
      flex-shrink: 0 !important;
      left: auto !important; top: auto !important; right: auto !important;
      margin: 0 0 10px 0;
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      animation: none !important;
      z-index: auto;
    }
    /* In docked mode, hide all resize grips except the south (bottom-drag) one */
    #sp-order-panel.sp-docked .sp-re:not(.sp-re-s) { display: none !important; }
    #sp-order-panel.sp-docked .sp-re-s {
      display: block;
      height: 8px;
      cursor: row-resize;
      background: transparent;
      border-radius: 0 0 10px 10px;
      transition: background 0.15s;
    }
    #sp-order-panel.sp-docked .sp-re-s:hover { background: rgba(0,0,0,0.07); }
    #sp-order-panel.sp-docked.minimized .sp-re-s { display: none !important; }
    /* Native Zendesk app-section chrome look (matches ChannelReply's block). */
    #sp-order-panel.sp-docked {
      border: 1px solid #e9ebed;
      box-shadow: none;
      background: #fff !important;
    }
    #sp-order-panel.sp-docked #sp-panel-header {
      cursor: pointer;
      border-radius: 9px 9px 0 0;
      background: #fff;
      color: #2f3941;
      border-bottom: 1px solid #e9ebed;
      font-size: 14px;
      font-weight: 700;
      padding: 11px 14px;
    }
    #sp-order-panel.sp-docked.minimized #sp-panel-header { border-radius: 9px; }
    #sp-order-panel.sp-docked #sp-panel-header svg:first-of-type { width: 16px; height: 16px; }
    /* Hide floating-only controls when docked */
    #sp-order-panel.sp-docked #sp-minimize-btn,
    #sp-order-panel.sp-docked #sp-panel-close { display: none !important; }
    #sp-order-panel.sp-docked #sp-settings-btn { margin-left: auto; }
    /* Settings drawer: override colors for the white docked background */
    #sp-order-panel.sp-docked #sp-settings-drawer.sp-settings-open {
      border-bottom: 1px solid #e9ebed;
      max-height: 280px;
    }
    #sp-order-panel.sp-docked .sp-settings-inner { background: #f8f9fa; }
    /* Panel body scrolls within the docked panel (same as floating mode).
       The panel itself is capped at max-height above, so overflow activates. */
    #sp-order-panel.sp-docked #sp-panel-body { overflow-y: auto !important; max-height: none !important; flex: 1 !important; min-height: 0 !important; background: #fff; }
    /* Collapse/expand toggle button (only visible when docked) */
    #sp-dock-collapse-btn {
      display: none;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      color: #68737d;
      padding: 0;
      flex-shrink: 0;
      position: relative;
      z-index: 10000;
    }
    #sp-dock-collapse-btn:hover { background: rgba(0,0,0,0.05); border-color: #d8dcde; }
    #sp-dock-collapse-btn svg { transform: rotate(180deg); transition: transform 0.18s; }
    #sp-order-panel.sp-docked #sp-dock-collapse-btn { display: inline-flex; }
    #sp-order-panel.sp-docked.minimized #sp-dock-collapse-btn svg { transform: rotate(0deg); }

    #sp-mcf-bar { margin-bottom: 8px; display: none; }
    #sp-mcf-btn {
      background: rgba(255,153,0,0.88);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 0;
      cursor: pointer;
      font-size: 12px;
      width: 100%;
      backdrop-filter: blur(4px);
    }
    #sp-mcf-btn:hover { background: rgba(230,138,0,0.96); }
    #sp-mcf-status {
      display: none;
      font-size: 11px;
      color: #27ae60;
      margin-top: 4px;
      text-align: center;
    }

    #sp-nrn-bar { margin-top: 6px; }
    #sp-nrn-btn {
      background: rgba(108,117,140,0.90);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 5px 0;
      cursor: pointer;
      font-size: 12px;
      width: 100%;
      backdrop-filter: blur(4px);
    }
    #sp-nrn-btn:hover:not(:disabled) { background: rgba(86,94,115,0.96); }
    #sp-nrn-btn:disabled { background: rgba(160,165,175,0.55); color: rgba(255,255,255,0.8); cursor: not-allowed; }
    #sp-nrn-status {
      display: none;
      font-size: 11px;
      color: #27ae60;
      margin-top: 4px;
      text-align: center;
    }

    #sp-notes-bar {
      margin-bottom: 6px;
    }
    #sp-notes-bar label {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      user-select: none;
      font-size: 12px;
      color: #4a8fcf;
      font-weight: 500;
    }
    #sp-notes-toggle { cursor: pointer; accent-color: #5ba4cf; }
    #sp-notes-section {
      display: none;
      margin-bottom: 8px;
    }
    #sp-notes-content {
      font-size: 12px;
      color: #1c1c1e;
      white-space: pre-wrap;
      padding: 6px 8px;
      background: rgba(255,255,255,0.40);
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 8px;
      min-height: 36px;
    }

    #sp-order-panel.sp-dragging { box-shadow: 0 8px 20px rgba(0,0,0,0.10); }
  `);

  // ── Panel HTML ────────────────────────────────────────────────────────────
  function buildPanel() {
    const d = document.createElement('div');
    d.id = PANEL_ID;
    d.innerHTML = `
      <div class="sp-re sp-re-n"></div><div class="sp-re sp-re-ne"></div>
      <div class="sp-re sp-re-e"></div><div class="sp-re sp-re-se"></div>
      <div class="sp-re sp-re-s"></div><div class="sp-re sp-re-sw"></div>
      <div class="sp-re sp-re-w"></div><div class="sp-re sp-re-nw"></div>
      <div id="sp-panel-header">
        <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <text x="3" y="38" font-size="38" font-family="Georgia,serif" font-style="italic" fill="#FF9900">a</text>
          <path d="M6 40 Q24 48 42 40" stroke="#FF9900" stroke-width="3" fill="none" stroke-linecap="round"/>
        </svg>
        GCX Reply
        <span style="font-size:9.5px;font-weight:normal;color:#bbb;margin-left:3px;vertical-align:middle;letter-spacing:0.3px;">v${SCRIPT_VER}</span>
        <span id="sp-settings-btn" title="Settings">⚙</span>
        <span id="sp-minimize-btn" title="Minimize">─</span>
        <span id="sp-panel-close" title="Close">✕</span>
        <button id="sp-dock-collapse-btn" type="button" aria-label="Collapse section" data-garden-id="buttons.icon_button" data-garden-version="9.14.2">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-garden-id="buttons.icon" data-garden-version="9.14.2">
            <path fill="currentColor" d="M12.688 5.61a.5.5 0 0 1 .69.718l-.066.062-5 4a.5.5 0 0 1-.542.054l-.082-.054-5-4a.5.5 0 0 1 .55-.83l.074.05L8 9.359l4.688-3.75z"/>
          </svg>
        </button>
      </div>
      <div id="sp-settings-drawer"></div>
      <div id="sp-panel-body">
        <div id="sp-id-bar">
          <input id="sp-order-input" type="text" placeholder="408-XXXXXXX-XXXXXXX" maxlength="19"/>
          <button id="sp-lookup-btn">Lookup</button>
        </div>
        <div id="sp-id-bar" style="margin-bottom:10px;">
          <input id="sp-asin-input" type="text" placeholder="ASIN (B0XXXXXXXXX)" maxlength="10"/>
          <button id="sp-product-btn">Product</button>
        </div>
        <div id="sp-detected-ids"></div>
        <div id="sp-autofill-bar">
          <button id="sp-autofill-btn">Auto-Fill Form</button>
          <div id="sp-fill-status"></div>
        </div>
        <div id="sp-mcf-bar">
          <button id="sp-mcf-btn">→ MCF</button>
          <div id="sp-mcf-status"></div>
        </div>
        <div id="sp-nrn-bar">
          <button id="sp-nrn-btn" disabled title="Only available on Amazon Buyer Message tickets">Mark as NRN</button>
          <div id="sp-nrn-status"></div>
        </div>
        <div id="sp-notes-section">
          <div id="sp-notes-content"></div>
        </div>
        <div id="sp-ai-reason-result"></div>
        <div id="sp-result">
          <div id="sp-status">Scanning ticket for order IDs…</div>
        </div>
        <div id="sp-product-result"></div>
      </div>
      <div id="sp-load-log"><div id="sp-log-entries"></div></div>
    `;
    return d;
  }

  // ── Format helpers ────────────────────────────────────────────────────────
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('sv-SE', { timeZone: 'UTC' }).slice(0, 16).replace('T', ' ');
  }

  // Seller Central shows purchase dates in the marketplace's local timezone, not UTC.
  // SP-API returns UTC. Convert so GCX Reply matches Seller Central.
  const PURCHASE_TZ_ = {
    IN: 'Asia/Kolkata',     // IST = UTC+5:30
    JP: 'Asia/Tokyo',       // JST = UTC+9
    SG: 'Asia/Singapore',   // SGT = UTC+8
    AU: 'Australia/Sydney', // AEST/AEDT
    KR: 'Asia/Seoul',       // KST = UTC+9
  };
  function purchaseDateLocal_(isoUtc, countryCode) {
    if (!isoUtc) return '';
    const tz = PURCHASE_TZ_[countryCode];
    if (!tz) return isoUtc.slice(0, 10);
    return new Date(isoUtc).toLocaleDateString('sv-SE', { timeZone: tz });
  }
  function fmtPurchaseDate_(isoUtc, countryCode) {
    if (!isoUtc) return '—';
    const tz = PURCHASE_TZ_[countryCode];
    if (!tz) return fmtDate(isoUtc) + ' (UTC)';
    const local = new Date(isoUtc).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16).replace('T', ' ');
    const label = { IN:'IST', JP:'JST', SG:'SGT', AU:'AEST', KR:'KST' }[countryCode] || tz;
    return `${local} (${label})`;
  }

  function fmtShipRange(earliest, latest) {
    if (!earliest) return '—';
    const fmt = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const e = fmt(earliest), l = latest ? fmt(latest) : '';
    return (!l || e === l) ? e : `${e} – ${l}`;
  }

  function row(label, value, isLink) {
    const has = value != null && value !== '' && value !== '—';
    return `<div class="sp-row">
      <span class="sp-label">${esc(label)}</span>
      <span class="sp-val${isLink ? ' link' : ''}">${esc(value) || '—'}</span>
      ${has ? COPY_BTN : ''}
    </div>`;
  }

  function fulfillmentLabel_(channel, sku) {
    if (sku && /pan|eup/i.test(sku)) return 'PAN EU';
    if (channel === 'AFN') return 'FBA';
    if (channel === 'MFN') return 'Merchant (FBM)';
    return channel || '—';
  }

  function rowReturnAsin(asinStr, salesChannel, itemsStatus) {
    if (!asinStr || asinStr === '—') {
      const note = itemsStatus === 403
        ? `<span style="font-size:10.5px;color:#e67e22;margin-left:4px;">(GetOrderItems 권한 필요)</span>`
        : '';
      return `<div class="sp-row"><span class="sp-label">Return ASIN</span><span class="sp-val">—${note}</span></div>`;
    }
    const ch = (salesChannel || 'amazon.com').toLowerCase();
    const links = asinStr.split(',').map(a => a.trim()).filter(Boolean).map(asin => {
      const url = `https://www.${ch}/dp/${asin}`;
      return `<a href="${url}" target="_blank" rel="noopener" style="color:#5ba4cf;text-decoration:underline;">${esc(asin)}</a>`;
    }).join(', ');
    return `<div class="sp-row"><span class="sp-label">Return ASIN</span><span class="sp-val">${links}</span>${COPY_BTN}</div>`;
  }

  function rowLinked(label, text, url) {
    const has = text != null && text !== '' && text !== '—';
    const cell = url
      ? `<a href="${url}" target="_blank" rel="noopener" style="color:#5ba4cf;text-decoration:underline;font-weight:500;">${esc(text)}</a>`
      : `<span class="sp-val">${esc(text) || '—'}</span>`;
    return `<div class="sp-row"><span class="sp-label">${esc(label)}</span>${cell}${has ? COPY_BTN : ''}</div>`;
  }

  // Render selling-marketplace badges from market spreadsheet check
  function marketplacesRow_(mkts) {
    if (!mkts || !mkts.length) {
      return `<div class="sp-row"><span class="sp-label">판매 마켓</span><span class="sp-val" style="color:#aaa;">—</span></div>`;
    }
    const SS_ID  = '172fDVw4tu-hgbpV5FShWj4_SAMxeB54-v5BUlVgJUoA';
    const badges = mkts.map(m => {
      const name = typeof m === 'string' ? m : m.name;
      const gid  = typeof m === 'string' ? null : m.gid;
      const cell = typeof m === 'object' ? m.cell : null;
      let url = `https://docs.google.com/spreadsheets/d/${SS_ID}/edit`;
      if (gid != null) url += `#gid=${gid}`;
      if (cell)        url += `&range=${cell}`;
      return `<a href="${esc(url)}" target="_blank" rel="noopener"
        style="display:inline-block;background:#27ae60;color:#fff;font-size:10px;padding:1px 6px;border-radius:3px;margin-right:3px;margin-bottom:2px;text-decoration:none;">${esc(name)}</a>`;
    }).join('');
    return `<div class="sp-row"><span class="sp-label">판매 마켓</span><span class="sp-val">${badges}</span></div>`;
  }

  // ── Render order data ─────────────────────────────────────────────────────
  function renderOrder(data, orderId, panelAsin, options) {
    options = options || {};
    const showOrder = options.showOrder !== false;
    const showShipping = options.showShipping !== false;
    const prefs = getDataFetchPrefs();

    const o  = data.order   || {};
    const it = data.items   || [];
    const ad = data.address || {};
    const b  = data.buyer   || {};
    const buyerEmail   = b.BuyerEmail || '';
    const scSearchUrl  = sellerCentralSearchUrl_(o.SalesChannel, ad.CountryCode, buyerEmail);

    const itemAsins    = it.map(i => i.ASIN).filter(Boolean);
    const returnAsin   = itemAsins.length ? itemAsins.join(', ') : (panelAsin || '—');
    // All Seller SKUs (multi-item orders list every SKU, deduped, in item order).
    const sellerSkus   = [...new Set(it.map(i => i.SellerSKU).filter(Boolean))];
    const sellerSkuStr = sellerSkus.join(', ');
    // PAN-EU detection: treat the order as PAN if ANY item carries a PAN/EUP SKU.
    const fulfillLabel = fulfillmentLabel_(o.FulfillmentChannel, sellerSkus.join(' ') || it[0]?.SellerSKU || '');
    const amount     = o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : '—';
    const buyerName  = b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '—';

    const addrParts = [ad.Name, ad.AddressLine1, ad.AddressLine2, ad.AddressLine3,
                       [ad.City, ad.StateOrRegion, ad.PostalCode].filter(Boolean).join(' '),
                       ad.CountryCode].filter(Boolean);

    const addrRows = addrParts.map(p =>
      `<div class="sp-row"><span class="sp-val">${esc(p)}</span></div>`
    ).join('');

    const itemRows = it.map(item => {
      const asin  = item.ASIN || '';
      const sku   = item.SellerSKU && item.SellerSKU !== asin ? item.SellerSKU : '';
      const title = item.Title || asin;
      const qty   = item.QuantityOrdered || 1;
      return `<div class="sp-item-card">
        <div class="sp-item-asin" title="${esc(asin)}">${esc(asin)}</div>
        ${sku ? `<div class="sp-item-sku" title="${esc(sku)}">${esc(sku)}</div>` : ''}
        <div class="sp-item-name"><span>${esc(qty)}× ${esc(title)}</span><button class="sp-copy" data-copy="${esc(title)}" title="Copy" tabindex="-1" aria-label="Copy">${COPY_SVG}</button></div>
      </div>`;
    }).join('');

    const orderCountNote = data.totalPurchases != null
      ? ` <span style="color:#888;font-size:11px;">(구매 ${data.totalPurchases}건 / 환불 ${data.totalRefunds}건)</span>`
      : data.orderCount != null
        ? ` <span style="color:#888;font-size:11px;">(총 ${data.orderCount}건)</span>`
        : '';

    if (!prefs.fetchOrder) {
      return `${rowReturnAsin(returnAsin, o.SalesChannel, data.itemsStatus)}`;
    }

    const shippingSection = !prefs.fetchShipping ? '' : `
          <div class="sp-block collapsed" data-sp-section="shipping">
            <div class="sp-block-title" style="font-size:12px;">
              Shipping Address
              <span class="sp-chevron">▾</span>
            </div>
            <div class="sp-block-body">
              ${row('Amazon Fulfillment Methods', fulfillLabel)}
              ${addrRows || '<div class="sp-row"><span class="sp-val">—</span></div>'}
            </div>
          </div>`;

    return `
      ${rowReturnAsin(returnAsin, o.SalesChannel, data.itemsStatus)}

      <div class="sp-block" data-sp-section="order">
        <div class="sp-block-title">
          <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <text x="3" y="38" font-size="38" font-family="Georgia,serif" font-style="italic" fill="#FF9900">a</text>
            <path d="M6 40 Q24 47 42 40" stroke="#FF9900" stroke-width="3" fill="none" stroke-linecap="round"/>
          </svg>
          Order${orderCountNote}
          <span class="sp-chevron">▾</span>
        </div>
        <div class="sp-block-body">
          ${rowLinked('Amazon Order ID', orderId, sellerCentralUrl(orderId, o.SalesChannel, ad.CountryCode))}
          ${row('Seller SKU',       sellerSkuStr)}
          ${row('Order Status',     o.OrderStatus)}
          ${row('Purchase Date',    fmtPurchaseDate_(o.PurchaseDate, ad.CountryCode))}
          ${row('Amount',           amount)}
          ${row('Delivery Level',   o.ShipmentServiceLevelCategory || o.ShipServiceLevelCategory)}
          ${row('Ship Date',        fmtShipRange(o.EarliestShipDate, o.LatestShipDate))}

          ${shippingSection}
          ${row('Ship Service Level',  o.ShipServiceLevel)}
          ${row('Buyer Name',          buyerName)}
          ${rowLinked('구매이력 (2yr)',
              data.totalPurchases != null
                ? `구매 ${data.totalPurchases}건 / 환불 ${data.totalRefunds}건`
                : '—',
              scSearchUrl)}

          ${it.length > 0 ? `<div class="sp-items-title">Items (${it.length})</div>${itemRows}` : ''}
        </div>
      </div>
    `;
  }

  // ── Seller Central buyer purchase stats (SC session fallback) ────────────
  // SP-API often lacks BuyerEmail PII permission → use the user's logged-in SC
  // session. Hits /orders-api/order/{id} for buyer email, then
  // /orders-api/search?qt=email&q={email} for a 2-year order count.
  function fetchScBuyerStats_(orderId, salesChannel, countryCode, cb) {
    const scUrl = sellerCentralUrl(orderId, salesChannel, countryCode);
    if (!scUrl) { cb(null); return; }
    const base = scUrl.match(/^https:\/\/[^/]+/)[0];

    GM_xmlhttpRequest({
      method: 'GET',
      url: `${base}/orders-api/order/${orderId}`,
      redirect: 'follow',
      timeout: 15000,
      onload(res) {
        let email = null;
        if (res.status === 200) {
          try {
            const d = JSON.parse(res.responseText);
            email = d.order?.buyerEmail || d.order?.buyer?.email || null;
          } catch {}
          if (!email) {
            const m = res.responseText.match(/"([^"@]+@marketplace\.amazon\.[^"]+)"/);
            if (m) email = m[1];
          }
        }
        if (!email) { cb(null); return; }
        countByEmail_(email);
      },
      onerror() { cb(null); },
      ontimeout() { cb(null); },
    });

    function countByEmail_(email) {
      const now = Date.now();
      const twoYearsAgo = Math.round(now - 2 * 365.25 * 24 * 3600 * 1000);
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${base}/orders-api/search?qt=email&q=${encodeURIComponent(email)}&date-range=${twoYearsAgo}-${now}`,
        redirect: 'follow',
        timeout: 15000,
        onload(res) {
          let count = null;
          if (res.status === 200) {
            try {
              const d = JSON.parse(res.responseText);
              count = d.totalCount ?? d.totalOrders
                   ?? (Array.isArray(d.orders) ? d.orders.length : null);
            } catch {
              const m = res.responseText.match(/"(?:totalCount|totalOrders)"\s*:\s*(\d+)/);
              if (m) count = parseInt(m[1], 10);
            }
          }
          cb({ email, totalPurchases: count, totalRefunds: 0 });
        },
        onerror()  { cb({ email, totalPurchases: null }); },
        ontimeout() { cb({ email, totalPurchases: null }); },
      });
    }
  }

  // ── Seller Central orders-api fallback for ASIN + SKU ────────────────────
  // Uses the user's existing SC session cookies — no extra auth needed.
  // Tries marketplace-specific SC domain first, then sellercentral.amazon.com
  // (global SC) as fallback — Spigen accesses most markets via the global domain.
  function fetchScItems(orderId, salesChannel, countryCode, cb) {
    const scPageUrl = sellerCentralUrl(orderId, salesChannel, countryCode);
    const primaryUrl  = scPageUrl ? scPageUrl.replace('/orders-v3/order/', '/orders-api/order/') : null;
    const fallbackUrl = `https://sellercentral.amazon.com/orders-api/order/${orderId}`;

    function parseItems(responseText) {
      const d = JSON.parse(responseText);
      return (d.order?.orderItems || [])
        .map(it => ({ ASIN: it.ASIN, SellerSKU: it.SellerSKU, Title: it.Title, QuantityOrdered: it.QuantityOrdered }))
        .filter(it => it.ASIN);
    }

    function tryUrl(url, onFail) {
      GM_xmlhttpRequest({
        method:  'GET',
        url,
        headers: { 'Accept': 'application/json' },
        redirect: 'follow',
        timeout:  20000,
        onload(res) {
          if (res.status !== 200) {
            logStep_(`SC items: ${url.replace(/^https:\/\//,'')} → HTTP ${res.status}${res.finalUrl && res.finalUrl !== url ? ` (→ ${res.finalUrl.replace(/^https:\/\//,'').slice(0,40)})` : ''}`);
            return onFail();
          }
          try {
            const items = parseItems(res.responseText);
            if (items.length) cb(items);
            else {
              const head = (res.responseText || '').trim().slice(0, 60).replace(/\s+/g, ' ');
              logStep_(`SC items: 200 but 0 parsed — body starts: "${head}"`);
              onFail();
            }
          } catch (e) {
            logStep_(`SC items: parse error — ${e.message}`);
            onFail();
          }
        },
        onerror()   { logStep_(`SC items: network error on ${url.replace(/^https:\/\//,'').slice(0,40)}`); onFail(); },
        ontimeout() { logStep_('SC items: timeout'); onFail(); },
      });
    }

    if (primaryUrl && primaryUrl !== fallbackUrl) {
      tryUrl(primaryUrl, () => tryUrl(fallbackUrl, () => cb(null)));
    } else {
      tryUrl(fallbackUrl, () => cb(null));
    }
  }

  // ── Fetch order via GAS ───────────────────────────────────────────────────
  function fetchOrder(orderId, _retries) {
    _retries = _retries || 0;
    const _session = _panelSession;
    setStatus('Fetching order data…', true);
    if (!_retries) logStep_(`Fetching order ${orderId}…`);
    GM_xmlhttpRequest({
      method:   'GET',
      url:      `${GAS_URL}?orderId=${encodeURIComponent(orderId)}`,
      redirect: 'follow',
      timeout:  30000,
      onload(res) {
        if (_panelSession !== _session) return;
        const result = document.getElementById('sp-result');
        if (!result) return;
        if (res.responseText.trimStart().startsWith('<')) {
          if (_retries < 2) {
            logStep_(`GAS not ready — retry ${_retries + 1}/2…`);
            setStatus('Retrying…', true);
            setTimeout(() => fetchOrder(orderId, _retries + 1), 2000);
            return;
          }
          setStatus('GAS error — refresh and try again');
          logStep_('Order fetch: GAS returned error page');
          return;
        }
        try {
          const data = JSON.parse(res.responseText);
          if (data.error) { setStatus(data.error); logStep_('Order error: ' + data.error); return; }

          // Store for auto-fill
          lastOrderData = data;
          logStep_(`Order loaded — ${data.order?.SalesChannel || data.region || 'unknown'} | 구매이력: ${data.totalPurchases != null ? `구매 ${data.totalPurchases}건 / 환불 ${data.totalRefunds}건` : 'N/A'}`);
          maybeShowAutoFill(document.getElementById(PANEL_ID));

          const asinInput = document.getElementById('sp-asin-input');
          const itemAsins = (data.items || []).map(i => i.ASIN).filter(Boolean);

          // Resolve ASIN before rendering: SP-API items > current input > page scan
          let resolvedAsin = asinInput?.value.trim() || '';
          if (itemAsins.length) {
            if (asinInput && !asinInput.value) asinInput.value = itemAsins.join(', ');
            resolvedAsin = asinInput?.value.trim() || itemAsins[0] || '';
          } else if (!resolvedAsin) {
            const pageAsins = [...new Set([...document.body.innerText.matchAll(ASIN_RE)].map(m => m[1]))];
            const detected  = pageAsins[0];
            if (detected && asinInput) { asinInput.value = detected; resolvedAsin = detected; }
          }

          result.innerHTML = renderOrder(data, orderId, resolvedAsin);
          result.querySelectorAll('.sp-block-title').forEach(title => {
            title.addEventListener('click', e => {
              e.stopPropagation();
              title.closest('.sp-block').classList.toggle('collapsed');
            });
          });
          applySectionState(result);

          // SC session fallback: get buyer email + 2yr order count when SP-API can't provide it
          if (data.totalPurchases == null) {
            fetchScBuyerStats_(orderId, data.order?.SalesChannel, data.address?.CountryCode, stats => {
              if (_panelSession !== _session || !result.isConnected || !stats) return;
              if (stats.totalPurchases == null && !stats.email) return;
              const updated = Object.assign({}, data, {
                totalPurchases: stats.totalPurchases ?? data.totalPurchases,
                totalRefunds:   stats.totalRefunds   ?? data.totalRefunds ?? 0,
                buyer: Object.assign({}, data.buyer || {}, stats.email ? { BuyerEmail: stats.email } : {}),
              });
              lastOrderData = Object.assign({}, lastOrderData, updated);
              logStep_(`SC buyer stats: 구매 ${stats.totalPurchases ?? '?'}건`);
              result.innerHTML = renderOrder(updated, orderId, resolvedAsin);
              result.querySelectorAll('.sp-block-title').forEach(t => {
                t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
              });
              applySectionState(result);
              maybeShowAutoFill(document.getElementById(PANEL_ID));
            });
          }

          const prefs = getDataFetchPrefs();

          // Spigen-sheet product lookup is gated by the Product Info toggle.
          // Seller SKU / item ASINs are ORDER data and must NOT be gated by it.
          const doProductLookup = asins => {
            if (prefs.fetchProduct && asins && asins.length) {
              logStep_(`Product lookup: ${asins.join(', ')}`);
              renderAllProducts(asins);
            } else {
              _productReady = true;
              maybeShowAutoFill(document.getElementById(PANEL_ID));
            }
          };

          const rerenderOrder = renderAsin => {
            result.innerHTML = renderOrder(lastOrderData, orderId, renderAsin);
            result.querySelectorAll('.sp-block-title').forEach(t => {
              t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
            });
            applySectionState(result);
            maybeShowAutoFill(document.getElementById(PANEL_ID));
          };

          // Do we already have Seller SKU(s) from SP-API? (Almost never — items 403.)
          const haveSellerSku = (data.items || []).some(i => i.SellerSKU);

          if (haveSellerSku) {
            doProductLookup(itemAsins);
          } else {
            // No Seller SKU yet → ALWAYS query the Seller Central session for the full
            // item list (every SellerSKU + ASIN), regardless of itemsStatus or the
            // Product Info toggle. Seller SKU is order data the agent needs.
            logStep_(`Seller SKU: querying Seller Central (itemsStatus=${data.itemsStatus})…`);
            if (!resolvedAsin) {
              const asinValEl = result.querySelector('.sp-row .sp-val');
              if (asinValEl) asinValEl.textContent = 'Seller Central…';
            }
            fetchScItems(orderId, data.order?.SalesChannel, data.address?.CountryCode, scItems => {
              if (_panelSession !== _session || !result.isConnected) return;
              if (scItems && scItems.length) {
                logStep_(`Seller SKU: SC returned ${scItems.length} item(s) — ${scItems.map(i => i.SellerSKU).filter(Boolean).join(', ') || 'no SKU'}`);
                lastOrderData.items = scItems;
                const newAsins = scItems.map(i => i.ASIN).filter(Boolean);
                if (asinInput && !asinInput.value) asinInput.value = newAsins.join(', ');
                rerenderOrder(newAsins.join(', ') || resolvedAsin);
                doProductLookup(newAsins.length ? newAsins : (resolvedAsin ? [resolvedAsin] : itemAsins));
              } else {
                // SC returned nothing → fall back to any ASIN we already have.
                logStep_('Seller SKU: SC returned no items');
                doProductLookup(resolvedAsin ? [resolvedAsin] : itemAsins);
              }
            });
          }
        } catch (err) {
          setStatus('Parse error: ' + err.message);
        }
      },
      onerror()   { setStatus('Cannot reach GAS endpoint — check GAS_URL in script settings.'); },
      ontimeout() {
        if (_panelSession !== _session) return;
        if (_retries < 2) {
          logStep_(`Order timeout — retry ${_retries + 1}/2…`);
          setStatus('Retrying…');
          setTimeout(() => fetchOrder(orderId, _retries + 1), 3000);
        } else {
          setStatus('Request timed out.');
          logStep_('Order fetch: timed out after 2 retries');
        }
      },
    });
  }

  const LOADING_GIF = 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Loading_icon.gif?_=20151024034921';
  function setStatus(msg, isLoading = false) {
    const html = isLoading
      ? `<img src="${LOADING_GIF}" style="width:14px;height:14px;vertical-align:middle;margin-right:5px;">${esc(msg)}`
      : esc(msg);
    const el = document.getElementById('sp-status');
    if (el) { el.innerHTML = html; return; }
    const result = document.getElementById('sp-result');
    if (result) result.innerHTML = `<div id="sp-status">${html}</div>`;
  }

  function logStep_(msg) {
    const entries = document.getElementById('sp-log-entries');
    if (!entries) return;
    const t    = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = document.createElement('div');
    line.textContent = `${t}  ${msg}`;
    entries.appendChild(line);
    entries.scrollTop = entries.scrollHeight;
  }

  // ── Auto-detect order IDs from visible ticket text ─────────────────────
  function detectOrderIds() {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    const pane = (m && document.querySelector(`[data-test-id="ticket-${m[1]}-standard-layout"]`)) || document.body;
    const inputText = [...pane.querySelectorAll('input, textarea')].map(el => el.value || '').join('\n');
    const text = (pane.innerText || '') + '\n' + inputText;
    return [...new Set([...text.matchAll(ORDER_RE)].map(m => m[1]))];
  }

  function updateDetectedChips(panel, skipAutoLoad, extraIds = []) {
    const domIds = detectOrderIds();
    // API-sourced IDs (from ticket description) take priority; DOM scan fills the rest
    const ids = [...new Set([...extraIds, ...domIds])];
    const bar = panel.querySelector('#sp-detected-ids');
    if (!bar) return;

    const existingSet = new Set([...bar.querySelectorAll('.sp-chip')].map(c => c.dataset.id));
    if (ids.length === existingSet.size && ids.every(id => existingSet.has(id))) return;
    // Don't wipe chips when an order is already loaded / being fetched
    if (ids.length === 0 && existingSet.size > 0) return;

    bar.innerHTML = '';
    if (ids.length >= 2) {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:11px;color:#888;width:100%;margin-bottom:3px;font-weight:500;';
      lbl.textContent   = `주문 ID ${ids.length}개 발견 — 선택하세요:`;
      bar.appendChild(lbl);
    }
    ids.forEach(id => {
      const chip = document.createElement('span');
      chip.className    = 'sp-chip';
      chip.textContent  = id;
      chip.dataset.id   = id;
      chip.title        = 'Click to look up this order';
      chip.onclick = () => {
        document.getElementById('sp-order-input').value = id;
        fetchOrder(id);
      };
      bar.appendChild(chip);
    });

    if (!skipAutoLoad) {
      if (ids.length === 1 && document.getElementById('sp-status')) {
        const input = panel.querySelector('#sp-order-input');
        if (!input.value) { input.value = ids[0]; fetchOrder(ids[0]); }
      } else if (ids.length === 0) {
        setStatus('No Amazon order ID found on this ticket. Paste one above.');
      } else {
        setStatus('');
      }
    }
  }

  // ── Draggable panel ───────────────────────────────────────────────────────
  function makeDraggable(panel, handle) {
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('#sp-settings-btn, #sp-minimize-btn, #sp-panel-close, .sp-re, button, input, textarea, select, a')) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      let moved = false;
      const onMove = e2 => {
        if (!moved) panel.classList.add('sp-dragging');
        moved = true;
        panel.style.left  = (e2.clientX - offX) + 'px';
        panel.style.top   = (e2.clientY - offY) + 'px';
        panel.style.right = 'auto';
      };
      const onUp = () => {
        handle._dragMoved = moved;
        if (moved) {
          saveUi({ x: parseInt(panel.style.left), y: parseInt(panel.style.top) });
          panel.classList.remove('sp-dragging');
        }
        removeEventListener('mousemove', onMove);
        removeEventListener('mouseup', onUp);
      };
      addEventListener('mousemove', onMove);
      addEventListener('mouseup', onUp);
    });
  }

  // ── Resizable panel — 8 edge/corner grips bypass scrollbar interception ──
  // Root cause of old approach: panel.addEventListener('mousedown') was never
  // fired on the right edge because #sp-panel-body's native scrollbar
  // (overflow-y:auto) intercepts pointer events and does not bubble them.
  // Fix: invisible position:absolute divs (.sp-re-*) at z-index:9998 sit above
  // the scrollbar and fire reliable mousedown events directly.
  function makeResizable_(panel) {
    const MIN_W = 280, MAX_W = 700, MIN_H = 80;

    const DIRS = {
      'sp-re-n':  { top: true },
      'sp-re-ne': { top: true,    right: true  },
      'sp-re-e':  {               right: true  },
      'sp-re-se': { bottom: true, right: true  },
      'sp-re-s':  { bottom: true              },
      'sp-re-sw': { bottom: true, left: true   },
      'sp-re-w':  {               left: true   },
      'sp-re-nw': { top: true,    left: true   },
    };

    Object.entries(DIRS).forEach(([cls, h]) => {
      const el = panel.querySelector('.' + cls);
      if (!el) return;

      el.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();

        const isDocked = panel.classList.contains('sp-docked');

        const r = panel.getBoundingClientRect();
        if (!isDocked) {
          // Normalize to left/top anchor so all resize math is consistent
          panel.style.left  = r.left + 'px';
          panel.style.right = 'auto';
          panel.style.top   = r.top  + 'px';
        }

        const startX = e.clientX, startY = e.clientY;
        const startLeft = r.left, startTop = r.top;
        const startW = r.width;
        // In docked mode use offsetHeight (unclipped CSS height) not BCR height
        // which is capped to the mount's visible area and causes wrong startH.
        const startH = isDocked ? panel.offsetHeight : r.height;

        const onMove = ev => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!isDocked) {
            if (h.right) panel.style.width  = Math.max(MIN_W, Math.min(MAX_W, startW + dx)) + 'px';
            if (h.left) {
              const nw = Math.max(MIN_W, Math.min(MAX_W, startW - dx));
              panel.style.width = nw + 'px';
              panel.style.left  = (startLeft + startW - nw) + 'px';
              panel.style.right = 'auto';
            }
            if (h.top) {
              const nh = Math.max(MIN_H, startH - dy);
              panel.style.height = nh + 'px';
              panel.style.top    = (startTop + startH - nh) + 'px';
            }
          }
          // Bottom-drag resizes height in both floating and docked modes
          if (h.bottom) {
            const newH = Math.max(MIN_H, startH + dy);
            panel.style.height = newH + 'px';
            // Docked: scroll the nearest scrollable ancestor so the resize grip
            // stays visible under the cursor regardless of which container clips.
            if (isDocked) el.scrollIntoView({ block: 'end', behavior: 'instant' });
          }
        };

        const onUp = () => {
          if (isDocked) {
            saveUi({ dockH: panel.offsetHeight });
          } else {
            saveUi({
              x: panel.style.left ? parseInt(panel.style.left) : null,
              y: panel.style.top  ? parseInt(panel.style.top)  : null,
              w: panel.offsetWidth,
              h: panel.offsetHeight,
            });
          }
          document.body.style.cursor     = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };

        document.body.style.cursor     = getComputedStyle(el).cursor;
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });
  }

  // ── Dock mode: mount the panel inside Zendesk's Apps panel ────────────────
  // Userscripts can't be native ZAF apps, so we DOM-inject. The mount point is
  // auto-discovered from the installed app iframes (ChannelReply/Trello live on
  // zdusercontent.com); we inject our panel as the first child of the scroll
  // container that holds them. A MutationObserver re-mounts after re-renders.
  let _dockObserver = null;
  let _dockObserverDebounce = null;
  let _dockFailedAt = null; // timestamp of first failed dock attempt after nav; used for floating fallback

  // Returns the DOM element for the current ticket panel, or null if not on a ticket.
  // Used to scope all DOM queries so we never mount into a stale/hidden ticket panel
  // (Zendesk keeps every open tab's DOM alive simultaneously).
  function ticketScope_() {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    const id = m && m[1];
    return (id && document.querySelector(`[data-test-id="ticket-${id}-standard-layout"]`)) || null;
  }

  function findAppsPanelMount_() {
    const W = window.innerWidth, H = window.innerHeight;
    console.log('[GCX] findAppsPanelMount_ W=' + W + ' H=' + H);

    // 0. Scope all queries to the current ticket's DOM so we never find/mount into
    //    a stale ticket panel — Zendesk keeps all open tab DOMs alive simultaneously.
    const _scope = ticketScope_() || document;
    console.log('[GCX] ticket scope:', _scope === document ? 'document (no ticket)' : _scope.getAttribute('data-test-id'));

    // 1. Explicit Zendesk data-test-id selectors.
    // "omnipanel-pane-wrapper-apps" is confirmed by console diagnostics as the
    // correct Apps panel container in the new Zendesk navigation layout.
    const direct = _scope.querySelector(
      '[data-test-id="omnipanel-pane-wrapper-apps"], ' +
      '[data-test-id="ticket-apps-pane"], [data-test-id="apps-tray"], ' +
      '[data-test-id="omnipanel-apps"], [data-test-id="ticket_sidebar"], ' +
      '[data-test-id="apps-container"], [data-test-id="sidebar-apps"]'
    );
    if (direct) { console.log('Step1 HIT:', direct);  return direct; }
    console.log('Step1: no data-test-id match');

    // 1.5. New Zendesk omnipanel — find the Apps content area.
    // The new Zendesk right panel has a narrow icon bar (~64px, contains
    // data-test-id="omnipanel-selector-item-*" buttons) and a wider content area
    // as its sibling. Walk up from the Apps icon button; at the first ancestor
    // where the icon bar (narrow ≤120px) and a wider content sibling both exist,
    // return the content sibling as the mount point.
    const omnipanelAppsBtn = _scope.querySelector('[data-test-id="omnipanel-selector-item-apps"]');
    if (omnipanelAppsBtn) {
      console.log('Step1.5: omnipanel Apps button found, walking up...');
      let el15 = omnipanelAppsBtn;
      for (let d = 0; d < 10 && el15.parentElement && el15 !== document.body; d++) {
        el15 = el15.parentElement;
        const visKids = [...el15.children].filter(c => {
          if (c.id === PANEL_ID) return false;
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (visKids.length < 2) continue;
        const selBranch = visKids.find(c => c.contains(omnipanelAppsBtn));
        if (!selBranch) continue;
        const selW = selBranch.getBoundingClientRect().width;
        if (selW > 120) continue; // icon bar must be narrow
        const contentBranch = visKids.find(c => c !== selBranch && c.getBoundingClientRect().width > 80);
        if (contentBranch) {
          console.log('Step1.5: contentBranch found selW=' + Math.round(selW), contentBranch);
          // Go deeper: the contentBranch may be a wrapper with multiple sections
          // in a flex-row layout. Find the apps-specific child where [data-app-id]
          // or zdusercontent iframes live so we mount at the same level as ChannelReply.
          const deepApp = contentBranch.querySelector('[data-app-id]');
          if (deepApp?.parentElement && deepApp.parentElement !== contentBranch) {
            const dm = deepApp.parentElement;
            console.log('Step1.5 HIT (deep data-app-id):', dm);
            
            logStep_('Dock: apps list found');
            return dm;
          }
          const deepIframe = [...contentBranch.querySelectorAll('iframe')]
            .find(f => /zdusercontent\.com/.test(f.src || ''));
          if (deepIframe) {
            let iEl = deepIframe;
            for (let j = 0; j < 8 && iEl.parentElement && iEl !== contentBranch; j++) {
              iEl = iEl.parentElement;
              if (iEl.parentElement === contentBranch) break;
            }
            if (iEl !== contentBranch) {
              console.log('Step1.5 HIT (deep iframe):', iEl.parentElement || iEl);
              
              logStep_('Dock: apps iframe parent found');
              return iEl.parentElement || iEl;
            }
          }
          // Guard: only mount in the Apps pane. When Customer Context / Knowledge
          // / another section is active, contentBranch is their pane wrapper
          // (e.g. omnipanel-pane-wrapper-customer-context). Mounting there would
          // show GCX Reply in the wrong section and trigger churn.
          // Break out so mountDocked_ can auto-click the Apps icon instead.
          const _cbId = contentBranch.getAttribute('data-test-id') || '';
          if (_cbId && !_cbId.includes('apps')) {
            console.log('Step1.5: non-Apps section active (' + _cbId + ') — skipping, will click Apps icon');
            break;
          }
          console.log('Step1.5 HIT (contentBranch fallback):', contentBranch);

          logStep_('Dock: omnipanel content found');
          return contentBranch;
        }
      }
      console.log('Step1.5: walked up but no content sibling detected');
    } else {
      console.log('Step1.5: no omnipanel-selector-item-apps in DOM');
    }

    // 2. [data-app-id] filtered by CENTER position — Zendesk adds this attribute to
    //    each installed app wrapper (ChannelReply block, etc.). Using center-X instead
    //    of left edge is robust across different window widths. Center X > 60% of
    //    viewport means the element sits in the right portion of the page (Apps panel),
    //    not in the center ticket-editor area.
    const allAppIds = [..._scope.querySelectorAll('[data-app-id]')];
    console.log('Step2: [data-app-id] count =', allAppIds.length);
    allAppIds.forEach(el => {
      const r = el.getBoundingClientRect();
      console.log('  data-app-id', el.getAttribute('data-app-id'),
        'tag=' + el.tagName, 'left=' + Math.round(r.left), 'w=' + Math.round(r.width),
        'centerX=' + Math.round(r.left + r.width/2), 'h=' + Math.round(r.height),
        '60%threshold=' + Math.round(W * 0.6));
    });
    const sidebarApp = allAppIds.find(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return (r.left + r.width / 2) > W * 0.6;
    });
    if (sidebarApp?.parentElement) {
      console.log('Step2 HIT:', sidebarApp, '→ parent:', sidebarApp.parentElement);
      
      logStep_('Dock: data-app-id found');
      return sidebarApp.parentElement;
    }
    console.log('Step2: no [data-app-id] matched center-X threshold');

    // Guard: if the omnipanel icon bar (the narrow button strip containing
    // omnipanel-selector-item-* buttons) is completely absent, Zendesk is mid-SPA
    // and has torn down the old ticket panel but not yet rendered the new one.
    // Any zdusercontent iframes found by Step 3 belong to the old ticket context
    // and will be replaced within milliseconds, making any mount instantly unstable.
    // Return null here so the observer/heartbeat keeps retrying until the omnipanel
    // is ready, rather than triggering the unstable-mount loop that resets
    // _dockFailedAt on every brief success and prevents the floating fallback.
    if (!_scope.querySelector('[data-test-id*="omnipanel-selector-item"]')) {
      console.log('Step3: omnipanel icon bar absent — mid-SPA-nav, returning null');
      return null;
    }

    // 3. zdusercontent iframe walk-up
    const allIframes = [..._scope.querySelectorAll('iframe')];
    console.log('Step3: iframes total=' + allIframes.length);
    allIframes.forEach(f => {
      const r = f.getBoundingClientRect();
      console.log('  iframe src=' + (f.src||'').slice(0,60), 'display=' + getComputedStyle(f).display, 'left=' + Math.round(r.left), 'w=' + Math.round(r.width));
    });
    const appIframe = allIframes.find(f => /zdusercontent\.com/.test(f.src || ''));
    console.log('Step3: zdusercontent iframe', appIframe ? 'FOUND src=' + appIframe.src.slice(0,60) : 'NOT FOUND');

    if (appIframe) {
      let el = appIframe;
      let appBlock = null;
      for (let i = 0; i < 22 && el.parentElement && el !== document.body; i++) {
        el = el.parentElement;
        const children = [...el.children].filter(c => c.id !== PANEL_ID);
        if (children.length < 2) continue;
        const hasIframeBranch = children.some(c => c === appIframe || c.contains(appIframe));
        const hasOtherBranch  = children.some(c => !c.contains(appIframe) && c.getBoundingClientRect().height > 0);
        if (hasIframeBranch && hasOtherBranch) { appBlock = el; break; }
      }
      if (appBlock?.parentElement) {
        console.log('Step3 HIT app-block:', appBlock, '→ parent:', appBlock.parentElement);
        
        logStep_('Dock: app-block found');
        return appBlock.parentElement;
      }
      el = appIframe;
      const scrollEls = [];
      for (let i = 0; i < 18 && el.parentElement && el !== document.body; i++) {
        el = el.parentElement;
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.clientHeight > 100) scrollEls.push(el);
      }
      if (scrollEls.length) {
        const best = scrollEls.reduce((b, c) => c.clientHeight > b.clientHeight ? c : b);
        console.log('Step3 scroll fallback:', best);
        
        return best;
      }
      console.log('Step3 iframe.parentElement fallback:', appIframe.parentElement);
      
      return appIframe.parentElement;
    }

    // 4. Semantic: <aside> or complementary role on the right side.
    //    Exclude modal dialogs (onboarding, announcements) and aria-hidden overlays —
    //    the new Zendesk navigation renders a data-test-id="onboarding-panel" aside
    //    on the right side that is hidden (aria-hidden=true, role=dialog).
    const aside = [...document.querySelectorAll('aside, [role="complementary"]')].find(el => {
      if (el.getAttribute('role') === 'dialog') return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.hasAttribute('aria-modal')) return false;
      const r = el.getBoundingClientRect();
      return r.left > W * 0.4 && r.height > H * 0.3;
    });
    if (aside) { console.log('Step4 aside HIT:', aside);  return aside; }
    console.log('Step4: no aside/complementary on right side');

    // 5. "Apps" heading text — Zendesk always renders this in the apps panel header.
    const appsHeading = [...document.querySelectorAll('h1,h2,h3,h4,strong,b,span,label,div')]
      .find(el => {
        if (el.children.length > 0) return false;
        if (el.textContent.trim() !== 'Apps') return false;
        const r = el.getBoundingClientRect();
        return (r.left + r.width / 2) > W * 0.4 && r.top < H * 0.4;
      });
    console.log('Step5: "Apps" heading', appsHeading ? 'FOUND' : 'NOT FOUND', appsHeading || '');
    if (appsHeading) {
      let el = appsHeading.parentElement;
      for (let i = 0; i < 15 && el && el !== document.body; i++) {
        const r = el.getBoundingClientRect();
        if (r.height > H * 0.4 && el.children.length >= 1) {
          console.log('Step5 HIT:', el);
          
          return el;
        }
        el = el.parentElement;
      }
    }

    console.log('ALL STEPS FAILED — returning null');
    
    return null;
  }

  function mountDocked_(panel) {
    // Set up the DOM-watch observer BEFORE any early return so it is always
    // active — even when the Apps pane isn't rendered yet.
    // Debounced at 80ms to avoid calling mountDocked_() hundreds of times
    // per second when Zendesk is doing complex React re-renders.
    if (!_dockObserver) {
      _dockObserver = new MutationObserver(() => {
        if (!loadUi().dockMode || panel.isConnected) return;
        // Immediate (no debounce) check — Zendesk may render omnipanel-pane-wrapper-apps
        // only briefly during a React commit before moving it into the hub iframe.
        // Catching it here without delay is critical; the 80ms debounce below misses it.
        if ((ticketScope_() || document).querySelector('[data-test-id="omnipanel-pane-wrapper-apps"]')) {
          mountDocked_(panel);
          return;
        }
        clearTimeout(_dockObserverDebounce);
        _dockObserverDebounce = setTimeout(() => {
          if (!loadUi().dockMode || panel.isConnected) return;
          if ((ticketScope_() || document).querySelector('[data-test-id="omnipanel-pane-wrapper-apps"]')) {
            mountDocked_(panel);
          } else if (!panel._autoClickedAppsBtn) {
            // Apps pane not rendered — Apps section may be inactive.
            // Click the Apps icon to activate it. Allow re-click after 2s in
            // case the first click didn't trigger a render (React synthetic event issue).
            const appsBtn = (ticketScope_() || document).querySelector('[data-test-id="omnipanel-selector-item-apps"]');
            if (appsBtn && appsBtn.getAttribute('aria-pressed') !== 'true') {
              panel._autoClickedAppsBtn = true;
              logStep_('Dock: clicking Apps icon to activate section');
              appsBtn.click();
              setTimeout(() => { panel._autoClickedAppsBtn = false; }, 2000);
            }
          }
        }, 80);
      });
      _dockObserver.observe(document.body, { childList: true, subtree: true });
    }

    const mount = findAppsPanelMount_();
    if (!mount) {
      // If the Apps icon is in the DOM but its section isn't active (e.g. Customer
      // Context is the saved default), click it so Zendesk renders
      // omnipanel-pane-wrapper-apps. The immediate observer check will then catch
      // the DOM mutation and mount correctly.  2s guard prevents rapid re-clicks.
      if (!panel._autoClickedAppsBtn) {
        const appsBtn_ = (ticketScope_() || document).querySelector('[data-test-id="omnipanel-selector-item-apps"]');
        if (appsBtn_ && appsBtn_.getAttribute('aria-pressed') !== 'true') {
          panel._autoClickedAppsBtn = true;
          logStep_('Dock: clicking Apps icon to activate section');
          appsBtn_.click();
          setTimeout(() => { panel._autoClickedAppsBtn = false; }, 2000);
        }
      }
      if (!panel.isConnected) {
        if (loadUi().dockMode) {
          // After 2s of failed dock attempts, show panel floating so the user
          // always sees it even when Zendesk renders the omnipanel inside a
          // cross-origin hub iframe (unreachable from the main document).
          // The heartbeat's inFloatingFallback path keeps retrying mountDocked_()
          // so the panel re-docks the moment the omnipanel appears in main doc.
          if (!_dockFailedAt) _dockFailedAt = Date.now();
          if (Date.now() - _dockFailedAt >= 1000) {
            panel.classList.remove('sp-docked');
            panel._gcxHiddenBySection = false;
            panel.style.display = '';
            document.body.appendChild(panel);
            logStep_('Dock: 1s timeout — floating fallback (heartbeat retries dock)');
          } else {
            logStep_('Dock: mount not found — staying detached, observer + heartbeat will retry.');
          }
        } else {
          panel.classList.remove('sp-docked');
          document.body.appendChild(panel);
          logStep_('Dock: mount not found — showing floating, heartbeat will retry.');
        }
      }
      return;
    }
    _dockFailedAt = null; // reset — dock succeeded
    // Standalone block at the top of the Apps panel — independent of ChannelReply.
    if (panel.parentElement !== mount || panel.previousElementSibling) {
      mount.insertBefore(panel, mount.firstChild);
      const mountTag = mount.tagName + (mount.className ? '.' + mount.className.toString().trim().split(/\s+/)[0] : '');
      logStep_('Dock: mounted in ' + mountTag + ' (kids=' + mount.children.length + ')');
    }
    panel.classList.add('sp-docked');

    // Restore user-set docked height. Default is 300px so ChannelReply
    // remains visible below GCX Reply in the 735px wrapper.
    const savedDockH = loadUi().dockH;
    panel.style.height = (savedDockH > 80 ? savedDockH : 300) + 'px';

    // The new Zendesk omnipanel-pane-wrapper-apps container uses flex-direction:row,
    // which places GCX Reply and ChannelReply side-by-side instead of stacked.
    // Force column layout so apps stack vertically.
    // Scroll is handled by #sp-panel-body inside the panel (same as floating mode),
    // so we do not need a max-height or overflow on the mount itself.
    mount.style.flexDirection = 'column';
    mount.style.overflowX = 'hidden';
    panel.classList.remove('minimized');
    const tgl = document.getElementById('sp-toggle-btn');
    if (tgl) tgl.style.display = 'none';

    // New Zendesk omnipanel: the content area is shared across sections
    // (Apps, Customer Context, Knowledge, etc.). Sync GCX Reply's visibility
    // with the Apps icon button so it only shows when Apps section is active.
    // Always re-attach to the *current* Apps icon DOM element — Zendesk
    // replaces this element on every SPA navigation, making the old observer stale.
    const appsIconBtn_ = (ticketScope_() || document).querySelector('[data-test-id="omnipanel-selector-item-apps"]');
    if (appsIconBtn_) {
      const syncSectionVis_ = () => {
        const live = appsIconBtn_.isConnected;
        const inApps = appsIconBtn_.getAttribute('aria-pressed') === 'true';
        logStep_('Dock: syncSection inApps=' + inApps + ' btn=' + (live ? 'live' : 'STALE'));
        panel._gcxHiddenBySection = !inApps;
        panel.style.display = inApps ? '' : 'none';
      };
      syncSectionVis_();
      // When the Apps section isn't currently active, the panel is hidden.
      // Auto-click the Apps icon once per ticket visit so it appears without
      // the user having to manually switch sections. Step 3 of findAppsPanelMount_
      // finds the zdusercontent iframe mount even when Apps isn't active, so the
      // old auto-click code in the !mount branch is never reached in this case.
      if (panel._gcxHiddenBySection && !panel._autoClickedAppsBtn) {
        panel._autoClickedAppsBtn = true;
        logStep_('Dock: clicking Apps icon (section not active)');
        appsIconBtn_.click();
        setTimeout(() => { panel._autoClickedAppsBtn = false; }, 2000);
      }
      // Always recreate the observer so the callback closure captures the current
      // appsIconBtn_ reference. Reusing the old observer across SPA navigations
      // would keep the stale closure from the first mountDocked_() call, which
      // reads a detached element's aria-pressed and permanently hides the panel.
      if (panel._sectionObserver) panel._sectionObserver.disconnect();
      panel._sectionObserver = new MutationObserver(syncSectionVis_);
      panel._sectionObserver.observe(appsIconBtn_, { attributes: true, attributeFilter: ['aria-pressed'] });
    } else {
      panel._gcxHiddenBySection = false;
      panel.style.display = '';
      if (panel._sectionObserver) { panel._sectionObserver.disconnect(); panel._sectionObserver = null; }
    }
  }

  function mountFloating_(panel) {
    if (_dockObserver) { _dockObserver.disconnect(); _dockObserver = null; }
    if (panel._sectionObserver) { panel._sectionObserver.disconnect(); panel._sectionObserver = null; }
    panel._gcxHiddenBySection = false;
    panel.style.display = '';
    panel.classList.remove('sp-docked');
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    // Restore saved floating geometry.
    const ui = loadUi();
    panel.style.width  = (ui.w || 330) + 'px';
    if (ui.h) panel.style.height = ui.h + 'px';
    if (ui.x != null) { panel.style.left = ui.x + 'px'; panel.style.right = 'auto'; }
    else { panel.style.left = 'auto'; panel.style.right = '16px'; }
    panel.style.top = (ui.y != null ? ui.y : 72) + 'px';
    logStep_('Dock: restored floating panel');
  }

  // ── Settings drawer (data fetch preferences) ─────────────────────────────
  function initSettings_(panel) {
    const btn    = panel.querySelector('#sp-settings-btn');
    const drawer = panel.querySelector('#sp-settings-drawer');
    if (!btn || !drawer) return;

    const uiState = loadUi();
    const prefs = getDataFetchPrefs();

    drawer.innerHTML = `
      <div class="sp-settings-inner">
        <div style="border-bottom:1px solid rgba(0,0,0,0.06);padding-bottom:8px;margin-bottom:8px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:#1c1c1e;margin-bottom:0;">
            <input type="checkbox" id="sp-dock-chk" ${uiState.dockMode === true ? 'checked' : ''}/>
            Dock in Apps panel
          </label>
        </div>
        <div>
          <div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:500;">Data Fetch</div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:#1c1c1e;margin-bottom:5px;">
            <input type="checkbox" id="sp-fetch-order-chk" ${prefs.fetchOrder ? 'checked' : ''}/>
            Order Info
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:#1c1c1e;margin-bottom:5px;">
            <input type="checkbox" id="sp-fetch-shipping-chk" ${prefs.fetchShipping ? 'checked' : ''}/>
            Shipping Address
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:#1c1c1e;margin-bottom:5px;">
            <input type="checkbox" id="sp-fetch-product-chk" ${prefs.fetchProduct ? 'checked' : ''}/>
            Product Info
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:#1c1c1e;margin-bottom:5px;">
            <input type="checkbox" id="sp-notes-toggle"/>
            Notes
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:#1c1c1e;">
            <input type="checkbox" id="sp-show-log-chk" ${!uiState.logCollapsed ? 'checked' : ''}/>
            Debug log
          </label>
        </div>
      </div>
    `;

    const dockChk = drawer.querySelector('#sp-dock-chk');
    if (dockChk) dockChk.addEventListener('change', () => {
      saveUi({ dockMode: dockChk.checked });
      if (dockChk.checked) mountDocked_(panel);
      else mountFloating_(panel);
    });

    const fetchOrderChk = drawer.querySelector('#sp-fetch-order-chk');
    const fetchShippingChk = drawer.querySelector('#sp-fetch-shipping-chk');
    const fetchProductChk = drawer.querySelector('#sp-fetch-product-chk');

    function onDataFetchToggleChange() {
      const prefs = {
        fetchOrder: fetchOrderChk.checked,
        fetchShipping: fetchShippingChk.checked,
        fetchProduct: fetchProductChk.checked,
      };
      saveDataFetchPrefs(prefs);
      const result = panel.querySelector('#sp-result');
      if (result && lastOrderData) {
        const orderId = panel.querySelector('#sp-order-input')?.value.trim() || '';
        const panelAsin = panel.querySelector('#sp-asin-input')?.value.trim() || '';
        result.innerHTML = renderOrder(lastOrderData, orderId, panelAsin);
        result.querySelectorAll('.sp-block-title').forEach(title => {
          title.addEventListener('click', e => {
            e.stopPropagation();
            title.closest('.sp-block').classList.toggle('collapsed');
          });
        });
        applySectionState(result);
      }
      const productResult = panel.querySelector('#sp-product-result');
      if (productResult) {
        productResult.style.display = prefs.fetchProduct ? 'block' : 'none';
      }
    }

    fetchOrderChk.addEventListener('change', onDataFetchToggleChange);
    fetchShippingChk.addEventListener('change', onDataFetchToggleChange);
    fetchProductChk.addEventListener('change', onDataFetchToggleChange);

    btn.addEventListener('click', e => {
      e.stopPropagation();
      drawer.classList.toggle('sp-settings-open');
    });

    // Apply saved log-collapsed state on open
    const logWrap = panel.querySelector('#sp-load-log');
    if (logWrap && uiState.logCollapsed) logWrap.classList.add('sp-log-collapsed');

    const showLogChk = drawer.querySelector('#sp-show-log-chk');
    if (showLogChk && logWrap) {
      showLogChk.addEventListener('change', () => {
        logWrap.classList.toggle('sp-log-collapsed', !showLogChk.checked);
        saveUi({ logCollapsed: !showLogChk.checked });
      });
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function isTicketPage_() { return !!location.pathname.match(/\/tickets\/\d+/); }
  function isFiltersPage_() { return !!location.pathname.match(/\/agent\/filters/); }

  function init() {
    if (_panelEl) return; // heartbeat may call init() before setTimeout(init,800) fires — block double-init
    if (!isTicketPage_() && !isFiltersPage_()) return;
    if (document.getElementById(PANEL_ID)) return;

    let toggleBtn = document.getElementById('sp-toggle-btn');
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.id          = 'sp-toggle-btn';
      toggleBtn.textContent = 'Order Lookup';
      document.body.appendChild(toggleBtn);
    }

    const panel = buildPanel();
    _panelEl = panel;
    const _savedUi = loadUi();
    const _startDocked = _savedUi.dockMode === true;

    if (_startDocked) {
      // Dock mode: never show the floating popup first. Mark docked immediately and
      // mount into the Apps panel below; until then the node stays detached (hidden),
      // so it never flashes as a floating window.
      panel.classList.add('sp-docked');
    } else {
      document.body.appendChild(panel);
      // Restore saved size + position (floating only).
      // Soft-clamp so ≥50px of the header stays grabbable; any other off-screen ok.
      if (_savedUi.w) panel.style.width  = _savedUi.w + 'px';
      if (_savedUi.h) panel.style.height = _savedUi.h + 'px';
      if (_savedUi.x != null) {
        panel.style.left  = _savedUi.x + 'px';
        panel.style.right = 'auto';
      }
      if (_savedUi.y != null) {
        panel.style.top = Math.max(-panel.offsetHeight + 50, _savedUi.y) + 'px';
      }
    }

    // Start minimized on filter/list pages; expanded on ticket pages
    if (!isTicketPage_()) panel.classList.add('minimized');

    const header = panel.querySelector('#sp-panel-header');
    makeDraggable(panel, header);
    // Body is NOT draggable so its text stays selectable/copyable; drag via the title bar.
    makeResizable_(panel);

    initSettings_(panel);

    // Dock from the start (no floating flash). mountDocked_ retries internally
    // (and the heartbeat re-mounts) until the Apps panel is available.
    if (_startDocked) mountDocked_(panel);

    // Minimize / expand
    panel.querySelector('#sp-minimize-btn').onclick = e => {
      e.stopPropagation();
      const minimized = panel.classList.toggle('minimized');
      if (minimized) {
        panel.dataset.savedH = panel.style.height || '';
        panel.style.height = '';
      } else if (panel.dataset.savedH) {
        panel.style.height = panel.dataset.savedH;
      }
    };

    // Docked collapse/expand button (Garden-style chevron)
    const dockCollapseBtn = panel.querySelector('#sp-dock-collapse-btn');
    if (dockCollapseBtn) {
      dockCollapseBtn.onclick = e => {
        e.stopPropagation();
        const collapsed = panel.classList.toggle('minimized');
        dockCollapseBtn.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
      };
    }

    header.addEventListener('click', e => {
      if (header._dragMoved) { header._dragMoved = false; return; }
      if (e.target.closest('#sp-settings-btn, #sp-minimize-btn, #sp-panel-close, #sp-dock-collapse-btn, button')) return;
      if (panel.classList.contains('sp-docked')) {
        const collapsed = panel.classList.toggle('minimized');
        if (dockCollapseBtn) dockCollapseBtn.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
      } else if (panel.classList.contains('minimized')) {
        panel.classList.remove('minimized');
        if (panel.dataset.savedH) panel.style.height = panel.dataset.savedH;
      }
    });

    // Reactive compact layout via ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(([e]) => {
        panel.classList.toggle('sp-compact', e.contentRect.width < 260);
      }).observe(panel);
    }

    // Initialize product result visibility based on preferences
    const prefs = getDataFetchPrefs();
    const productResult = panel.querySelector('#sp-product-result');
    if (productResult) {
      productResult.style.display = prefs.fetchProduct ? 'block' : 'none';
    }

    panel.querySelector('#sp-panel-close').onclick = () => {
      panel.remove();
      toggleBtn.style.display = 'block';
    };
    toggleBtn.onclick = () => {
      toggleBtn.style.display = 'none';
      init();
    };

    const orderInput = panel.querySelector('#sp-order-input');
    const asinInput  = panel.querySelector('#sp-asin-input');

    panel.querySelector('#sp-lookup-btn').onclick = () => {
      const id = orderInput.value.trim();
      if (id) fetchOrder(id);
    };
    orderInput.addEventListener('keydown', e => { if (e.key === 'Enter') panel.querySelector('#sp-lookup-btn').click(); });

    panel.querySelector('#sp-product-btn').onclick = () => {
      const raw = asinInput.value.trim().toUpperCase();
      if (!raw) return;
      const asins = raw.split(',').map(a => a.trim()).filter(Boolean);
      renderAllProducts(asins);
    };
    asinInput.addEventListener('keydown', e => { if (e.key === 'Enter') panel.querySelector('#sp-product-btn').click(); });

    panel.querySelector('#sp-autofill-btn').onclick = () => autoFillTicket(panel);
    panel.querySelector('#sp-mcf-btn').onclick = () => sendToMCF(panel);
    panel.querySelector('#sp-nrn-btn').onclick = () => markNoResponseNeeded(panel);

    // Mirror ChannelReply's button state: enable our NRN button only while CR's
    // Per-row copy buttons (delegated, guarded once). Copies the row's value text.
    if (!window.__gcxCopyInit) {
      window.__gcxCopyInit = true;
      const copyText_ = text => {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { document.execCommand('copy'); } finally { ta.remove(); }
        return Promise.resolve();
      };
      document.addEventListener('click', e => {
        const btn = e.target.closest && e.target.closest('.sp-copy');
        if (!btn) return;
        e.preventDefault(); e.stopPropagation();
        // data-copy attribute wins (used by item-name buttons that aren't in .sp-row)
        let text = btn.dataset.copy ? btn.dataset.copy.trim() : '';
        if (!text) {
          const rowEl = btn.closest('.sp-row');
          const valEl = rowEl && (rowEl.querySelector('.sp-val') || rowEl.querySelector('a'));
          text = (valEl ? valEl.textContent : '').trim();
        }
        if (!text || text === '—') return;
        copyText_(text).then(() => {
          btn.classList.add('copied');
          btn.innerHTML = '✓';
          setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = COPY_SVG; }, 1000);
        }).catch(() => {});
      }, true);
    }

    // NRN button state sync — guarded once per page load.
    // CR lives in a zdusercontent.com iframe, so the primary path is the iframe
    // bridge (postMessage). MutationObserver handles the rare direct-DOM case.
    if (!window.__gcxNrnInit) {
      window.__gcxNrnInit = true;

      const setNrnBtn_ = (disabled, title) => {
        const btn = document.querySelector('#sp-order-panel #sp-nrn-btn');
        if (!btn) return;
        btn.disabled = disabled;
        btn.title    = title;
      };

      // Direct-DOM sync (no-op when CR is in iframe)
      const syncFromDom_ = () => {
        const el = findNrnBtnDirect_();
        if (!el) return false;
        const ok = isNrnActionable_(el);
        setNrnBtn_(!ok, ok ? 'Mark as No Response Needed' : 'Already marked as No Response Needed');
        return true;
      };
      syncFromDom_();
      new MutationObserver(syncFromDom_).observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class'],
      });

      // Iframe bridge: receive state from CR and update button
      let _lastBridgeAt = 0;
      let _lastUrl = location.href;
      const queryIframes_ = () =>
        [...document.querySelectorAll('iframe')].forEach(f => {
          try { f.contentWindow.postMessage({ __gcxNRN: 'query' }, '*'); } catch (_) {}
        });

      window.addEventListener('message', ev => {
        const d = ev.data;
        if (!d || !d.__gcxNRN) return;
        if (d.__gcxNRN === 'hello') {
          // Cache the source frame so we can click it directly even if it's nested.
          if (ev.source && d.hasBtn) window.__gcxNrnSource = ev.source;
          queryIframes_();
          return;
        }
        if (d.__gcxNRN !== 'state') return;
        // Track bridge health BEFORE syncFromDom_() so the 8s silence timeout
        // never fires while the CR iframe is actively sending state — even if a
        // direct DOM element happens to be found (which would have caused an early
        // return and left _lastBridgeAt stale, triggering a spurious disable).
        _lastBridgeAt = Date.now();
        if (d.found && ev.source) window.__gcxNrnSource = ev.source;
        if (syncFromDom_()) return; // direct DOM wins for button state
        if (d.found) {
          setNrnBtn_(!d.actionable,
            d.actionable ? 'Mark as No Response Needed' : 'Already marked as No Response Needed');
        } else {
          setNrnBtn_(true, 'Only available on Amazon Buyer Message tickets');
        }
      });

      // Poll every 2s: direct DOM → query iframes → reset if bridge silent
      setInterval(() => {
        // Reset button on SPA navigation
        if (location.href !== _lastUrl) {
          _lastUrl = location.href;
          _lastBridgeAt = 0;
          window.__gcxNrnSource = null;
          setNrnBtn_(true, 'Only available on Amazon Buyer Message tickets');
        }
        if (syncFromDom_()) return;
        queryIframes_();
        // Bridge silent for >8s on a ticket page → not an ABM ticket
        if (_lastBridgeAt > 0 && Date.now() - _lastBridgeAt > 8000) {
          setNrnBtn_(true, 'Only available on Amazon Buyer Message tickets');
          _lastBridgeAt = 0;
        }
      }, 2000);
    }

    const notesToggle  = panel.querySelector('#sp-notes-toggle');
    const notesSection = panel.querySelector('#sp-notes-section');
    const notesContent = panel.querySelector('#sp-notes-content');

    function refreshNotes() {
      const ta = document.querySelector('[data-test-id="notes-edit-text-area-test-id"]');
      notesContent.textContent = ta?.value?.trim() || '(no notes)';
    }
    notesToggle.addEventListener('change', () => {
      notesSection.style.display = notesToggle.checked ? 'block' : 'none';
      if (notesToggle.checked) refreshNotes();
      saveUi({ notes: notesToggle.checked });
    });
    if (loadUi().notes) {
      notesToggle.checked = true;
      notesSection.style.display = 'block';
      refreshNotes();
    }
    document.addEventListener('input', e => {
      if (notesToggle.checked && e.target.matches('[data-test-id="notes-edit-text-area-test-id"]'))
        notesContent.textContent = e.target.value.trim() || '(no notes)';
    });

    // ── Persist section collapse state (capture phase runs before stopPropagation) ──
    panel.addEventListener('click', e => {
      const title = e.target.closest('.sp-block-title');
      if (!title) return;
      const block = title.closest('[data-sp-section]');
      if (!block) return;
      setTimeout(() => {
        const c = loadUi().collapsed || {};
        c[block.dataset.spSection] = block.classList.contains('collapsed');
        saveUi({ collapsed: c });
      }, 0);
    }, true);

    // ── Reset panel on ticket navigation ────────────────────────────────────
    function resetPanel() {
      orderInput.value = '';
      asinInput.value  = '';
      lastOrderData    = null;
      lastProductData  = null;
      lastAmazonProduct = null;
      _productReady    = false;
      // Only wipe GCX Reply-filled ZD fields when Auto-Fill was actually confirmed on this
      // ticket. Clearing unconditionally caused Zendesk's own saved field values to be lost
      // whenever the agent navigated away and back (regression from v2.7.3).
      if (_gcrFilledThisTicket) clearAllZdFields_();
      _gcrFilledThisTicket = false;
      const result = document.getElementById('sp-result');
      if (result) result.innerHTML = '<div id="sp-status">Scanning ticket for order IDs…</div>';
      const productResult = document.getElementById('sp-product-result');
      if (productResult) productResult.innerHTML = '';
      showAiReasonBtn_('');
      lastAiReason = null;
      const chips = document.getElementById('sp-detected-ids');
      if (chips) chips.innerHTML = '';
      const autoBar = panel.querySelector('#sp-autofill-bar');
      if (autoBar) autoBar.style.display = 'none';
      const mcfBar = panel.querySelector('#sp-mcf-bar');
      if (mcfBar) mcfBar.style.display = 'none';
      const notesToggleEl = panel.querySelector('#sp-notes-toggle');
      if (notesToggleEl) notesToggleEl.checked = false;
      const notesSectionEl = panel.querySelector('#sp-notes-section');
      if (notesSectionEl) notesSectionEl.style.display = 'none';
      const logEntries = document.getElementById('sp-log-entries');
      if (logEntries) logEntries.innerHTML = '';
      setFillStatus(panel, '');
      _panelSession++;
    }

    function autoDetectAll() {
      const _session = _panelSession;
      getTicketFields((orderId, asin, bodyIds) => {
        if (_panelSession !== _session) return; // stale callback from prev ticket — discard
        const orderInput = panel.querySelector('#sp-order-input');
        if (orderId && orderInput && !orderInput.value) {
          // Custom field has order ID → use it directly, chips are informational only
          orderInput.value = orderId;
          fetchOrder(orderId);
          updateDetectedChips(panel, true);
        } else {
          // No custom field order ID → merge message-body IDs with DOM scan
          // If exactly 1 total → auto-fetch; if multiple → show chips for user to pick
          updateDetectedChips(panel, false, bodyIds);
        }

        const detectedAsin = asin || [...new Set([...document.body.innerText.matchAll(ASIN_RE)].map(m => m[1]))][0];
        if (detectedAsin) {
          const ai = document.getElementById('sp-asin-input');
          if (ai && !ai.value) {
            ai.value = detectedAsin;
            const _asinOnly = !orderId && (!bodyIds || !bodyIds.length);
            const _prefs = getDataFetchPrefs();
            if (_prefs.fetchProduct) {
              renderAllProducts([detectedAsin], false, _asinOnly);
            }
          }
        }
      });
    }

    let lastTicketId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
    let navTimer = null;
    let _mountNavTimer = null;
    function onNav() {
      const newId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
      if (newId) {
        // Navigated to a ticket — always expand
        if (panel.classList.contains('minimized')) {
          panel.classList.remove('minimized');
          if (panel.dataset.savedH) panel.style.height = panel.dataset.savedH;
        }
        if (newId !== lastTicketId) {
          lastTicketId = newId;
          resetPanel();
          _dockFailedAt = null; // restart the 2s floating-fallback timer for the new ticket
          clearTimeout(navTimer);
          navTimer = setTimeout(autoDetectAll, 1500);
          // Re-run mountDocked_() after each ticket navigation so that the section
          // observer re-attaches to the fresh DOM elements Zendesk creates on SPA
          // render. Without this, the stale observer never fires when the user
          // clicks the Apps icon after a ticket switch, leaving the panel hidden.
          if (loadUi().dockMode) {
            // Reset auto-click flag so the observer can click the Apps icon
            // once on this new ticket if the Apps section isn't the default.
            panel._autoClickedAppsBtn = false;
            clearTimeout(_mountNavTimer);
            _mountNavTimer = setTimeout(() => mountDocked_(panel), 500);
          }
        }
      } else {
        // Left ticket pages (filters, views, etc.) — always collapse
        lastTicketId = null;
        if (location.pathname.startsWith('/agent/filters')) resetPanel();
        if (!panel.classList.contains('minimized')) {
          panel.dataset.savedH = panel.style.height || '';
          panel.style.height = '';
          panel.classList.add('minimized');
        }
      }
    }
    const origPush    = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState    = (...a) => { origPush(...a);    onNav(); };
    history.replaceState = (...a) => { origReplace(...a); onNav(); };
    window.addEventListener('popstate', onNav);

    let scanTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => updateDetectedChips(panel, !!panel.querySelector('#sp-order-input')?.value), 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    if (isTicketPage_()) setTimeout(autoDetectAll, 1500);
  }

  // 국가 코드 → MCF 랜딩 URL
  // JP: 셀러 센트럴 재팬 직접 이동
  // GB: UK 마켓플레이스 전환용 netlify (chipper)
  // 그 외 EU / 기타: 비UK EU 전환용 netlify (dulcet)
  // netlify 페이지가 #spigen_mcf= 해시를 읽어 적절한 SC 마켓플레이스로 리다이렉트
  function getMcfBase_(country) {
    if (country === 'JP') return 'https://sellercentral-japan.amazon.com/mcf/orders/create-order';
    if (country === 'GB') return 'https://chipper-youtiao-04b62d.netlify.app';
    return 'https://dulcet-cendol-0ec85d.netlify.app';
  }

  // MCF 링크 패치 — event delegation instead of per-link onclick.
  // Per-link onclick requires the link to already be in the DOM when patchMcfLinks_
  // runs. Zendesk iframes are detected by a 1-second interval, so clicks in the first
  // second fall through to the raw Netlify redirect (no hash). Event delegation on
  // the document/iframe catches ALL clicks regardless of when the link was added,
  // including future links injected by Zendesk's SPA renderer.
  function patchMcfLinks_(rootEl) {
    const root = rootEl instanceof Document ? rootEl : (rootEl ? rootEl.ownerDocument || document : document);
    if (root._mcfDelegated) return;
    root._mcfDelegated = true;

    root.addEventListener('click', async (e) => {
      const link = e.target.closest('a');
      if (!link) return;
      const href = link.href || '';
      const isNetlify = href.includes('.netlify.app');
      const isMcfDirect = href.includes('mcf/orders/create-order') && !href.includes('spigen_mcf=');
      if (!isNetlify && !isMcfDirect) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        const ctxEmail = await getCustomerContextEmail_();
        const payload = buildMcfPayload_(document.getElementById(PANEL_ID), ctxEmail);
        const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
        const base = isMcfDirect
          ? href.split('#')[0].replace(/\?[^]*$/, '')
          : getMcfBase_(payload.country);
        const _w = window.open(base + '#spigen_mcf=' + encoded, '_blank');
        if (_w) { try { _w.name = 'spigen_mcf:' + encoded; } catch(e) {} }
      } catch (err) {
        // Encoding failed — open the original link so the click isn't silently swallowed.
        window.open(href, '_blank');
      }
    }, true); // capture phase: fires before React/Zendesk handlers
  }

  // 메인 문서 감시 (delegation attaches once; MutationObserver no longer needed for links)
  patchMcfLinks_(document);

  // iframe 내부도 감시 (Zendesk 에디터 등)
  // patchMcfLinks_ now uses event delegation so we just need to attach the listener
  // to the iframe document once — no MutationObserver per-link needed anymore.
  if (typeof setInterval === 'function') setInterval(() => {
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        patchMcfLinks_(doc);
      } catch(e) {}
    });
  }, 1000);

  // Heartbeat: if both the panel AND the toggle button disappear from the DOM
  // (Zendesk SPA re-render, slow initial load, etc.) re-run init automatically.
  // typeof guards make this file safe to copy verbatim into GAS (where setInterval/setTimeout are undefined).
  if (typeof setInterval === 'function') setInterval(() => {
    // Dock mode: Zendesk's React re-render detaches our injected node on ticket
    // navigation. Keep the SAME panel element and re-insert whenever needed.
    // Also retry from floating-fallback (panel on body while dockMode=true) in
    // case the Apps panel flyout was closed when we first tried to mount.
    if (loadUi().dockMode === true && _panelEl) {
      const inFloatingFallback = _panelEl.isConnected &&
        _panelEl.parentElement === document.body &&
        !_panelEl.classList.contains('sp-docked');
      // Don't remount when GCX Reply is intentionally hidden because the user
      // has switched to a different omnipanel section (Customer Context, etc.).
      const hiddenBySection = _panelEl._gcxHiddenBySection === true;
      // Detect wrong-ticket mount: panel is connected but lives inside a
      // different ticket's DOM (Zendesk keeps all open tabs in DOM simultaneously).
      const _hbScope = ticketScope_();
      const inWrongTicket = _panelEl.isConnected && !!_hbScope && !_hbScope.contains(_panelEl);
      // Always re-mount when disconnected (detached from DOM), regardless of
      // hiddenBySection — the panel must be in the mount to be shown when the
      // user switches back to the Apps section.
      if (!_panelEl.isConnected || (!hiddenBySection && _panelEl.offsetHeight === 0) || inFloatingFallback || inWrongTicket) {
        if (inWrongTicket) {
          _panelEl.remove();
          logStep_('Dock: wrong ticket DOM, detaching and remounting...');
        }
        mountDocked_(_panelEl);
      }
      return;
    }
    if (!document.getElementById(PANEL_ID) && !document.getElementById('sp-toggle-btn')) {
      init();
    }
  }, 600);

  if (typeof setTimeout === 'function') setTimeout(init, 800);
})();


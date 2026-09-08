function kSheetToChat() {
  const spreadsheetId = '10VYnysCGztKWMXfvXIWBVcE2_zENnRxvXUr9nicHkpo';
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('K_시트');

  // Title (B3) and total (G3)
  const titleText = String(sheet.getRange('B3').getValue() || '');
  const manualTotal = sheet.getRange('G3').getValue();

  // Headers + data from B4:I  (B no, C country, D brand, E category, F qty, G owner, H device, I 인입사유)
  const all = sheet.getRange('B:I').getValues();
  let last = all.length;
  while (last > 5 && all[last - 1].every(v => v === '' || v === null)) last--;
  const rows = all.slice(4, last); // B5..I(last)
  if (!rows.length) return;

  const MAX_ROWS = 25;
  const clip = rows.slice(0, MAX_ROWS);

  let totalQty = 0;
  let lysTotal = 0;
  let kjwTotal = 0;

  // Build the table rows
  const headerCells = ['#', 'CC', 'Brand', 'Category', 'Device', '인입사유', 'Qty', 'PIC'];
  const dataRows = [];

  for (const r of clip) {
    const no = safeStr(r[0]).replace(/\.$/, '');
    const country = safeStr(r[1]);
    // Strip "spigen_" / "Spigen" / "(" / ")" and dangling underscores, then upper-case: "Spigen(New Biz)" -> "NEW BIZ"
    const brand = safeStr(r[2])
      .replace(/spigen_/g, '')
      .replace(/Spigen/g, '')
      .replace(/[()]/g, '')
      .replace(/^_+|_+$/g, '')
      .trim()
      .toUpperCase();
    // Drop the leading "N. " numbering: "6. Product Inquiry" -> "Product Inquiry"
    const category = safeStr(r[3]).replace(/^\d+\.\s*/, '');
    const qty = toInt(r[4]);
    const owner = safeStr(r[5]);
    const device = safeStr(r[6]);
    // 1차 Defect Reason or Inquiries -> shown as 인입사유; drop the leading "(XXX)_" prefix
    const reason = safeStr(r[7]).replace(/^\([^)]*\)_/, '');

    totalQty += qty;
    const ownerUpper = owner.toUpperCase();
    if (ownerUpper === 'LYS') lysTotal += qty;
    if (ownerUpper === 'KJW') kjwTotal += qty;

    const iso = normalizeIso(country) || country;
    dataRows.push([no, iso, brand || '-', category || '-', device || '-', reason || '-', String(qty), owner]);
  }

  // Monospace, column-aligned table (CJK chars count as width 2)
  const tableText = buildMonoTable_(headerCells, dataRows);

  // If G3 is present, prefer it; otherwise use computed sum
  const headlineTotal = (manualTotal !== '' && manualTotal !== null) ? Number(manualTotal) : totalQty;

  // Totals line (All, LYS, KJW)
  const totalsLine = `All: ${headlineTotal} | LYS: ${lysTotal} | KJW: ${kjwTotal}`;

  const payload = {
    text: titleText || 'K_시트 Pending Ticket Snapshot',
    cardsV2: [
      {
        cardId: 'k_sheet_compact',
        card: {
          header: {
            title: titleText || 'K_시트 Pending Ticket 수',
            subtitle: '담당자별 Pending 티켓 현황',
            imageUrl: 'https://img.icons8.com/color/512/zendesk.png',
            imageType: 'SQUARE',
            imageAltText: 'Zendesk'
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'Ticket Totals',
                    text: totalsLine
                  }
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'Start Zendesk',
                        onClick: {
                          openLink: {
                            url: 'https://spigenhelp.zendesk.com/agent/filters/360103290632'
                          }
                        }
                      }
                    ]
                  }
                },
                { divider: {} }
              ]
            },
            {
              widgets: [
                { textParagraph: { text: '<pre>' + htmlEscape_(tableText) + '</pre>' } }
              ]
            },
            ...(rows.length > MAX_ROWS
              ? [{
                  widgets: [{
                    decoratedText: {
                      topLabel: 'Note',
                      text: `Showing first ${MAX_ROWS} rows — open sheet for all.`
                    }
                  }]
                }]
              : [])
          ]
        }
      }
    ]
  };

  const res = UrlFetchApp.fetch(webhookUrl, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}

/* ===== helpers ===== */
function safeStr(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function toInt(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function normalizeIso(code) {
  const raw = safeStr(code).toUpperCase();
  if (!raw) return '';
  return raw === 'UK' ? 'GB' : raw;
}
function toFlagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '';
  const A = 0x41; const REGIONAL = 0x1F1E6;
  const c1 = iso2.charCodeAt(0), c2 = iso2.charCodeAt(1);
  if (c1 < A || c1 > 0x5A || c2 < A || c2 > 0x5A) return '';
  return String.fromCodePoint(REGIONAL + (c1 - A), REGIONAL + (c2 - A));
}

function htmlEscape_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Display width: CJK / full-width / Hangul chars occupy 2 monospace cells, the rest 1.
function monoWidth_(s) {
  const wide = /[\u1100-\u11FF\u3000-\u30FF\u3130-\u318F\u3400-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFF00-\uFFEF]/;
  let w = 0;
  for (const ch of String(s)) w += wide.test(ch) ? 2 : 1;
  return w;
}

// Build a fixed-width, column-aligned text table. `#` and `Qty` columns are right-aligned.
function buildMonoTable_(headerCells, dataRows) {
  const grid = [headerCells].concat(dataRows);
  const cols = headerCells.length;
  const colW = [];
  for (let c = 0; c < cols; c++) {
    colW[c] = grid.reduce((m, row) => Math.max(m, monoWidth_(row[c])), 0);
  }
  const rightAlign = {}; rightAlign[0] = true; rightAlign[cols - 2] = true; // '#' and 'Qty'
  const pad = (val, w, right) => {
    const s = String(val);
    const gap = ' '.repeat(Math.max(0, w - monoWidth_(s)));
    return right ? gap + s : s + gap;
  };
  const fmtRow = row => row.map((v, c) => pad(v, colW[c], rightAlign[c])).join('  ');
  const rule = colW.map(w => '-'.repeat(w)).join('  ');
  return [fmtRow(headerCells), rule].concat(dataRows.map(fmtRow)).join('\n');
}

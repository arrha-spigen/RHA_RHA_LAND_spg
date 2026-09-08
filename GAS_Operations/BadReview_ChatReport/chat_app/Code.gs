/**
 * BadReview — Google Chat app (proof of concept).
 *
 * Runs ALONGSIDE the webhook broadcast (../badreview_chat_report.py); it does not
 * replace it. Difference: this one is interactive — the user picks a date (and a
 * product) from widgets in the card, and the app re-renders the Pixel 11 / Galaxy
 * Z8 배드리뷰 (1~3점) report for the rows whose `Update 날짜` matches that date.
 *
 * Card layout is the same as the webhook card:
 *   header  ✔️ M/D(요일) <product> 배드리뷰 (1~3점) (총 N건)  + product thumbnail
 *   "Top 5 인입사유(누적)"  2 cols by 대분류 (red 보호필름 / blue 케이스),
 *                          5 decoratedText rows each (n위 / 이유 / c건 · p%)
 *   "M/D(요일) 최다 인입사유"  top 인입사유(tag) on that date + fixed 5-line list
 *   [배드리뷰] button → the 1-3점 sheet
 * plus a control card on top: a DATE_ONLY picker + a product DROPDOWN + [조회].
 *
 * N (총 N건) = rows on the '1-3점' tab whose `Update 날짜` == the picked date.
 * The two Top-5 columns count the whole sheet (cumulative), same as the webhook.
 */

var PRODUCTS = {
  pixel11: {
    name: 'Pixel 11 Series',
    sheetId: '12I6z_FFmDIMHa0rLanltKKFp7kI_yREQj3adkMamPgI',
    subtitle: '고객 리뷰 ★1~3점 · 26/8/18~26/11/18',
    cardId: 'pixel11-badreview',
    img: 'https://encrypted-tbn2.gstatic.com/shopping?q=tbn:ANd9GcQhY2aafxhQi-vGv0oxV5j0' +
         'kiiOF2sGF0hwiXeEePaAI3DbRziTZcO4Z2sehnyCpp1_qSxCn_iAE4IZ0SlW9WftxRQLxykwNXmmsDn' +
         'm3CQkubwlCmO7PL4F3JbUKGWpl1F6c2RuVw&usqp=CAc'
  },
  glxz8: {
    name: 'Galaxy Z8 Series',
    sheetId: '19OhswglYMx_dxSFFDtWI1WYPWq2jONJn6RK84KITwy4',
    subtitle: '고객 리뷰 ★1~3점 · 26/7/27~26/10/27',
    cardId: 'glxz8-badreview',
    img: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:ANd9GcRA_H2PEgYRDyPvE2kQ4RQ' +
         'lhN4sOnJd5cIS90muwFk2pqDlNNPQGlXJ8DHo7ihE20nzMs6-C5AUao7n5SgfGH4vTuzzrg6Oh_4QGU' +
         'SKReAVwWyaJK1DN9MI_TrAT8dE3Gq1-Rzobw&usqp=CAc'
  }
};

var GID_13 = 970309432;                                   // '1-3점' tab
var CAT_COLOR = { '휴대폰보호필름': '#EA4335', '휴대폰케이스': '#4285F4' };
// 인입사유(tag) values dropped before any counting (user rule 2026-09-08:
// exclude 긍정 리뷰 from every stat and every card, permanently). Mirror of
// EXCLUDED_TAGS in ../badreview_chat_report.py — keep in sync.
var EXCLUDED_TAGS = ['긍정 리뷰'];
var WD = ['일', '월', '화', '수', '목', '금', '토'];      // JS getDay(): 0 = Sun
var TZ = 'Asia/Seoul';

/* ===================== Chat event handlers ===================== */

function onMessage(event) {
  var d = parseDateFromText_((event.message && event.message.text) || '') || todayKst_();
  return { cardsV2: buildCards_(d, 'both') };
}

function onAddToSpace(event) {
  return {
    text: 'BadReview 리포트 앱입니다. 날짜를 골라 배드리뷰(1~3점) 리포트를 조회하세요.',
    cardsV2: buildCards_(todayKst_(), 'both')
  };
}

function onRemoveFromSpace(event) {}

/** The [조회] button (onClick.action.function = "refreshReport") lands here. */
function refreshReport(event) {
  var inputs = (event.common && event.common.formInputs) || event.formInputs || {};
  var ms = extractDateMs_(inputs);
  var product = extractString_(inputs, 'product') || 'both';
  var d;
  if (ms != null) {
    var picked = new Date(Number(ms));                    // DATE_ONLY → UTC-midnight ms
    d = new Date(picked.getUTCFullYear(), picked.getUTCMonth(), picked.getUTCDate());
  } else {
    d = todayKst_();
  }
  return {
    actionResponse: { type: 'UPDATE_MESSAGE' },
    cardsV2: buildCards_(d, product)
  };
}

/* ===================== Card building ===================== */

function buildCards_(d, product) {
  var keys = product === 'both' ? ['pixel11', 'glxz8'] : [product];
  var cards = [controlCard_(d, product)];
  keys.forEach(function (k) { cards.push(reportCard_(k, d)); });
  return cards;
}

function controlCard_(d, product) {
  var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return {
    cardId: 'badreview-control',
    card: {
      header: { title: 'BadReview 리포트 조회', subtitle: '날짜·제품을 고르고 [조회]' },
      sections: [{
        widgets: [
          { dateTimePicker: {
              name: 'reportDate', label: '조회 날짜 (Update 날짜)',
              type: 'DATE_ONLY', valueMsEpoch: String(ms)
          }},
          { selectionInput: {
              name: 'product', label: '제품', type: 'DROPDOWN',
              items: [
                { text: '둘 다', value: 'both', selected: product === 'both' },
                { text: 'Pixel 11 Series', value: 'pixel11', selected: product === 'pixel11' },
                { text: 'Galaxy Z8 Series', value: 'glxz8', selected: product === 'glxz8' }
              ]
          }},
          { buttonList: { buttons: [
              { text: '조회', type: 'FILLED', onClick: { action: { function: 'refreshReport' } } }
          ]}}
        ]
      }]
    }
  };
}

function reportCard_(key, d) {
  var p = PRODUCTS[key];
  var data = crunch_(p.sheetId, d);
  var md = fmtMd_(d);
  var link = 'https://docs.google.com/spreadsheets/d/' + p.sheetId +
             '/edit?gid=' + GID_13 + '#gid=' + GID_13;

  var top5Section = {
    header: 'Top 5 인입사유(누적)',
    widgets: [{ columns: { columnItems: [
      catColumn_('휴대폰보호필름', data.film),
      catColumn_('휴대폰케이스', data.box)
    ]}}]
  };

  var dayWidgets;
  if (data.tags.length) {
    var lines = data.tags.slice(0, 5).map(function (t, i) {
      return (i + 1) + '. ' + t[0] + ' &nbsp;' + t[1] + '건';
    });
    if (data.tags.length > 5) {
      var extra = data.tags.slice(5).reduce(function (s, x) { return s + x[1]; }, 0);
      lines[lines.length - 1] += ' &nbsp;…외 ' + extra + '건';
    }
    dayWidgets = [
      { decoratedText: {
          topLabel: '인입사유(tag) 기준',
          text: '<b>' + data.tags[0][0] + '</b> — ' + data.tags[0][1] + '건',
          startIcon: { knownIcon: 'STAR' }
      }},
      { textParagraph: { text: pad_(lines, 5) } }
    ];
  } else {
    dayWidgets = [
      { decoratedText: {
          topLabel: '인입사유(tag) 기준',
          text: '해당 날짜 업로드된 배드리뷰 없음',
          startIcon: { knownIcon: 'STAR' }
      }},
      { textParagraph: { text: pad_([], 5) } }
    ];
  }
  dayWidgets.push({ buttonList: { buttons: [
    { text: '배드리뷰', onClick: { openLink: { url: link } } }
  ]}});

  return {
    cardId: p.cardId,
    card: {
      header: {
        title: '✔️ ' + md + ' ' + p.name + ' 배드리뷰 (1~3점) (총 ' + data.count + '건)',
        subtitle: p.subtitle,
        imageUrl: p.img,
        imageType: 'SQUARE'
      },
      sections: [ top5Section, { header: md + ' 최다 인입사유', widgets: dayWidgets } ]
    }
  };
}

function catColumn_(label, blk) {
  var color = CAT_COLOR[label] || '#202124';
  var widgets = [{ textParagraph: {
    text: '<b><font color="' + color + '">' + label + '</font></b>  ·  ' + blk.tot + '건'
  }}];
  for (var i = 0; i < 5; i++) {
    if (i < blk.top5.length) {
      var n = blk.top5[i][0], c = blk.top5[i][1];
      var pct = blk.tot ? Math.round(c * 100 / blk.tot) + '%' : '-';
      widgets.push({ decoratedText: {
        topLabel: (i + 1) + '위', text: '<b>' + n + '</b>', bottomLabel: c + '건 · ' + pct
      }});
    } else {
      widgets.push({ decoratedText: { topLabel: ' ', text: ' ', bottomLabel: ' ' } });
    }
  }
  return {
    horizontalSizeStyle: 'FILL_AVAILABLE_SPACE',
    horizontalAlignment: 'START',
    verticalAlignment: 'TOP',
    widgets: widgets
  };
}

/* ===================== Sheet crunching ===================== */

function crunch_(sheetId, target) {
  var vals = SpreadsheetApp.openById(sheetId).getSheetByName('1-3점').getDataRange().getValues();
  var H = vals[0];
  var iU = H.indexOf('Update 날짜'); if (iU < 0) iU = H.indexOf('Exported Date');
  var iT = H.indexOf('인입사유(tag)');
  var iC = H.indexOf('대분류');

  var count = 0, tally = {};
  var cat = { '휴대폰보호필름': {}, '휴대폰케이스': {} };
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var tag = String(row[iT] || '').trim() || '(빈칸)';
    if (EXCLUDED_TAGS.indexOf(tag) !== -1) continue;
    var cc = String(row[iC] || '').trim();
    if (cat[cc]) cat[cc][tag] = (cat[cc][tag] || 0) + 1;
    if (matchesDate_(row[iU], target)) { count++; tally[tag] = (tally[tag] || 0) + 1; }
  }
  return {
    count: count,
    tags: sortDesc_(tally),
    film: block_(cat['휴대폰보호필름']),
    box: block_(cat['휴대폰케이스'])
  };
}

function matchesDate_(cell, target) {
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return cell.getFullYear() === target.getFullYear() &&
           cell.getMonth() === target.getMonth() &&
           cell.getDate() === target.getDate();
  }
  var m = String(cell || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return !!m && Number(m[1]) === target.getFullYear() &&
         Number(m[2]) === target.getMonth() + 1 &&
         Number(m[3]) === target.getDate();
}

function block_(obj) {
  var rows = sortDesc_(obj);
  return { tot: rows.reduce(function (s, x) { return s + x[1]; }, 0), top5: rows.slice(0, 5) };
}

function sortDesc_(obj) {
  return Object.keys(obj)
    .map(function (k) { return [k, obj[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; });
}

/* ===================== Small helpers ===================== */

function todayKst_() {
  var s = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-');
  return new Date(Number(s[0]), Number(s[1]) - 1, Number(s[2]));
}

function fmtMd_(d) {
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')';
}

function pad_(lines, n) {
  var out = lines.slice(0, n);
  while (out.length < n) out.push('&nbsp;');
  return out.join('<br>');
}

/** "9/5" or "2026-09-05" in the message text → a Date (this year if year omitted). */
function parseDateFromText_(text) {
  var m = String(text).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = String(text).match(/\b(\d{1,2})\s*[\/.]\s*(\d{1,2})\b/);
  if (m) return new Date(todayKst_().getFullYear(), Number(m[1]) - 1, Number(m[2]));
  return null;
}

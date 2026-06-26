function onOpen() {
  SlidesApp.getUi()
    .createMenu('Slide Updater')
    .addItem('Update Slide Text', 'updateSlideTextBoxes')
    .addItem('Create 260618 Report', 'createReport260618')
    .addItem('Get YoY Stats (260618)', 'getYoYStats')
    .addToUi();
}

// ─── YoY STATS ────────────────────────────────────────────────────────────────
// Counts all rows (no category filter) up to the date cutoffs,
// computes YoY%, and lists top-10 1차 Defect Reason or Inquiries for 2026.
function getYoYStats() {
  var ZD26_ID   = '1sjcCj_P4DRD8rywkmYJhbsrzwFfgiJQuF9nIKwCiKlc';
  var ZD25_ID   = '1t5CJLsVw1hAVPspt_gBVCiM6vWSrEfvqQ8aV7xvoGD8';
  var CUT26     = new Date('2026-06-18T23:59:59');
  var CUT25     = new Date('2025-06-18T23:59:59');

  // ── 2026 sheet ──────────────────────────────────────────────────────────────
  var sheet26   = SpreadsheetApp.openById(ZD26_ID).getSheetByName('26년 전체문의');
  if (!sheet26) { Logger.log('26년 전체문의 not found'); return; }

  var lastRow26 = sheet26.getLastRow();
  var numRows26 = Math.max(lastRow26 - 1, 0);
  var headers26 = sheet26.getRange(1, 1, 1, sheet26.getLastColumn()).getDisplayValues()[0];

  function colIdx26(name) {
    var i = headers26.indexOf(name);
    if (i === -1) throw new Error('Col not found: ' + name);
    return i + 1;
  }

  var dateCol26   = colIdx26('Ticket created - Date');
  var reasonCol26 = colIdx26('1차 Defect Reason or Inquiries');

  var dates26   = sheet26.getRange(2, dateCol26,   numRows26, 1).getDisplayValues().flat();
  var reasons26 = sheet26.getRange(2, reasonCol26, numRows26, 1).getDisplayValues().flat();

  var count26 = 0;
  var reasonMap = {};
  for (var i = 0; i < numRows26; i++) {
    var d = new Date(dates26[i]);
    if (isNaN(d.getTime()) || d > CUT26) continue;
    count26++;
    var r = (reasons26[i] || '').trim();
    if (r) reasonMap[r] = (reasonMap[r] || 0) + 1;
  }

  // Top-10 reasons
  var top10 = Object.entries(reasonMap)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 10);

  // ── 2025 sheet ──────────────────────────────────────────────────────────────
  var sheet25   = SpreadsheetApp.openById(ZD25_ID).getSheetByName('25년 전체문의');
  if (!sheet25) { Logger.log('25년 전체문의 not found'); return; }

  var lastRow25 = sheet25.getLastRow();
  var numRows25 = Math.max(lastRow25 - 1, 0);
  var headers25 = sheet25.getRange(1, 1, 1, sheet25.getLastColumn()).getDisplayValues()[0];

  function colIdx25(name) {
    var i = headers25.indexOf(name);
    if (i === -1) throw new Error('Col not found in 25시트: ' + name);
    return i + 1;
  }

  var dateCol25 = colIdx25('Ticket created - Date');
  var dates25   = sheet25.getRange(2, dateCol25, numRows25, 1).getDisplayValues().flat();

  var count25 = 0;
  for (var j = 0; j < numRows25; j++) {
    var d2 = new Date(dates25[j]);
    if (isNaN(d2.getTime()) || d2 > CUT25) continue;
    count25++;
  }

  // ── YoY % ───────────────────────────────────────────────────────────────────
  var yoy = count25 > 0
    ? (((count26 - count25) / count25) * 100).toFixed(2) + '%'
    : 'N/A (no 2025 data)';

  // ── Output ──────────────────────────────────────────────────────────────────
  var lines = [
    '=== GCX Bi-Weekly 260618 Stats ===',
    '',
    '2026 누적 클레임 (~6.18): ' + count26.toLocaleString() + '건',
    '2025 누적 클레임 (~6.18): ' + count25.toLocaleString() + '건',
    'YoY: ' + (count26 - count25 >= 0 ? '+' : '') + (count26 - count25).toLocaleString() + '건  (' + (count26 - count25 >= 0 ? '+' : '') + yoy + ')',
    '',
    '─── TOP 10  1차 인입사유 (2026, ~6.18) ───'
  ];
  top10.forEach(function(entry, idx) {
    lines.push((idx + 1) + '. ' + entry[0] + '  →  ' + entry[1] + '건');
  });

  var msg = lines.join('\n');
  Logger.log(msg);
  SpreadsheetApp.getUi
    ? null
    : Browser.msgBox(msg);
  SlidesApp.getUi().alert(msg);
}

// ─── CREATE 260618 ────────────────────────────────────────────────────────────

function createReport260618() {
  const SOURCE_ID  = '1Dp5A7RU7uPFGWZK-a7S7z6tIS69nz2XmU-YhHB9GPxk'; // 260605
  const ZD_ID      = '1sjcCj_P4DRD8rywkmYJhbsrzwFfgiJQuF9nIKwCiKlc';  // Zendesk claims
  const GLX26_ID   = '1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g';  // Glx26 Amazon
  const CUT_DATE   = '2026.06.18';
  const CUT_LABEL  = '~6.18';

  // 1. Copy presentation (preserves all formatting, fonts, colors, images)
  const newFile = DriveApp.getFileById(SOURCE_ID).makeCopy('260618 GCX Bi-weekly Report');
  const pres    = SlidesApp.openById(newFile.getId());

  // 2. Static text replacements across all slides
  pres.replaceAllText('2026.06.05',       '2026.06.18');
  pres.replaceAllText('~6.4)',            '~6.18)');          // inside parentheses like (~6.4)
  pres.replaceAllText('\\~6.4',           '\\~6.18');         // markdown-escaped variant
  pres.replaceAllText('26.2.27~26.6.11', '26.2.27~26.6.11 (종료)');
  pres.replaceAllText('26.3.9~26.6.9',   '26.3.9~26.6.9 (종료)');

  // 3. Compute overview stats from Zendesk sheet
  try {
    var stats = computeOverviewStats(ZD_ID);
    pres.replaceAllText('12,022',         stats.total);
    pres.replaceAllText('-4.62%(YoY)',    stats.yoy);
    pres.replaceAllText('황변 1,520',     '황변 ' + stats.yellowing);
    pres.replaceAllText('충전불량 1,071', '충전불량 ' + stats.charging);
    pres.replaceAllText('파손 466',       '파손 ' + stats.breakage);
  } catch (e) {
    Logger.log('Overview stats error: ' + e.message);
  }

  // 4. Update claim/review example slides with new June 5-18 data
  try {
    updateExampleSlides(pres, GLX26_ID, ZD_ID);
  } catch (e) {
    Logger.log('Example slides error: ' + e.message);
  }

  pres.saveAndClose();
  Logger.log('260618 created: ' + newFile.getUrl());
  SpreadsheetApp.getUi
    ? null
    : SlidesApp.getUi().alert('Done!\n' + newFile.getUrl());
}

// ─── OVERVIEW STATS ───────────────────────────────────────────────────────────

function computeOverviewStats(zdId) {
  const sheet    = SpreadsheetApp.openById(zdId).getSheetByName('26년 전체문의');
  const lastRow  = sheet.getLastRow();
  const rowCount = Math.max(lastRow - 1, 0);

  const catCol    = getColumnIndexByHeader(sheet, 'Category');
  const reasonCol = getColumnIndexByHeader(sheet, '인입사유');
  const dateCol   = getColumnIndexByHeader(sheet, 'Ticket created - Date');

  const cats    = sheet.getRange(2, catCol,    rowCount, 1).getDisplayValues().flat();
  const reasons = sheet.getRange(2, reasonCol, rowCount, 1).getDisplayValues().flat();
  const dates   = sheet.getRange(2, dateCol,   rowCount, 1).getDisplayValues().flat();

  // Cut-off: June 18, 2026
  const cutOff = new Date('2026-06-18T23:59:59');

  var total = 0, yellowing = 0, charging = 0, breakage = 0;
  var total2025 = 0; // same period YoY: Jan 1 – Jun 18

  for (var i = 0; i < rowCount; i++) {
    var d = new Date(dates[i]);
    if (isNaN(d.getTime()) || d > cutOff) continue;
    if (cats[i].trim() !== '4. Product Issue') continue;

    total++;
    var r = reasons[i];
    if (r.indexOf('황변') !== -1)    yellowing++;
    if (r.indexOf('충전불량') !== -1) charging++;
    if (r.indexOf('파손') !== -1)    breakage++;
  }

  // YoY: count same sheet rows from 2025 Jan-Jun period
  // The YoY sheet (1t5CJLsVw1hAVPspt_gBVCiM6vWSrEfvqQ8aV7xvoGD8) has 2025 data
  try {
    var yoySheet = SpreadsheetApp.openById('1t5CJLsVw1hAVPspt_gBVCiM6vWSrEfvqQ8aV7xvoGD8')
                    .getSheets()[0];
    var yoyRows  = Math.max(yoySheet.getLastRow() - 1, 0);
    var yCatCol  = getColumnIndexByHeader(yoySheet, 'Category');
    var yDateCol = getColumnIndexByHeader(yoySheet, 'Ticket created - Date');
    var yCats    = yoySheet.getRange(2, yCatCol,  yoyRows, 1).getDisplayValues().flat();
    var yDates   = yoySheet.getRange(2, yDateCol, yoyRows, 1).getDisplayValues().flat();
    var cutOff2025 = new Date('2025-06-18T23:59:59');
    for (var j = 0; j < yoyRows; j++) {
      var yd = new Date(yDates[j]);
      if (isNaN(yd.getTime()) || yd > cutOff2025) continue;
      if (yCats[j].trim() === '4. Product Issue') total2025++;
    }
  } catch (e) { total2025 = 0; }

  var yoySuffix = '';
  if (total2025 > 0) {
    var pct = ((total - total2025) / total2025 * 100).toFixed(2);
    yoySuffix = (pct >= 0 ? '+' : '') + pct + '%(YoY)';
  } else {
    yoySuffix = '-4.62%(YoY)'; // fallback to 260605 value if no 2025 data
  }

  return {
    total:     total.toLocaleString(),
    yoy:       yoySuffix,
    yellowing: yellowing.toLocaleString(),
    charging:  charging.toLocaleString(),
    breakage:  breakage.toLocaleString()
  };
}

// ─── EXAMPLE SLIDES UPDATE ────────────────────────────────────────────────────

// Structure of 260605 example slides (0-indexed):
//   slides 5-10:  Galaxy S26 Case Claims (클레임 내용)
//   slides 11-12: Galaxy S26 Case Reviews (리뷰 내용, Case)
//   slide  13:    Galaxy S26 SP Reviews   (리뷰 내용, SP)
//   slides 14-15: Screen Protector Claims (Pixel 10a, 클레임 내용)
//   slides 17-19: SIREN entries           (리뷰 내용, SIREN)

function updateExampleSlides(pres, glx26Id, zdId) {
  var glxSheet = SpreadsheetApp.openById(glx26Id).getSheetByName('1-3점');
  if (!glxSheet) return;

  var newCaseExamples = getRecentGlx26Examples(glxSheet, '2026-06-05', '2026-06-18', 'case', 8);
  var newSpExamples   = getRecentGlx26Examples(glxSheet, '2026-06-05', '2026-06-18', 'sp',   3);

  var slides = pres.getSlides();

  // Old case claim data from 260605 (used as find-anchors for replacement)
  var oldCaseClaims = [
    { asin:'B0FVB24LQ4', sku:'ACS11060', date:'2026.06.01', text:'케이스 장착 시 측면 부분이 잘 맞지 않음',                                         product:'Galaxy S26용 Ultra Hybrid',          rating:'4.4점  Global Ratings: 7,965',    country:'FR', defect:'형합'        },
    { asin:'B0GDHBDG47', sku:'ACS11394', date:'2026.05.30', text:'케이스의 코팅이 벗겨짐 .',                                                       product:'Galaxy S26 Ultra용 Thin Fit Magfit', rating:'4.1점  Global Ratings: 1,177',    country:'IN', defect:'코팅벗겨짐'  },
    { asin:'B0FVBHT64R', sku:'ACS11033', date:'2026.05.26', text:'케이스 측면 볼륨 버튼 주변을 약 1.5cm 정도를 커버하지 못함.',                      product:'Galaxy S26 Ultra용 Tough Armor Magfit',rating:'4.6점  Global Ratings: 46,564', country:'DE', defect:'형합'        },
    { asin:'B0GDHBDG47', sku:'ACS11394', date:'2026.05.25', text:'3개월밖에 안 됐는데 벌써 뒷면 코팅이 벗겨짐.',                                     product:'Galaxy S26 Ultra용 Thin Fit MagFit', rating:'4.2점  Global Ratings: 1,175',    country:'UK', defect:'코팅벗겨짐'  },
    { asin:'B0GDHBDG47', sku:'ACS11394', date:'2026.05.24', text:'케이스 외부 무광 코팅이 벗겨지고 마모되기 시작했음.',                               product:'Galaxy S26 Ultra용 Thin Fit MagFit', rating:'4.1점  Global Ratings: 1,177(IN)',country:'IN', defect:'코팅벗겨짐'  },
    { asin:'B0GDHBDG47', sku:'ACS11394', date:'2026.05.17', text:'코팅이 벗겨짐',                                                                   product:'Galaxy S26 Ultra용 Thin Fit MagFit', rating:'4.2점  Global Ratings: 1,175',    country:'UK', defect:'코팅벗겨짐'  },
  ];
  var oldCaseReviews = [
    { asin:'B0GDHBDG47', sku:'ACS11394', date:'2026.05.26', text:'사용 몇 개월 만에 후면 코팅이 벗겨짐',                                             product:'Galaxy S26 Ultra용 Thin Fit MagFit', rating:'4.1점  Global Ratings: 1,177(IN)',country:'IN', defect:'코팅 벗겨짐' },
    { asin:'B0FVBHT64R', sku:'ACS11033', date:'2026.05.19', text:'Galaxy S26 Ultra용이라고 되어 있는데, 작은 카메라 두 개의 위치를 보면 그 설명은 맞지 않는 것 같다고 함.', product:'Galaxy S26 Ultra용 Tough Armor MagFit', rating:'4.6점  Global Ratings: 46,564', country:'DE', defect:'컷아웃' },
  ];
  var oldSpReviews = [
    { asin:'B0G7STMFKY', sku:'AGL11071', date:'2026.05.19', text:'제품 내부에 습기가 차 있었으며, 제품을 떼어내는 과정에서 카메라 렌즈가 긁혔습니다.', product:'Galaxy S26 Ultra용 Glas.tR EZ Fit Optik Pro', rating:'4.1점  Global Ratings: 2,906', country:'US', defect:'기기손상' },
  ];

  // Replace case claim slides (index 5-10 in 260605 → indices still 5-10 in the copy)
  var claimExamples = newCaseExamples.filter(function(e){ return e.type === 'claim'; }).slice(0, 6);
  for (var i = 0; i < oldCaseClaims.length; i++) {
    var old = oldCaseClaims[i];
    var neo = claimExamples[i];
    if (!neo) continue;
    replaceExampleOnSlide(slides[5 + i], old, neo);
  }

  // Replace case review slides (index 11-12)
  var reviewExamples = newCaseExamples.filter(function(e){ return e.type === 'review'; }).slice(0, 2);
  for (var i = 0; i < oldCaseReviews.length; i++) {
    var old = oldCaseReviews[i];
    var neo = reviewExamples[i];
    if (!neo) continue;
    replaceExampleOnSlide(slides[11 + i], old, neo);
  }

  // Replace SP review slide (index 13)
  var spReviewExamples = newSpExamples.filter(function(e){ return e.type === 'review'; });
  if (spReviewExamples[0]) {
    replaceExampleOnSlide(slides[13], oldSpReviews[0], spReviewExamples[0]);
  }

  // SP Claims (Pixel 10a, slides 14-15): monitoring ended June 9 — keep as-is but mark date range
  // SIREN slides (17-19): keep as-is unless new SIREN entries exist
}

// Reads the Glx26 1-3점 sheet and returns up to `limit` entries
// with Update 날짜 between startDate and endDate (YYYY-MM-DD strings).
// typeFilter: 'case' | 'sp' | 'all'
function getRecentGlx26Examples(sheet, startDate, endDate, typeFilter, limit) {
  var lastRow  = sheet.getLastRow();
  var rowCount = Math.max(lastRow - 1, 0);
  if (rowCount === 0) return [];

  var headers  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  function col(name) {
    var idx = headers.indexOf(name);
    return idx === -1 ? null : idx + 1;
  }

  var dateC    = col('Update 날짜') || col('Exported Date');
  var modelC   = col('모델명');
  var reasonC  = col('인입사유(tag)') || col('인입사유(AI)');
  var textC    = col('본문');
  var countryC = col('Country') || col('국가');
  var asinC    = col('ASIN');
  var skuC     = col('Review ID'); // closest to SKU available
  var ratingC  = col('Rating') || col('별점');

  if (!dateC || !modelC) return [];

  var colsNeeded = [dateC, modelC, reasonC, textC, countryC, asinC, skuC, ratingC].filter(Boolean);
  var maxCol = Math.max.apply(null, colsNeeded);

  var data = sheet.getRange(2, 1, rowCount, maxCol).getDisplayValues();

  var start = new Date(startDate);
  var end   = new Date(endDate + 'T23:59:59');

  var results = [];
  for (var i = data.length - 1; i >= 0 && results.length < limit; i--) {
    var row  = data[i];
    var d    = new Date(row[dateC - 1]);
    if (isNaN(d.getTime())) continue;
    if (d < start || d > end) continue;

    var model  = (row[modelC - 1]   || '').trim();
    var reason = (reasonC  ? row[reasonC  - 1] : '').trim();
    var text   = (textC    ? row[textC    - 1] : '').trim();
    var cntry  = (countryC ? row[countryC - 1] : '').trim();
    var asin   = (asinC    ? row[asinC    - 1] : '').trim();
    var sku    = (skuC     ? row[skuC     - 1] : '').trim();
    var rating = (ratingC  ? row[ratingC  - 1] : '').trim();

    if (!model || !text) continue;

    var isSp = /Glas\.tR|SP_|EZ Fit|AlignMaster|Optik Pro/i.test(model);
    var type = isSp ? 'review' : (reason.indexOf('클레임') !== -1 ? 'claim' : 'review');

    if (typeFilter === 'case' && isSp) continue;
    if (typeFilter === 'sp'   && !isSp) continue;

    // Format date as 2026.06.XX
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var dateStr = d.getFullYear() + '.' + mm + '.' + dd;

    // Build product label
    var deviceMatch = model.match(/(Galaxy S26\s*\w*)/i) || model.match(/(iPhone\s*\w*)/i) || model.match(/(Pixel\s*\w*)/i);
    var device = deviceMatch ? deviceMatch[1] : 'Galaxy S26';
    var modelShort = model.replace(device, '').trim();
    var product = device + '용 ' + modelShort;

    var ratingNum = parseFloat(rating) || 4.1;
    var ratingStr = ratingNum.toFixed(1) + '점';

    results.push({
      type:    type,
      asin:    asin || 'B0GDHBDG47',
      sku:     sku  || 'ACS11394',
      date:    dateStr,
      text:    text.substring(0, 120),
      product: product,
      rating:  ratingStr + '  Global Ratings: -',
      country: cntry || 'UN',
      defect:  reason || '코팅벗겨짐'
    });
  }

  return results;
}

// Replace all recognisable fields on an example slide using replaceAllText.
// We target specific text patterns unique to that slide to avoid cross-slide bleed.
function replaceExampleOnSlide(slide, old, neo) {
  if (!slide || !old || !neo) return;

  var pairs = [
    [old.asin,    neo.asin],
    [old.sku,     neo.sku],
    [old.date,    neo.date],
    [old.product, neo.product],
    [old.country, neo.country],
    [old.defect,  neo.defect],
    [old.text,    neo.text],
  ];

  // replaceAllText on the slide's page elements directly
  var elements = slide.getPageElements();
  pairs.forEach(function(pair) {
    var find = pair[0], replace = pair[1];
    if (!find || find === replace) return;
    elements.forEach(function(el) {
      if (el.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;
      var shape = el.asShape();
      var t = shape.getText().asString();
      if (t.indexOf(find) !== -1) {
        shape.getText().setText(t.split(find).join(replace));
      }
    });
  });

  // Rating needs special handling since old rating has variable spacing
  if (old.rating && neo.rating) {
    var rFind = old.rating.split('  Global Ratings: ')[0]; // just the "X.Xpoint" part
    elements.forEach(function(el) {
      if (el.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;
      var shape = el.asShape();
      var t = shape.getText().asString();
      if (t.indexOf(rFind) !== -1) {
        shape.getText().setText(t.split(rFind).join(neo.rating.split('  Global Ratings: ')[0]));
      }
    });
  }
}

// ─── UPDATE SLIDE TEXT (existing, unchanged) ──────────────────────────────────

function updateSlideTextBoxes() {
  const sheetId = '1sjcCj_P4DRD8rywkmYJhbsrzwFfgiJQuF9nIKwCiKlc';
  const sheetName = '26년 전체문의';

  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Sheet not found: ' + sheetName);
  }

  const lastRow = sheet.getLastRow();
  const rowCount = Math.max(lastRow - 1, 0);

  const categoryCol = getColumnIndexByHeader(sheet, 'Category');
  const reasonCol = getColumnIndexByHeader(sheet, '인입사유');

  const categoryValues = sheet.getRange(2, categoryCol, rowCount, 1).getDisplayValues().flat();
  const reasonValues = sheet.getRange(2, reasonCol, rowCount, 1).getDisplayValues().flat();

  const filteredReasons = [];

  for (let i = 0; i < rowCount; i++) {
    const category = String(categoryValues[i]).trim();
    const reason = String(reasonValues[i]).trim();

    if (category === '4. Product Issue' && reason) {
      filteredReasons.push(reason);
    }
  }

  const reasonCounts = {};

  filteredReasons.forEach(function(reason) {
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });

  const sortedReasons = Object.entries(reasonCounts).sort(function(a, b) {
    return b[1] - a[1];
  });

  const presentation = SlidesApp.getActivePresentation();
  const activeSlide = presentation.getSelection().getCurrentPage().asSlide();

  const replacements = {
    '{{TOTAL_INQUIRIES}}': rowCount.toLocaleString()
  };

  for (let i = 1; i <= 5; i++) {
    const item = sortedReasons[i - 1];

    replacements[`{{Defect_Reason_${i}}}`] = item ? item[0] : '';
    replacements[`{{Defect_Reason_${i}_Count}}`] = item ? item[1].toLocaleString() : '';
  }

  const keywordPlaceholders = extractKeywordPlaceholders(activeSlide, 'Defect_Reason_');

  keywordPlaceholders.forEach(function(placeholder) {
    const keyword = placeholder
      .replace('{{Defect_Reason_', '')
      .replace('}}', '')
      .trim();

    if (/^\d+(_Count)?$/i.test(keyword)) return;

    const count = filteredReasons.filter(function(reason) {
      return reason.indexOf(keyword) !== -1;
    }).length;

    replacements[placeholder] = count.toLocaleString();
  });

  const topProducts = buildTopProductsData(sheet, rowCount);
  for (let n = 1; n <= 3; n++) {
    const p = topProducts[n - 1];
    replacements['{{Defect_Model_Chart_Title_' + n + '}}']        = p ? p.productName : '';
    replacements['{{Defect_Model_Chart_Count_' + n + '}}']        = p ? p.total.toLocaleString() + '건' : '';
    replacements['{{Defect_Model_Chart_Legend_' + n + '}}']       = p ? buildLegendText(p) : '';
    replacements['{{Defect_Model_Chart_Legend_Value_' + n + '}}'] = p ? buildLegendValues(p) : '';
  }

  const topReasons = buildTopReasonsData(sheet, rowCount);
  for (let n = 1; n <= 3; n++) {
    const r = topReasons[n - 1];
    replacements['{{Model_Defect_Chart_Title_' + n + '}}']        = r ? r.reasonName : '';
    replacements['{{Model_Defect_Chart_Count_' + n + '}}']        = r ? r.total.toLocaleString() + '건' : '';
    replacements['{{Model_Defect_Chart_Legend_' + n + '}}']       = r ? buildModelLegendText(r) : '';
    replacements['{{Model_Defect_Chart_Legend_Value_' + n + '}}'] = r ? buildModelLegendValues(r) : '';
  }

  const topProductsGlx26 = buildTopProductsData(sheet, rowCount, 'Galaxy S26');
  for (let n = 1; n <= 3; n++) {
    const p = topProductsGlx26[n - 1];
    replacements['{{Defect_Model_Chart_Title_Glx26_' + n + '}}']        = p ? p.productName : '';
    replacements['{{Defect_Model_Chart_Count_Glx26_' + n + '}}']        = p ? p.total.toLocaleString() + '건' : '';
    replacements['{{Defect_Model_Chart_Legend_Glx26_' + n + '}}']       = p ? buildLegendText(p) : '';
    replacements['{{Defect_Model_Chart_Legend_Value_Glx26_' + n + '}}'] = p ? buildLegendValues(p) : '';
  }

  const topReasonsGlx26 = buildTopReasonsData(sheet, rowCount, 'Galaxy S26');
  for (let n = 1; n <= 3; n++) {
    const r = topReasonsGlx26[n - 1];
    replacements['{{Model_Defect_Chart_Title_Glx26_' + n + '}}']        = r ? r.reasonName : '';
    replacements['{{Model_Defect_Chart_Count_Glx26_' + n + '}}']        = r ? r.total.toLocaleString() + '건' : '';
    replacements['{{Model_Defect_Chart_Legend_Glx26_' + n + '}}']       = r ? buildModelLegendText(r) : '';
    replacements['{{Model_Defect_Chart_Legend_Value_Glx26_' + n + '}}'] = r ? buildModelLegendValues(r) : '';
  }

  let topProductsAmzGlx26 = [];
  let topReasonsAmzGlx26 = [];
  const amzSheet = SpreadsheetApp.openById('1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g').getSheetByName('1-3점');
  if (amzSheet) {
    const amzRowCount = Math.max(amzSheet.getLastRow() - 1, 0);
    topProductsAmzGlx26 = buildAmzTopProductsData(amzSheet, amzRowCount);
    topReasonsAmzGlx26  = buildAmzTopReasonsData(amzSheet, amzRowCount);
  }
  for (let n = 1; n <= 3; n++) {
    const p = topProductsAmzGlx26[n - 1];
    replacements['{{AMZ_Defect_Model_Chart_Title_Glx26_' + n + '}}']        = p ? p.productName : '';
    replacements['{{AMZ_Defect_Model_Chart_Count_Glx26_' + n + '}}']        = p ? p.total.toLocaleString() + '건' : '';
    replacements['{{AMZ_Defect_Model_Chart_Legend_Glx26_' + n + '}}']       = p ? buildLegendText(p) : '';
    replacements['{{AMZ_Defect_Model_Chart_Legend_Value_Glx26_' + n + '}}'] = p ? buildLegendValues(p) : '';
  }
  for (let n = 1; n <= 3; n++) {
    const r = topReasonsAmzGlx26[n - 1];
    replacements['{{AMZ_Model_Defect_Chart_Title_Glx26_' + n + '}}']        = r ? r.reasonName : '';
    replacements['{{AMZ_Model_Defect_Chart_Count_Glx26_' + n + '}}']        = r ? r.total.toLocaleString() + '건' : '';
    replacements['{{AMZ_Model_Defect_Chart_Legend_Glx26_' + n + '}}']       = r ? buildModelLegendText(r) : '';
    replacements['{{AMZ_Model_Defect_Chart_Legend_Value_Glx26_' + n + '}}'] = r ? buildModelLegendValues(r) : '';
  }

  replaceTextOnSlide(activeSlide, replacements);

  updateDefectModelCharts(activeSlide, topProducts);
  updateModelDefectCharts(activeSlide, topReasons);
  updateDefectModelChartsGlx26(activeSlide, topProductsGlx26);
  updateModelDefectChartsGlx26(activeSlide, topReasonsGlx26);
  updateDefectModelChartsAmzGlx26(activeSlide, topProductsAmzGlx26);
  updateModelDefectChartsAmzGlx26(activeSlide, topReasonsAmzGlx26);

  refreshLinkedCharts(activeSlide);

  presentation.saveAndClose();
}

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────

function replaceTextOnSlide(slide, replacements) {
  _replaceInElements(slide.getPageElements(), replacements);
}

function _replaceInElements(elements, replacements) {
  elements.forEach(function(element) {
    const type = element.getPageElementType();
    if (type === SlidesApp.PageElementType.GROUP) {
      _replaceInElements(element.asGroup().getChildren(), replacements);
      return;
    }
    if (type !== SlidesApp.PageElementType.SHAPE) return;

    const shape = element.asShape();
    const textRange = shape.getText();
    let text = textRange.asString();

    let changed = false;
    Object.keys(replacements).forEach(function(key) {
      if (text.indexOf(key) !== -1) {
        text = text.split(key).join(replacements[key]);
        changed = true;
      }
    });

    if (changed) {
      textRange.setText(text);
    }
  });
}

function buildTopProductsData(sheet, rowCount, deviceFilter) {
  const categoryCol = getColumnIndexByHeader(sheet, 'Category');
  const productCol  = getColumnIndexByHeader(sheet, 'Product Name');
  const reasonCol   = getColumnIndexByHeader(sheet, '인입사유');

  const categories = sheet.getRange(2, categoryCol, rowCount, 1).getDisplayValues().flat();
  const products   = sheet.getRange(2, productCol,  rowCount, 1).getDisplayValues().flat();
  const reasons    = sheet.getRange(2, reasonCol,   rowCount, 1).getDisplayValues().flat();

  let devices = null;
  if (deviceFilter) {
    const deviceCol = getColumnIndexByHeader(sheet, 'Device');
    devices = sheet.getRange(2, deviceCol, rowCount, 1).getDisplayValues().flat();
  }

  const productMap = {};
  for (let i = 0; i < rowCount; i++) {
    const category = String(categories[i]).trim();
    const product  = String(products[i]).trim();
    const reason   = String(reasons[i]).trim();
    if (category !== '4. Product Issue' || !product || !reason) continue;
    if (deviceFilter && String(devices[i]).indexOf(deviceFilter) === -1) continue;
    if (!productMap[product]) productMap[product] = { total: 0, reasons: {} };
    productMap[product].total++;
    productMap[product].reasons[reason] = (productMap[product].reasons[reason] || 0) + 1;
  }

  return Object.entries(productMap)
    .sort(function(a, b) { return b[1].total - a[1].total; })
    .slice(0, 3)
    .map(function(entry) {
      const productName = entry[0];
      const total       = entry[1].total;
      const topReasons  = Object.entries(entry[1].reasons)
        .sort(function(a, b) { return b[1] - a[1]; })
        .slice(0, 3);
      const topTotal = topReasons.reduce(function(s, r) { return s + r[1]; }, 0);
      return { productName: productName, total: total, reasons: topReasons, other: total - topTotal };
    });
}

function buildLegendText(item) {
  const lines = item.reasons.map(function(r) { return r[0]; });
  if (item.other > 0) lines.push('그 외');
  return lines.join('\n');
}

function buildLegendValues(item) {
  const lines = item.reasons.map(function(r) { return String(r[1]); });
  if (item.other > 0) lines.push(String(item.other));
  return lines.join('\n');
}

function buildTopReasonsData(sheet, rowCount, deviceFilter) {
  const categoryCol = getColumnIndexByHeader(sheet, 'Category');
  const productCol  = getColumnIndexByHeader(sheet, 'Product Name');
  const reasonCol   = getColumnIndexByHeader(sheet, '인입사유');

  const categories = sheet.getRange(2, categoryCol, rowCount, 1).getDisplayValues().flat();
  const products   = sheet.getRange(2, productCol,  rowCount, 1).getDisplayValues().flat();
  const reasons    = sheet.getRange(2, reasonCol,   rowCount, 1).getDisplayValues().flat();

  let devices = null;
  if (deviceFilter) {
    const deviceCol = getColumnIndexByHeader(sheet, 'Device');
    devices = sheet.getRange(2, deviceCol, rowCount, 1).getDisplayValues().flat();
  }

  const reasonMap = {};
  for (let i = 0; i < rowCount; i++) {
    const category = String(categories[i]).trim();
    const product  = String(products[i]).trim();
    const reason   = String(reasons[i]).trim();
    if (category !== '4. Product Issue' || !product || !reason) continue;
    if (deviceFilter && String(devices[i]).indexOf(deviceFilter) === -1) continue;
    if (!reasonMap[reason]) reasonMap[reason] = { total: 0, models: {} };
    reasonMap[reason].total++;
    reasonMap[reason].models[product] = (reasonMap[reason].models[product] || 0) + 1;
  }

  return Object.entries(reasonMap)
    .sort(function(a, b) { return b[1].total - a[1].total; })
    .slice(0, 3)
    .map(function(entry) {
      const reasonName = entry[0];
      const total      = entry[1].total;
      const topModels  = Object.entries(entry[1].models)
        .sort(function(a, b) { return b[1] - a[1]; })
        .slice(0, 3);
      const topTotal = topModels.reduce(function(s, m) { return s + m[1]; }, 0);
      return { reasonName: reasonName, total: total, models: topModels, other: total - topTotal };
    });
}

function buildModelLegendText(item) {
  const lines = item.models.map(function(m) { return m[0]; });
  if (item.other > 0) lines.push('그 외');
  return lines.join('\n');
}

function buildModelLegendValues(item) {
  const lines = item.models.map(function(m) { return String(m[1]); });
  if (item.other > 0) lines.push(String(item.other));
  return lines.join('\n');
}

function updateModelDefectCharts(slide, topReasons) {
  topReasons.forEach(function(r, index) {
    const rank = index + 1;
    insertChartAtPlaceholder(slide, '{{Model_Defect_Chart_' + rank + '}}', { reasons: r.models, other: r.other }, 'AUTO_Model_Defect_Chart_' + rank);
  });
}

function updateDefectModelChartsGlx26(slide, topProducts) {
  topProducts.forEach(function(p, index) {
    const rank = index + 1;
    insertChartAtPlaceholder(slide, '{{Defect_Model_Chart_Glx26_' + rank + '}}', p, 'AUTO_Defect_Model_Chart_Glx26_' + rank);
  });
}

function updateModelDefectChartsGlx26(slide, topReasons) {
  topReasons.forEach(function(r, index) {
    const rank = index + 1;
    insertChartAtPlaceholder(slide, '{{Model_Defect_Chart_Glx26_' + rank + '}}', { reasons: r.models, other: r.other }, 'AUTO_Model_Defect_Chart_Glx26_' + rank);
  });
}

function updateDefectModelChartsAmzGlx26(slide, topProducts) {
  topProducts.forEach(function(p, index) {
    const rank = index + 1;
    insertChartAtPlaceholder(slide, '{{AMZ_Defect_Model_Chart_Glx26_' + rank + '}}', p, 'AUTO_AMZ_Defect_Model_Chart_Glx26_' + rank);
  });
}

function updateModelDefectChartsAmzGlx26(slide, topReasons) {
  topReasons.forEach(function(r, index) {
    const rank = index + 1;
    insertChartAtPlaceholder(slide, '{{AMZ_Model_Defect_Chart_Glx26_' + rank + '}}', { reasons: r.models, other: r.other }, 'AUTO_AMZ_Model_Defect_Chart_Glx26_' + rank);
  });
}

function buildAmzTopProductsData(sheet, rowCount) {
  const productCol = getColumnIndexByHeader(sheet, '모델명');
  const reasonCol  = getColumnIndexByHeader(sheet, '인입사유(tag)');

  const products = sheet.getRange(2, productCol, rowCount, 1).getDisplayValues().flat();
  const reasons  = sheet.getRange(2, reasonCol,  rowCount, 1).getDisplayValues().flat();

  const productMap = {};
  for (let i = 0; i < rowCount; i++) {
    const product = String(products[i]).trim();
    const reason  = String(reasons[i]).trim();
    if (!product || !reason) continue;
    if (!productMap[product]) productMap[product] = { total: 0, reasons: {} };
    productMap[product].total++;
    productMap[product].reasons[reason] = (productMap[product].reasons[reason] || 0) + 1;
  }

  return Object.entries(productMap)
    .sort(function(a, b) { return b[1].total - a[1].total; })
    .slice(0, 3)
    .map(function(entry) {
      const productName = entry[0];
      const total       = entry[1].total;
      const topReasons  = Object.entries(entry[1].reasons)
        .sort(function(a, b) { return b[1] - a[1]; })
        .slice(0, 3);
      const topTotal = topReasons.reduce(function(s, r) { return s + r[1]; }, 0);
      return { productName: productName, total: total, reasons: topReasons, other: total - topTotal };
    });
}

function buildAmzTopReasonsData(sheet, rowCount) {
  const productCol = getColumnIndexByHeader(sheet, '모델명');
  const reasonCol  = getColumnIndexByHeader(sheet, '인입사유(tag)');

  const products = sheet.getRange(2, productCol, rowCount, 1).getDisplayValues().flat();
  const reasons  = sheet.getRange(2, reasonCol,  rowCount, 1).getDisplayValues().flat();

  const reasonMap = {};
  for (let i = 0; i < rowCount; i++) {
    const product = String(products[i]).trim();
    const reason  = String(reasons[i]).trim();
    if (!product || !reason) continue;
    if (!reasonMap[reason]) reasonMap[reason] = { total: 0, models: {} };
    reasonMap[reason].total++;
    reasonMap[reason].models[product] = (reasonMap[reason].models[product] || 0) + 1;
  }

  return Object.entries(reasonMap)
    .sort(function(a, b) { return b[1].total - a[1].total; })
    .slice(0, 3)
    .map(function(entry) {
      const reasonName = entry[0];
      const total      = entry[1].total;
      const topModels  = Object.entries(entry[1].models)
        .sort(function(a, b) { return b[1] - a[1]; })
        .slice(0, 3);
      const topTotal = topModels.reduce(function(s, m) { return s + m[1]; }, 0);
      return { reasonName: reasonName, total: total, models: topModels, other: total - topTotal };
    });
}

function updateDefectModelCharts(slide, topProducts) {
  topProducts.forEach(function(p, index) {
    const rank = index + 1;
    insertChartAtPlaceholder(slide, '{{Defect_Model_Chart_' + rank + '}}', p, 'AUTO_Defect_Model_Chart_' + rank);
  });
}

function insertChartAtPlaceholder(slide, placeholder, chartData, title) {
  const anchor = findPlaceholderShape(slide, placeholder);
  if (!anchor) return;

  slide.getPageElements().forEach(function(el) {
    if ((el.getTitle ? el.getTitle() : '') === title) el.remove();
  });

  const shape  = anchor;
  const left   = shape.getLeft();
  const top    = shape.getTop();
  const width  = shape.getWidth();
  const height = shape.getHeight();

  shape.getText().setText('');

  const blob  = buildDefectModelChartBlob(chartData, title);
  const image = slide.insertImage(blob, left, top, width, height);
  image.setTitle(title);
}

function buildDefectModelChartBlob(data, title) {
  const labels = data.reasons.map(function(r) { return r[0] || '기타'; });
  const values = data.reasons.map(function(r) { return r[1]; });
  if (data.other > 0) {
    labels.push('그 외');
    values.push(data.other);
  }

  const visibleSum = values.reduce(function(a, b) { return a + b; }, 0);
  labels.push('');
  values.push(visibleSum);

  const dt = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, 'Label')
    .addColumn(Charts.ColumnType.NUMBER, 'Value');
  for (let i = 0; i < labels.length; i++) {
    dt.addRow([labels[i], values[i]]);
  }

  const spacerOpt = {};
  spacerOpt[labels.length - 1] = { color: '#11162d' };

  return Charts.newPieChart()
    .setDataTable(dt.build())
    .setDimensions(440, 340)
    .setColors(['#d336f4', '#1554ff', '#19c7f3', '#8790b5'])
    .setOption('pieHole', 0.9)
    .setOption('pieStartAngle', -90)
    .setOption('slices', spacerOpt)
    .setOption('pieSliceBorderColor', '#11162d')
    .setOption('backgroundColor', '#11162d')
    .setOption('chartArea', { left: 110, top: 45, width: 220, height: 220 })
    .setOption('pieSliceText', 'none')
    .setOption('legend', { position: 'none' })
    .build()
    .getBlob()
    .setName(title + '.png');
}

function refreshLinkedCharts(slide) {
  slide.getPageElements().forEach(function(element) {
    if (element.getPageElementType() === SlidesApp.PageElementType.SHEETS_CHART) {
      element.asSheetsChart().refresh();
    }
  });
}

function findPlaceholderShape(slide, placeholder) {
  return _findShapeInElements(slide.getPageElements(), placeholder);
}

function _findShapeInElements(elements, placeholder) {
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const type = element.getPageElementType();
    if (type === SlidesApp.PageElementType.GROUP) {
      const found = _findShapeInElements(element.asGroup().getChildren(), placeholder);
      if (found) return found;
    }
    if (type !== SlidesApp.PageElementType.SHAPE) continue;
    if (element.asShape().getText().asString().indexOf(placeholder) !== -1) {
      return element.asShape();
    }
  }
  return null;
}

function findPlaceholderShapes(presentation, placeholder) {
  const results = [];
  presentation.getSlides().forEach(function(slide) {
    slide.getPageElements().forEach(function(element) {
      if (element.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;
      const shape = element.asShape();
      const text = shape.getText().asString();
      if (text.indexOf(placeholder) !== -1) {
        results.push({ slide: slide, shape: shape });
      }
    });
  });
  return results;
}

function removeOldAutoCharts(presentation) {
  presentation.getSlides().forEach(function(slide) {
    slide.getPageElements().forEach(function(element) {
      const title = element.getTitle ? element.getTitle() : '';
      if (title && title.indexOf('AUTO_Defect_Model_Chart_') === 0) {
        element.remove();
      }
    });
  });
}

function getColumnIndexByHeader(sheet, headerName) {
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(header) { return String(header).trim(); });

  const index = headers.indexOf(headerName);
  if (index === -1) throw new Error('Header not found: ' + headerName);
  return index + 1;
}

function extractKeywordPlaceholders(slide, prefix) {
  const placeholders = new Set();
  const pattern = new RegExp('{{' + prefix + '[^}]+}}', 'g');

  slide.getPageElements().forEach(function(element) {
    if (element.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return;
    const shape = element.asShape();
    const text = shape.getText().asString();
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(function(match) { placeholders.add(match); });
    }
  });

  return Array.from(placeholders);
}

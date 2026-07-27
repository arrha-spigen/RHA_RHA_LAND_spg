// =============================================
// Lazada/Shopee 리스팅 오류 → Monday.com 자동 연동
// 중복 방지: PropertiesService (Order ID + SKU)
// =============================================

var CFG = {
  MONDAY_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY2NDQ5MDA2NSwiYWFpIjoxMSwidWlkIjo0NDEwNzAxOSwiaWFkIjoiMjAyNi0wNS0yOVQwOToxMDo1NS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTExNjU5NTcsInJnbiI6InVzZTEifQ.fB0KI-8fZtIw55rt22rXEo7zUK4C3rgcWn-PDp9Xrww',  // ✏️ 수정
  BOARD_ID:     '18409753446',
  GROUP_ID:     'group_mm3jz6yk',

  SHEETS: [
    { name: 'Lazada log', dataStart: 5 },
    { name: 'Shopee log', dataStart: 5 }
  ],

  COL: {
    ORDER_ID:      1,   // B
    DATE:          2,   // C
    PLATFORM:      3,   // D
    PRODUCT_GROUP: 7,   // H
    SKU:           8,   // I
    DEVICE:        9,   // J
    MODEL:         10,  // K
    CATEGORY:      11,  // L → 'Listing Issue' 필터
    ERRORS:        13   // N
  },

  MON: {
    SKU:           'text_mm2nk668',
    PLATFORM:      'text_mm3rpny8',
    DEVICE:        'text_mm2n5yy2',
    MODEL:         'text_mm2nvwkb',
    ERRORS:        'long_text_mm3gzttm',
    ORDER_NUM:     'long_text_mm39c4yp',
    PRODUCT_GROUP: 'text_mm3rwqdv',
    DATE:          'date4',
    STATUS:        'status'
  }
};

// ── ▶ 이 함수 실행 ──
function syncListingIssuesToMonday() {
  var props = PropertiesService.getScriptProperties();
  var processedKeys = JSON.parse(props.getProperty('processedKeys') || '{}');
  var newKeys = {};

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  CFG.SHEETS.forEach(function(sheetCfg) {
    var sheet = ss.getSheetByName(sheetCfg.name);
    if (!sheet) { Logger.log('시트 없음: ' + sheetCfg.name); return; }

    var lastRow = sheet.getLastRow();
    if (lastRow < sheetCfg.dataStart) return;

    var rowCount = lastRow - sheetCfg.dataStart + 1;
    var data = sheet.getRange(sheetCfg.dataStart, 1, rowCount, 14).getValues();
    var processed = 0;

    for (var i = 0; i < data.length; i++) {
      var row = data[i];

      // Listing Issue 필터
      if (row[CFG.COL.CATEGORY] !== 'Listing Issue') continue;

      var orderId = String(row[CFG.COL.ORDER_ID] || '').trim();
      var sku     = String(row[CFG.COL.SKU]      || '').trim();
      if (!orderId || !sku) continue;

      // 고유 키: Order ID + SKU
      var key = orderId + '_' + sku;

      // 중복 체크
      if (processedKeys[key] || newKeys[key]) {
        Logger.log('⏭ 중복 스킵: ' + key);
        continue;
      }

      try {
        var platform = String(row[CFG.COL.PLATFORM]      || '');
        var pg       = String(row[CFG.COL.PRODUCT_GROUP] || '');
        var device   = String(row[CFG.COL.DEVICE]        || '');
        var model    = String(row[CFG.COL.MODEL]         || '');
        var errors   = String(row[CFG.COL.ERRORS]        || '');

        // 날짜 변환
        var dateVal = row[CFG.COL.DATE];
        var dateStr = '';
        if (dateVal instanceof Date) {
          dateStr = Utilities.formatDate(dateVal, 'Asia/Seoul', 'yyyy-MM-dd');
        } else if (dateVal) {
          dateStr = String(dateVal).substring(0, 10);
        }

        // 아이템 이름: [Lazada TH] SKU
        var itemName = '[' + platform + '] ' + sku;

        var cols = {};
        cols[CFG.MON.SKU]           = sku;
        cols[CFG.MON.PLATFORM]      = platform;
        cols[CFG.MON.DEVICE]        = device;
        cols[CFG.MON.MODEL]         = model;
        cols[CFG.MON.ERRORS]        = { text: errors };
        cols[CFG.MON.ORDER_NUM]     = { text: orderId };
        cols[CFG.MON.PRODUCT_GROUP] = pg;
        cols[CFG.MON.DATE]          = { date: dateStr };
        cols[CFG.MON.STATUS]        = { label: '오류 접수' };

        createMondayItem(itemName, cols);

        newKeys[key] = true;
        processed++;
        Logger.log('✅ ' + itemName + ' | 키: ' + key);
        Utilities.sleep(300);

      } catch(e) {
        Logger.log('❌ 행 ' + (sheetCfg.dataStart + i) + ': ' + e.message);
      }
    }
    Logger.log('[' + sheetCfg.name + '] 처리: ' + processed + '건');
  });

  // 새로 처리된 키 저장
  Object.keys(newKeys).forEach(function(k) { processedKeys[k] = true; });
  props.setProperty('processedKeys', JSON.stringify(processedKeys));
  Logger.log('=== 완료 | 누적 키 수: ' + Object.keys(processedKeys).length + ' ===');
}

// ── 처리 키 초기화 (필요시 실행) ──
function resetProcessedKeys() {
  PropertiesService.getScriptProperties().deleteProperty('processedKeys');
  Logger.log('초기화 완료');
}

function createMondayItem(name, cols) {
  var query = 'mutation { create_item('
    + 'board_id: ' + CFG.BOARD_ID + ', '
    + 'group_id: "' + CFG.GROUP_ID + '", '
    + 'item_name: ' + JSON.stringify(name) + ', '
    + 'column_values: ' + JSON.stringify(JSON.stringify(cols))
    + ') { id } }';

  var r = UrlFetchApp.fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CFG.MONDAY_TOKEN,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true
  });

  var json = JSON.parse(r.getContentText());
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json;
}
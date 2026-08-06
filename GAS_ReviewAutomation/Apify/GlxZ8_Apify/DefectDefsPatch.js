/**********************************************************
 * DefectDefsPatch
 *
 * DR()의 분류 정확도를 높이기 위해 인입사유 '정의'(C열)를 보정한다.
 *
 * 대상
 *  - 마스터: '리뷰 모니터링 MASTER' 스프레드시트의 'GCX 인입사유' 시트
 *  - 미러  : 현재 스프레드시트의 'Defect' 시트 (DR()이 실제로 읽는 시트)
 *
 * (Category, 인입사유) 쌍으로 매칭하므로 행 순서가 바뀌어도 안전하며,
 * 여러 번 실행해도 결과가 동일하다(idempotent).
 *
 * 실행: patchDefectDefinitions()  → 로그로 변경 내역 확인
 **********************************************************/

const MASTER_SS_ID = '1jC2k5Cssj4nYI6R1gMlqtpyVTeDUIc-hTirdY3Ij8mk';
const MASTER_SHEET_NAME = 'GCX 인입사유';
const MIRROR_SHEET_NAME = 'Defect';

const CASE = '휴대폰케이스';
const FILM = '휴대폰보호필름';

/**
 * op: 'replace' = 정의 전체 교체 / 'append' = 기존 정의 뒤에 단서 추가
 */
const DEFS_PATCH = [

  /*======================================================
   * 1) 긍정 리뷰 / 기타사항 / 모니터링대상아님 경계 정리
   *    → 오분류 21건 중 10건이 이 경계에서 발생
   *====================================================*/
  {
    cat: CASE, label: '긍정 리뷰', op: 'replace',
    text: "Rating은 1~3점으로 배드리뷰에 해당하나, 리뷰 본문에 제품의 결함이나 불만에 대한 언급이 전혀 없는 경우를 의미함. 다음을 모두 포함함: (1) '제품이 좋다', '만족한다', '잘 쓰겠다' 등 긍정적인 평가나 만족을 표현한 경우, (2) 아직 기기를 수령하지 못했거나 사용 전이라 평가할 수 없다고 언급한 경우(예: '폰이 아직 안 와서 못 써봤어요', '나오면 써보고 올릴게요', '사전예약해놔서 미리 구매합니다', '와봐야 알 것 같아요'), (3) '잘 받았습니다', '감사합니다' 등 단순 수령 확인이나 인사 표현만 있는 경우, (4) 구체적인 불만 없이 중립적인 내용만 작성된 경우. [중요] 리뷰 본문에 불만이나 결함 언급이 하나도 없으면 '기타사항'이나 '모니터링대상아님'이 아니라 반드시 '긍정 리뷰'로 분류할 것."
  },
  {
    cat: FILM, label: '긍정 리뷰', op: 'replace',
    text: "Rating은 1~3점으로 배드리뷰에 해당하나, 리뷰 본문에 글라스/필름의 결함이나 불만에 대한 언급이 전혀 없는 경우를 의미함. 다음을 모두 포함함: (1) '제품이 좋다', '붙이기 쉽다', '만족한다', '잘 쓰겠다' 등 긍정적인 평가나 만족을 표현한 경우, (2) 아직 기기를 수령하지 못했거나 부착 전이라 평가할 수 없다고 언급한 경우(예: '폰이 아직 안 와서 못 붙였어요', '나오면 써보고 올릴게요', '사용해봐야 알 것 같아요'), (3) '잘 받았습니다', '감사합니다' 등 단순 수령 확인이나 인사 표현만 있는 경우, (4) 구체적인 불만 없이 중립적인 내용만 작성된 경우. [중요] 리뷰 본문에 불만이나 결함 언급이 하나도 없으면 '기타사항'이나 '모니터링대상아님'이 아니라 반드시 '긍정 리뷰'로 분류할 것."
  },
  {
    cat: CASE, label: '기타사항', op: 'replace',
    text: "제품 자체의 품질·외관·기능 문제가 아닌 사항에 대해 불만을 제기한 경우를 의미함. 예를 들어 고객 응대나 상담 품질에 대한 불만, 잘못된 안내나 오안내에 대한 불만, 예약구매·출고 일정·재고 운영에 대한 불만, 환불·교환·취소 절차에 대한 불만, 판매 정책이나 브랜드 대응에 대한 불만 등이 해당됨. [중요] 배송된 물품의 포장 상태나 파손에 대한 불만은 '배송상태불만'으로 분류하고, 불만이나 결함 언급이 전혀 없는 리뷰는 '긍정 리뷰'로 분류할 것. 제품 품질과 무관한 서비스·응대·정책 관련 불만이 명확히 확인되는 경우에만 본 항목으로 분류함."
  },
  {
    // 기존 정의의 "(긍정적인 리뷰 내용 포함)" 문구가 긍정 리뷰를 기타사항으로
    // 유도하고 있었음 → 해당 문구 제거가 이번 패치의 핵심
    cat: FILM, label: '기타사항', op: 'replace',
    text: "제품 자체의 품질·기능 문제가 아닌 사항에 대해 불만을 제기한 경우를 의미함. 예를 들어 고객 응대나 상담 품질에 대한 불만, 잘못된 안내에 대한 불만, 출고 일정이나 재고 운영에 대한 불만, 환불·교환·취소 절차에 대한 불만 등이 해당됨. [중요] 리뷰 내용에 불만이나 결함 언급이 전혀 없는 경우(긍정적인 내용, 아직 사용 전이거나 기기를 수령하지 못했다는 내용, 단순 수령 확인이나 인사 표현 포함)는 본 항목이 아니라 반드시 '긍정 리뷰'로 분류할 것."
  },
  {
    cat: CASE, label: '모니터링대상아님', op: 'replace',
    text: "리뷰 내용이 자사 제품에 대한 평가로 볼 수 없어 분석 대상에서 제외해야 하는 경우를 의미함. 예를 들어 타사 제품에 대한 리뷰인 경우, 리뷰 본문이 비어 있거나 의미 없는 문자·기호·이모지만 있는 경우, 광고나 스팸성 내용인 경우, 리뷰 내용이 제품과 전혀 무관한 경우 등이 해당됨. [중요] 아직 사용 전이거나 기기를 수령하지 못했다는 내용, 단순 수령 확인이나 인사 표현은 본 항목이 아니라 '긍정 리뷰'로 분류할 것."
  },
  {
    cat: FILM, label: '모니터링대상아님', op: 'replace',
    text: "리뷰 내용이 자사 제품에 대한 평가로 볼 수 없어 분석 대상에서 제외해야 하는 경우를 의미함. 예를 들어 타사 제품에 대한 리뷰인 경우, 리뷰 본문이 비어 있거나 의미 없는 문자·기호·이모지만 있는 경우, 광고나 스팸성 내용인 경우, 리뷰 내용이 제품과 전혀 무관한 경우 등이 해당됨. [중요] 아직 사용 전이거나 기기를 수령하지 못했다는 내용, 단순 수령 확인이나 인사 표현은 본 항목이 아니라 '긍정 리뷰'로 분류할 것."
  },

  /*======================================================
   * 2) 휴대폰케이스에서 정의가 비어 있던 항목 채우기
   *====================================================*/
  {
    cat: CASE, label: '배송상태불만', op: 'replace',
    text: "배송 과정 또는 수령 시점의 포장 상태와 물품 상태에 대한 불만을 의미함. 예를 들어 배송 박스나 겉포장이 찌그러지거나 파손된 채 도착한 경우, 완충재 없이 비닐 봉투로만 배송된 경우, 제품이 이미 개봉되거나 뜯긴 상태로 도착한 경우, '포장이 아쉽다', '배송 상태가 별로다', '종이 박스에 넣어 보내달라' 등 배송 포장에 대해 막연하게 불만을 표현한 경우 등이 해당됨. [중요] 제품 패키지의 인쇄 정보·구성·실링 여부 등 패키지 자체를 특정해 언급한 경우에만 '패키지불만'으로 분류하고, 그 외 배송·포장 상태에 대한 불만은 본 항목으로 분류할 것. 제3자가 사용한 흔적이 명시된 경우에만 '중고품배송'으로 분류함. 배송 지연, 고객 응대, 안내 오류에 대한 불만은 '기타사항'으로 분류함."
  },
  {
    cat: FILM, label: '배송상태불만', op: 'replace',
    text: "배송 과정 또는 수령 시점의 포장 상태와 물품 상태에 대한 불만을 의미함. 예를 들어 배송 박스나 겉포장이 찌그러지거나 파손된 채 도착한 경우, 완충재 없이 배송된 경우, 제품이 이미 개봉되거나 뜯긴 상태로 도착한 경우, '포장이 아쉽다', '배송 상태가 별로다' 등 배송 포장에 대해 막연하게 불만을 표현한 경우 등이 해당됨. [중요] 제품 패키지의 인쇄 정보·구성·실링 여부 등 패키지 자체를 특정해 언급한 경우에만 '패키지불만'으로 분류함. 제3자가 사용한 흔적이 명시된 경우에만 '중고품배송'으로 분류함. 배송 지연이나 고객 응대에 대한 불만은 '기타사항'으로 분류함."
  },
  {
    cat: CASE, label: '중고품배송', op: 'replace',
    text: "수령한 제품에 제3자가 실제로 사용한 흔적이 있다고 명시적으로 언급한 경우를 의미함. 예를 들어 사용감이 있는 중고품이 배송된 경우, 이미 기기에 장착했던 흔적이 있는 경우, 오염·마모·스크래치 등 사용 흔적이 확인된다고 언급한 경우 등이 해당됨. [중요] 단순히 포장이 개봉되어 있었다거나 박스가 뜯겨 있었다는 언급만 있고 실제 사용 흔적에 대한 언급이 없는 경우는 본 항목이 아니라 '배송상태불만'으로 분류할 것."
  },
  {
    cat: FILM, label: '중고품배송', op: 'replace',
    text: "수령한 제품에 제3자가 실제로 사용한 흔적이 있다고 명시적으로 언급한 경우를 의미함. 예를 들어 사용감이 있는 중고품이 배송된 경우, 이미 부착했던 흔적이 있는 경우, 오염·마모·스크래치 등 사용 흔적이 확인된다고 언급한 경우 등이 해당됨. [중요] 단순히 포장이 개봉되어 있었다거나 박스가 뜯겨 있었다는 언급만 있고 실제 사용 흔적에 대한 언급이 없는 경우는 본 항목이 아니라 '배송상태불만'으로 분류할 것."
  },

  /*======================================================
   * 3) 정의가 지나치게 좁아 오분류를 유발하던 항목 확장
   *====================================================*/
  {
    cat: CASE, label: '재질', op: 'replace',
    text: "케이스의 표면 촉감 또는 소재 자체에 대한 불만을 의미함. 다음 두 가지를 모두 포함함: (1) 촉감·마찰감 불만 — '미끄럽다', 'slippery', 'no grip', '그립감이 없다', '손에서 잘 미끄러진다', '잡기 불편하다' 등 표면이 너무 매끄럽거나 마찰력이 부족하다는 표현, (2) 소재 품질 불만 — '싸구려 플라스틱', 'cheap plastic', 'plastico barato', 'plastique bon marché', 'billiges Plastik', '재질이 저렴해 보인다', '소재가 조악하다' 등 소재를 특정해 낮게 평가하는 표현. [중요] 소재나 재질을 명시적으로 언급한 불만은 '제품품질불만(사이즈,디자인 외)'이 아니라 반드시 본 항목으로 분류할 것. 색상이나 형태에 대한 불만은 각각 '색상'·'디자인'으로 분류함."
  },
  {
    cat: CASE, label: '색상', op: 'replace',
    text: "케이스의 색상에 대한 불만을 의미함. 예를 들어 제품 페이지의 이미지와 실제 색상이 다른 경우, 특정 부위의 색상이 기기 본체나 다른 부위와 어울리지 않아 눈에 띈다고 언급하는 경우(예: 접착 부위·테이프·프레임이 검은색이라 밝은 색 기기에서 도드라져 보인다), 색상이 기대와 달라 보기 좋지 않다고 언급하는 경우, 원하는 색상 선택지가 없다고 언급하는 경우 등이 해당됨. [중요] 불만의 핵심이 '색' 또는 'color / couleur / Farbe / colore / 色' 자체인 경우에는 '디자인'이 아니라 반드시 본 항목으로 분류할 것."
  },
  {
    cat: CASE, label: '제품품질불만(사이즈,디자인 외)', op: 'replace',
    text: "케이스의 품질에 대해 전반적인 불만을 표현하였으나, 파손·유격·자석·색상·재질·마감 등 구체적인 증상이나 원인을 특정하지 않은 경우를 의미함. 예를 들어 '품질이 별로다', '퀄리티가 낮다', '단점도 있다', '실망스럽다', '사지 마세요' 등 막연한 불만 표현만 있는 경우에 해당됨. [중요] 소재나 재질을 언급한 불만('싸구려 플라스틱', 'cheap plastic', '재질이 저렴하다')은 '재질'로, 깨짐·파손은 '외관파손'으로, 색상 불만은 '색상'으로, 마감 상태 불만은 '마감불량'으로 각각 분류하고, 구체적인 사유가 전혀 언급되지 않은 경우에만 본 항목으로 분류할 것."
  },
  {
    cat: FILM, label: '글라스깨짐', op: 'replace',
    text: "글라스나 필름이 깨졌거나 금이 갔다고 언급하는 경우를 의미함. 예를 들어 '깨졌다', '금이 갔다', '부서졌다', '박살났다', 'broken', 'cracked', 'shattered', 'kaputt', 'zerbrochen', 'cassé', 'roto', 'rotto', '割れた', '壊れた' 등의 표현이 있는 경우가 해당됨. 또한 '쉽게 깨진다', '금방 깨졌다', 'breaks very quickly', 'geht super schnell kaputt', 'se rompe muy rápido' 등 파손이 쉽게 또는 빠르게 발생한다고 언급하는 경우도 포함함. [중요] 깨짐이나 파손을 시사하는 표현이 있으면 '제품품질불만(사이즈,디자인 외)'이 아니라 반드시 본 항목으로 분류할 것."
  },

  /*======================================================
   * 4) 기존 정의 유지 + 단서 조항만 추가
   *====================================================*/
  {
    cat: CASE, label: '무게불만', op: 'append',
    text: " [중요] '가볍다', '가벼워서 좋다', '가벼운 만큼' 등 무게가 가볍다는 언급은 본 항목에 해당하지 않음. '무겁다', '무게가 부담된다', 'heavy' 등 무게가 과하다는 표현이 명시된 경우에만 선택할 것."
  },
  {
    cat: CASE, label: '패키지불만', op: 'append',
    text: " [중요] 배송 박스 파손, 완충 부족, 비닐 포장 배송, 개봉된 상태로 도착 등 배송 과정의 포장 상태에 대한 불만이나 '포장이 아쉽다' 수준의 막연한 표현은 본 항목이 아니라 '배송상태불만'으로 분류할 것. 제품 패키지의 외관·인쇄 정보·구성·실링 방식 등 패키지 자체를 특정해 언급한 경우에만 본 항목으로 분류함."
  },
  {
    cat: CASE, label: '디자인', op: 'append',
    text: " 또한 케이스가 화면이나 디스플레이 일부를 가려 사용이 불편하다고 언급하는 경우, 마감 완성도나 전반적인 만듦새가 아쉽다고 주관적으로 표현하는 경우도 본 항목에 포함함. [중요] 불만의 핵심이 색상인 경우는 '색상'으로, 재질이나 촉감인 경우는 '재질'로 분류할 것."
  },
  {
    cat: CASE, label: '자석들뜸', op: 'append',
    text: " [중요] 자석 또는 마그넷 부품이 밀려 올라왔거나 이탈했다는 점을 명시적으로 언급한 경우에만 선택할 것. '마감이 아쉽다', '살짝 볼록해 보인다', '완성도가 떨어진다' 등 마감 완성도에 대한 주관적 인상만 표현한 경우는 본 항목이 아니라 '디자인'으로 분류할 것."
  },
  {
    cat: FILM, label: '제품품질불만(사이즈,디자인 외)', op: 'append',
    text: " [중요] 깨짐·파손('broken', 'kaputt', 'cassé', '쉽게 깨진다' 등), 스크래치, 들뜸, 기포, 먼지 유입, 부착 실패 등 구체적인 증상을 시사하는 표현이 하나라도 있으면 본 항목이 아니라 해당 증상에 맞는 인입사유로 분류할 것."
  },
  {
    cat: FILM, label: '부착어려움', op: 'append',
    text: " [중요] 리뷰의 핵심 불만이 '부착에 실패했다', '붙이지 못했다', '여러 장을 버렸다', '두 장 다 날렸다', '설치가 불가능했다'인 경우에는, 그 원인으로 가이드 프레임이나 컷아웃 크기 등이 함께 언급되어 있더라도 '프레임형합'이나 '컷아웃'이 아니라 반드시 본 항목으로 분류할 것."
  },
  {
    cat: FILM, label: '프레임형합', op: 'append',
    text: " [중요] 가이드 프레임 자체의 규격이나 형합 불량을 지적하는 것이 핵심인 경우에만 본 항목으로 분류함. 부착에 실패했거나 제품을 버리게 되었다는 점이 핵심 불만인 경우는 '부착어려움'으로 분류할 것."
  },
  {
    cat: FILM, label: '컷아웃', op: 'append',
    text: " [중요] 컷아웃의 크기나 위치 문제로 인해 부착 자체가 불가능했거나 실패했다고 언급한 경우는 본 항목이 아니라 '부착어려움'으로 분류할 것."
  }
];

/** 마스터에 없어서 새로 추가해야 하는 행 (미러에는 이미 존재) */
const ROWS_TO_ADD = [
  { cat: FILM, label: '긍정 리뷰', after: '패키지불만' }
];


/**********************************************************
 * MAIN
 **********************************************************/
function patchDefectDefinitions() {
  const report = [];

  const master = SpreadsheetApp.openById(MASTER_SS_ID)
    .getSheetByName(MASTER_SHEET_NAME);
  if (!master) throw new Error('마스터 시트를 찾을 수 없음: ' + MASTER_SHEET_NAME);

  report.push('=== 1) 마스터: ' + MASTER_SHEET_NAME + ' ===');
  _addMissingRows_(master, report);
  report.push(_applyPatch_(master, '마스터').join('\n'));

  const mirror = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(MIRROR_SHEET_NAME);
  if (mirror) {
    report.push('\n=== 2) 미러: ' + MIRROR_SHEET_NAME +
                ' (' + SpreadsheetApp.getActiveSpreadsheet().getName() + ') ===');
    report.push(_applyPatch_(mirror, '미러').join('\n'));
  } else {
    report.push('\n[경고] 현재 스프레드시트에 "' + MIRROR_SHEET_NAME +
                '" 시트가 없어 미러 패치를 건너뜀. DR()은 이 시트를 읽으므로 반드시 확인할 것.');
  }

  const out = report.join('\n');
  Logger.log(out);
  return out;
}


/**********************************************************
 * 정의(C열) 패치 적용
 **********************************************************/
function _applyPatch_(sheet, tag) {
  const log = [];
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(1, 1, lastRow, 3).getValues();

  let changed = 0, skipped = 0, missing = 0;

  DEFS_PATCH.forEach(function (p) {
    let rowIdx = -1;

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === p.cat &&
          String(values[i][1]).trim() === p.label) {
        rowIdx = i;
        break;
      }
    }

    if (rowIdx === -1) {
      log.push('  [없음] ' + p.cat + ' / ' + p.label);
      missing++;
      return;
    }

    const current = String(values[rowIdx][2] || '');
    let next;

    if (p.op === 'append') {
      // 이미 붙어 있으면 건너뜀 (중복 실행 방지)
      if (current.indexOf(p.text.trim()) !== -1) {
        skipped++;
        return;
      }
      next = current.replace(/\s+$/, '') + p.text;
    } else {
      next = p.text;
    }

    if (next === current) { skipped++; return; }

    sheet.getRange(rowIdx + 1, 3).setValue(next);
    log.push('  [' + p.op + '] ' + p.cat + ' / ' + p.label +
             '  (' + current.length + '자 → ' + next.length + '자)');
    changed++;
  });

  log.push('  -- ' + tag + ' 결과: 변경 ' + changed +
           ' / 유지 ' + skipped + ' / 미발견 ' + missing);
  return log;
}


/**********************************************************
 * 마스터에 누락된 인입사유 행 추가
 **********************************************************/
function _addMissingRows_(sheet, report) {
  ROWS_TO_ADD.forEach(function (r) {
    const lastRow = sheet.getLastRow();
    const values = sheet.getRange(1, 1, lastRow, 2).getValues();

    const exists = values.some(function (row, i) {
      return i > 0 &&
             String(row[0]).trim() === r.cat &&
             String(row[1]).trim() === r.label;
    });

    if (exists) {
      report.push('  [유지] ' + r.cat + ' / ' + r.label + ' 행 이미 존재');
      return;
    }

    // 같은 카테고리의 기준 라벨 바로 뒤에 삽입
    let anchor = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === r.cat &&
          String(values[i][1]).trim() === r.after) {
        anchor = i + 1;
        break;
      }
    }
    if (anchor === -1) {
      // 기준 라벨이 없으면 해당 카테고리 마지막 행 뒤
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]).trim() === r.cat) anchor = i + 1;
      }
    }
    if (anchor === -1) {
      report.push('  [실패] ' + r.cat + ' / ' + r.label + ' 삽입 위치를 찾지 못함');
      return;
    }

    sheet.insertRowAfter(anchor);
    sheet.getRange(anchor + 1, 1, 1, 3)
         .setValues([[r.cat, r.label, '']]);

    report.push('  [추가] ' + r.cat + ' / ' + r.label +
                ' → ' + (anchor + 1) + '행에 삽입 (정의는 이어서 패치됨)');
  });
}


/**********************************************************
 * 패치 전 현재 상태 점검 (읽기 전용)
 **********************************************************/
function auditDefectDefinitions() {
  const out = [];

  [['마스터', SpreadsheetApp.openById(MASTER_SS_ID).getSheetByName(MASTER_SHEET_NAME)],
   ['미러', SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIRROR_SHEET_NAME)]
  ].forEach(function (pair) {
    const tag = pair[0], sh = pair[1];
    if (!sh) { out.push(tag + ': 시트 없음'); return; }

    const v = sh.getRange(1, 1, sh.getLastRow(), 3).getValues();
    const byCat = {};
    const empties = [];
    const seen = {};
    const dups = [];

    for (let i = 1; i < v.length; i++) {
      const c = String(v[i][0]).trim(), l = String(v[i][1]).trim();
      if (!c || !l) continue;
      byCat[c] = (byCat[c] || 0) + 1;
      if (!String(v[i][2] || '').trim()) empties.push(c + ' / ' + l + ' (' + (i + 1) + '행)');
      const k = c + '||' + l;
      if (seen[k]) dups.push(k + ' → ' + seen[k] + '행, ' + (i + 1) + '행');
      else seen[k] = i + 1;
    }

    out.push('=== ' + tag + ' ===');
    out.push('  카테고리별 행 수: ' + JSON.stringify(byCat));
    out.push('  정의 비어 있는 항목 ' + empties.length + '건:');
    empties.forEach(function (e) { out.push('    - ' + e); });
    out.push('  중복 라벨 ' + dups.length + '건:');
    dups.forEach(function (d) { out.push('    - ' + d); });
  });

  const s = out.join('\n');
  Logger.log(s);
  return s;
}

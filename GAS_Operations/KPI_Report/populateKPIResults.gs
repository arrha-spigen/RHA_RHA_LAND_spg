function populateKPIResults() {
  var SHEET_ID = "15Jh6ZFDBIbpv4OANVtD3g4wFBJxoof9SHWDUEU3GiXI";
  var SHEET_NAME = "'26 상_김지우";

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    Logger.log("❌ 시트를 찾을 수 없음: " + SHEET_NAME);
    return;
  }

  var startRow = 4; // 3행은 헤더, 데이터는 4행부터

  // KPI 결과값 — C열 순서에 맞춰 작성
  var kpiValues = [
    // KPI 1 — 아마존 리뷰 평점 개선 (비중 20%)
    "시스템 완전 구축·운영 중 | 8개국 × 8제품군 = 64개 Product-Country 매일 09:00 KST 자동 수집 | Gemini DR() AI 키워드 자동 분류 (에이전트 수동 분류 제거) | 월 39 인시 절감 = ₩402,480/월 | GitHub: github.com/codingintheusa0402/spigen-gcx-automation/tree/main/MasterTrigger | GAS Script ID: 1AWrX0Xl8feD",

    // KPI 2 — 제품 이슈 공론화 SIREN (비중 30%)
    "20건 달성 (전년 18건 대비 +11%) | SIREN 공론화 인프라 신규 구축 · 팀+에이전트 전원 실사용 | TicketDailyReport GAS: Zendesk → Google Chat 일일 자동 전송 | TCK 리포트 97% 단축 (3분→10초) | T2 에스컬레이션 실시간 Chat 알림 구축 | GAS Script ID: TicketDailyReport=1GNowLPF82wfWIrHc1Q9xIDr_L0Kz5iv | GitHub: /TCTChatLog_GCX",

    // KPI 3 — 고객경험·영업이익 개선 MCF (비중 30%)
    "1,200건 처리 달성 | MCF Autofill: 3분→10초/건 (94%↓) · 에이전트 전원 설치 | GCX Reply: 주문조회 2.5분→3초 (98%↓) · v2.8.4 전 에이전트 배포 | =AMZTK() / =MCFFee() 추적·수수료 완전 자동화 | 월 115 인시 절감 = ₩1,185,883/월, 연 ₩14,230,596 | GitHub: github.com/codingintheusa0402/spigen-gcx-automation | GAS: 1kDfEUVEEJ7TCA3HOMF6EYFTjbeZZKIeg_X84wCbLT1",

    // KPI 4 — CX 만족도 + 업무 자동화 (비중 20%)
    "자동화 15건 완료 (목표 10건 대비 150% → 상한 120% 적용, SS등급) | 플랫폼 비용 ₩287,000/월 절감 (SaaS 대비 자체 구축) | GitHub 340+ 커밋 (Apr 15–Jun 16, 2개월) | Tampermonkey 4개 스크립트 전 에이전트 배포 | 헬프센터 4개 페이지 × 5개 언어 Dynamic Content 적용 | GitHub: github.com/codingintheusa0402/spigen-gcx-automation"
  ];

  for (var j = 0; j < kpiValues.length; j++) {
    var cell = sheet.getRange("L" + (startRow + j));
    cell.setValue(kpiValues[j]);
    cell.setWrap(true);
    cell.setVerticalAlignment("top");
  }

  SpreadsheetApp.flush();
  Logger.log("✅ KPI 결과값 작성 완료: L" + startRow + ":L" + (startRow + kpiValues.length - 1));
}

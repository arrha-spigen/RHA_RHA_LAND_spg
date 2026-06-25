/***** ===== CONFIG (iPhone 17e) ===== *****/

/* ===== SHEET ===== */
const UPLOAD_SHEET_ID   = '16xRJHH7Ynii4erNOn_905ST4CZs6OLpOYTof4uqsGsQ';
const UPLOAD_SHEET_NAME = '1-3점';

// "Update 날짜" column index (1-based) in the sheet
const DATE_COL_INDEX_1BASED = 15;


/* ===== MONDAY BOARD ===== */
const BOARD_ID       = 18419272697;   // 📌iPhone 17e Case+CP
const MONDAY_API_URL = 'https://api.monday.com/v2';


/* ===== BOARD COLUMN IDS (iPhone 17e) ===== */
const LINK_COLUMN_ID         = 'link_mm4nf4xm';   // Review Link
const IMAGE_URL_COLUMN_ID    = 'link_mm4net34';   // Image URL
const CLAIM_REVIEW_COLUMN_ID = 'color_mm4n7w5z';  // 클레임/리뷰
const COUNTRY_COLUMN_ID      = 'color_mm4nzbgs';  // 국가(tag)
const PHOTO_COLUMN_ID        = 'color_mm4n1zdk';  // 사진 유무
const CHANNEL_COLUMN_ID      = 'color_mm4n838n';  // 채널

// Text columns
const COL_CREATED_DATE    = 'date_mm4ng1qa';   // Created 날짜
const COL_UPDATE_DATE     = 'date_mm4ns2my';   // Update 날짜
const COL_AUTO_TRANSLATE  = 'text_mm4nwnf1';   // 자동번역
const COL_ASIN            = 'text_mm4ns023';   // ASIN
const COL_RATING          = 'text_mm4n95ah';   // Review Ratings
const COL_REVIEWER        = 'text_mm4na2q5';   // Reviewer
const COL_BODY            = 'text_mm4nm1sg';   // 본문
const COL_REASON_TAG      = 'text_mm4nwg35';   // 인입사유(tag)
const COL_KEYWORD         = 'text_mm4nacv5';   // 키워드 (AI 요약)
const COL_REASON_AI       = 'text_mm4nad0h';   // 인입사유(AI)
const COL_REVIEW_ID       = 'text_mm4n2qq7';   // Review ID
const COL_SKU             = 'text_mm4nxaqv';   // SKU
const COL_MODEL_NAME      = 'text_mm4nzs27';   // 기종명
const COL_PRODUCT_MODEL   = 'text_mm4nczky';   // 모델명
const COL_CATEGORY        = 'text_mm4n6e6m';   // 대분류
const COL_MANUFACTURER    = 'text_mm4nsb8v';   // 생산업체
const COL_ORIGIN          = 'text_mm4n65g';    // 원산지


/* ===== SHEET HEADER NAMES ===== */
const ITEM_NAME_HEADER   = 'Review Title';
const BODY_HEADER_TITLE  = '본문';


/* ===== BEHAVIOR ===== */
const DRY_RUN = false;
const DEFAULT_CLAIM_REVIEW_LABEL = 'Review';

const AUTO_TRANSLATE_BOARD_TITLE = '자동번역';
const AUTO_TRANSLATE_TARGET      = 'ko';


/* ===== COLUMN OVERRIDES (sheet header → board column ID) ===== */
const COLUMN_OVERRIDES_BY_TITLE = {
  'Review Link':       LINK_COLUMN_ID,
  'Image URL':         IMAGE_URL_COLUMN_ID,
  'ASIN':              COL_ASIN,
  'Review Ratings':    COL_RATING,
  'Reviewer':          COL_REVIEWER,
  '본문':              COL_BODY,
  '인입사유':          COL_REASON_TAG,
  '키워드 (AI 요약)':  COL_KEYWORD,
  '인입사유(AI)':      COL_REASON_AI,
  'Review ID':         COL_REVIEW_ID,
  'SKU':               COL_SKU,
  '기종명':            COL_MODEL_NAME,
  '모델명':            COL_PRODUCT_MODEL,
  '대분류':            COL_CATEGORY,
  '생산업체':          COL_MANUFACTURER,
  '원산지':            COL_ORIGIN,
  'Created 날짜':      COL_CREATED_DATE,
  'Update 날짜':       COL_UPDATE_DATE,
  '사진 유무':         PHOTO_COLUMN_ID,
  '국가':              COUNTRY_COLUMN_ID,
};


function getSpreadsheetId_() {
  return SpreadsheetApp.getActive().getId();
}

const PREFERRED_HEADERS = [
  'country', 'date', 'variantAsin', 'productAsin', 'productOriginalAsin',
  'Reviewer', 'ratingScore', 'Review Title', '본문', 'Review ID',
  'reviewImages/0','reviewImages/1','reviewImages/2','reviewImages/3',
  'Review Link', 'totalCategoryRatings', 'totalCategoryReviews',
  'filterByRating', 'variantAttributes', 'averageCustomerReviews',
];

/* ===== GROUP MAPPING ===== */
const MODEL_HEADER_CANDIDATES = ['기종명', '모델명', 'Model', 'Model Name'];

const GROUP_TITLES = ['iPhone 17e'];   // single group — all items are iPhone 17e


/* ===== SAFETY ===== */
const MONDAY_PAGE_LIMIT      = 500;
const MAX_EXISTING_LINKS_SCAN = 2000;

const RETRY_MAX     = 3;
const RETRY_BASE_MS = 300;


/***** ===== ENV ===== */
function _prop(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v == null || v === '') ? fallback : v;
}

const CONFIG = {
  pollIntervalMinutes: 1,
  pollMaxMinutes:      180,
  timezone:            'Asia/Seoul'
};

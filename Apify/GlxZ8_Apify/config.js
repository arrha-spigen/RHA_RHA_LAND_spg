/***** ===== CONFIG (Galaxy Z8 Series) ===== *****/

/* ===== SHEET ===== */
const UPLOAD_SHEET_ID = '19OhswglYMx_dxSFFDtWI1WYPWq2jONJn6RK84KITwy4';
const UPLOAD_SHEET_NAME = '1-3점';

// "Update 날짜" index
const DATE_COL_INDEX_1BASED = 15;


/* ===== MONDAY BOARD ===== */
const BOARD_ID = 18421346787;   // 📌Galaxy Z8 Case+CP
const MONDAY_API_URL = 'https://api.monday.com/v2';


/* ===== BOARD COLUMN IDS (Galaxy Z8 — duplicated from S26 board, IDs unchanged) ===== */

const LINK_COLUMN_ID = 'link_mm0fkspz';
const CLAIM_REVIEW_COLUMN_ID = 'color_mm0f7bwq';
const COUNTRY_COLUMN_ID = 'color_mm0fcch4';
const PHOTO_COLUMN_ID = 'color_mm0ffgz8';
const CHANNEL_COLUMN_ID = 'color_mm0ft7a5';

// Board has an active "when item created, set Created/Update 날짜 to today"
// automation that overwrites these two columns right after create_item runs.
// We re-apply the sheet's real values in a follow-up call — see
// reapplyDateColumns() in UI.js.
const DATE_CREATED_COLUMN_ID = 'date_mm0f80th'; // "Created 날짜"
const DATE_UPDATE_COLUMN_ID = 'date_mm0fyd4a';  // "Update 날짜"
const DATE_FIX_DELAY_MS = 3000; // grace period before the re-apply pass, so it lands after the automation fires


/* ===== SHEET HEADER NAMES ===== */
const ITEM_NAME_HEADER = 'Review Title';
const BODY_HEADER_TITLE = '본문';


/* ===== BEHAVIOR ===== */

const DRY_RUN = false;
const DEFAULT_CLAIM_REVIEW_LABEL = '리뷰';

const AUTO_TRANSLATE_BOARD_TITLE = '자동번역';
const AUTO_TRANSLATE_TARGET = 'ko';


/* ===== COLUMN OVERRIDES ===== */
const COLUMN_OVERRIDES_BY_TITLE = {
  'Review Link': LINK_COLUMN_ID
};


function getSpreadsheetId_() {
  return SpreadsheetApp.getActive().getId();
}

const PREFERRED_HEADERS = [
  'country',
  'date',
  'variantAsin',
  'productAsin',
  'productOriginalAsin',
  'Reviewer',
  'ratingScore',
  'Review Title',
  '본문',
  'Review ID',
  'reviewImages/0',
  'reviewImages/1',
  'reviewImages/2',
  'reviewImages/3',
  'reviewImages/4',
  'reviewImages/5',
  'reviewImages/6',
  'reviewImages/7',
  'reviewImages/8',
  'reviewImages/9',
  'reviewImages/10',
  'Review Link',
  'product/productPageReviews/0/variant',
  'totalCategoryRatings',
  'totalCategoryReviews',
  'filterByRating',
  'variantAttributes',
  'averageCustomerReviews',
];

/* ===== GROUP MAPPING ===== */
const MODEL_HEADER_CANDIDATES = ['기종명', '모델명', 'Model', 'Model Name'];

const GROUP_TITLES = [
  'Galaxy Z Fold 8',
  'Galaxy Z Flip 8',
  'Galaxy Z Fold 8 Ultra'
];


/* ===== SAFETY ===== */
const MONDAY_PAGE_LIMIT = 500;
const MAX_EXISTING_LINKS_SCAN = 2000;

const RETRY_MAX = 3;
const RETRY_BASE_MS = 300;


/***** ===== ENV ===== */
function _prop(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v == null || v === '') ? fallback : v;
}

const CONFIG = {
  pollIntervalMinutes: 1,
  pollMaxMinutes: 180,
  timezone: 'Asia/Seoul'
};

/**
 * qradar_evaluation_cases_flat 컬럼 식.
 * 구 테이블의 case_content JSON_VALUE 를 대체한다. (BQ 클라이언트 없음 — 문자열만)
 */

export const CASES_CID = "genesys_conversation_id";
export const CASES_PHONE_INQUIRY_ID = "phone_inquiry_id";
export const CASES_PHONE_INQUIRY_ID_STR = "cast(phone_inquiry_id as string)";
export const CASES_ADMIN_ID_STR = "cast(admin_user_id as string)";
export const CASES_ADMIN_NAME = "admin_name";
export const CASES_TEAM = "team";
export const CASES_CATEGORY = "category";
export const CASES_CONTENT = "content";
export const CASES_CALL_DATE_KST = "call_date_kst";
export const CASES_CALL_DATE_KST_STR = "format_date('%F', call_date_kst)";
export const CASES_CALL_START_KST_STR = "format_datetime('%F %T', call_start_kst)";
export const CASES_DURATION_SEC = "duration_sec";
export const CASES_MINUTES = "minutes_taken";

/** year_month 하한과 파티션(inquiry_created_at_kst) prune 을 같이 건다. */
export const CASES_SINCE = "year_month >= '2026-04-01' and inquiry_created_at_kst >= '2026-04-01'";

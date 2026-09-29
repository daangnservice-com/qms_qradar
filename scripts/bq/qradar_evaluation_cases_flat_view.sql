-- qradar_evaluation_cases_flat — 평가 진행 샘플 풀 (원천 직조회 뷰, 현재 운영본)
--
-- 구조: phone_inquiries_verbose → 한글 별칭 → TO_JSON_STRING(STRUCT) → case_content STRING.
--       앱이 목록마다 JSON_VALUE 로 다시 깠다. 동적 스키마용 우회가 조회 병목이 됨.
-- 지금: 필터·목록에 쓰는 필드를 컬럼으로 노출한다. 앱은 JSON 을 파싱하지 않는다.
--
-- 당일 콜까지 바로 보여야 해서 적재 테이블이 아니라 뷰다. 원천
-- phone_inquiries_verbose 도 뷰라 파티션 프루닝이 안 걸리고, 그만큼 목록 조회가
-- 느리다. 신선도를 포기할 수 있게 되면 qradar_evaluation_cases_flat_table.sql 의
-- 일 1회 MERGE 테이블로 바꾼다 (앱 SQL 은 그대로 동작한다).
--
-- 앱 기본 원천: BQ_TARGET=dev → ds_qradar_dev. prod 는 데이터셋만 ds_qradar_prod.

-- 이름 끝에 공백이 붙은 채로 만들어진 기존 뷰. 백틱 안의 공백까지 그대로 써야 지워진다.
DROP VIEW IF EXISTS `data-proj-470202.ds_qradar_dev.qradar_evaluation_cases_flat `;

CREATE OR REPLACE VIEW `data-proj-470202.ds_qradar_dev.qradar_evaluation_cases_flat`
OPTIONS (
  description = "평가 진행 샘플 풀. phone_inquiries_verbose 직조회(당일 콜 포함). JSON case_content 없음."
)
AS
SELECT
  pi.id AS phone_inquiry_id,
  pi.tck_call_gc_id AS genesys_conversation_id,
  pi.admin_user_id,
  pi.first_name AS admin_name,
  pi.renewal_team_name AS team,
  IFNULL(
    pi.category_display_category_full_name,
    CONCAT(pi.tck_call_advisortype_nm_full, " (TCRM)")
  ) AS category,
  pi.content,
  SAFE_CAST(pi.call_start AS TIMESTAMP) AS call_start,
  SAFE_CAST(pi.call_end AS TIMESTAMP) AS call_end,

  -- 아래 4개가 앱 필터·정렬·고위험군 판정에 직접 쓰인다. lib/evaluationCasesSql.ts 참고.
  SAFE_CAST(pi.minutes_taken AS FLOAT64) AS minutes_taken,
  -- call_end - call_start 가 우선. 결측이면 minutes_taken 으로 대체한다.
  COALESCE(
    NULLIF(
      GREATEST(
        TIMESTAMP_DIFF(
          SAFE_CAST(pi.call_end AS TIMESTAMP),
          SAFE_CAST(pi.call_start AS TIMESTAMP),
          SECOND
        ),
        0
      ),
      0
    ),
    IF(
      SAFE_CAST(pi.minutes_taken AS FLOAT64) > 0,
      CAST(ROUND(SAFE_CAST(pi.minutes_taken AS FLOAT64) * 60) AS INT64),
      NULL
    )
  ) AS duration_sec,
  DATE(SAFE_CAST(pi.call_start AS TIMESTAMP), "Asia/Seoul") AS call_date_kst,
  DATETIME(SAFE_CAST(pi.call_start AS TIMESTAMP), "Asia/Seoul") AS call_start_kst,

  -- 원천에 이미 KST DATETIME 이 있다. 변환식을 씌우면 하위 스캔으로 조건이 안 내려간다.
  pi.created_at_kst AS inquiry_created_at_kst,
  DATE(DATE_TRUNC(pi.created_at_kst, MONTH)) AS year_month
FROM `karrotmarket.team_operation.phone_inquiries_verbose` AS pi
WHERE pi.admin_user_id IS NOT NULL
  AND pi.tck_call_gc_id IS NOT NULL;

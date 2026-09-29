-- qradar_evaluation_cases_flat — 적재 테이블 버전 (일 1회 MERGE)
--
-- 현재 운영본은 qradar_evaluation_cases_flat_view.sql (원천 직조회 뷰)다.
-- 당일 콜 신선도를 포기해도 될 때 이 스크립트로 갈아끼운다. 컬럼 이름·타입이
-- 뷰와 같으므로 앱 SQL(lib/evaluationCasesSql.ts)은 그대로 둔다.
--
-- 뷰 대비 이점: inquiry_created_at_kst 파티션 프루닝 + conversation_id/team 클러스터.
-- 원천 phone_inquiries_verbose 가 뷰라 직조회로는 둘 다 못 쓴다.
--
-- 갈아끼울 때: 아래 CREATE TABLE 전에 뷰를 먼저 DROP 해야 이름이 겹치지 않는다.
--   DROP VIEW IF EXISTS `data-proj-470202.ds_qradar_dev.qradar_evaluation_cases_flat`;
--
-- prod 스케줄은 데이터셋만 ds_qradar_prod 로 바꾼다.

CREATE TABLE IF NOT EXISTS `data-proj-470202.ds_qradar_dev.qradar_evaluation_cases_flat` (
  phone_inquiry_id          INT64     NOT NULL,
  genesys_conversation_id   STRING    NOT NULL,
  admin_user_id             INT64,
  admin_name                STRING,
  team                      STRING,
  category                  STRING,
  content                   STRING,
  call_start                TIMESTAMP,
  call_end                  TIMESTAMP,
  minutes_taken             FLOAT64,
  duration_sec              INT64,
  call_date_kst             DATE,
  call_start_kst            DATETIME,
  inquiry_created_at_kst    DATETIME  NOT NULL,
  year_month                DATE,
  ingested_at               TIMESTAMP
)
PARTITION BY DATE(inquiry_created_at_kst)
CLUSTER BY genesys_conversation_id, team, admin_user_id
OPTIONS (
  description = "평가 진행 샘플 풀. phone_inquiries_verbose 일 1회 MERGE. JSON case_content 없음."
);

-- ── 일 배치 (권장: 매일 09:00 KST, 최근 3일 재처리) ─────────────────────────
-- 전체 백필 때는 WHERE 의 lookback 을 주석 처리.

MERGE `data-proj-470202.ds_qradar_dev.qradar_evaluation_cases_flat` AS t
USING (
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
    SAFE_CAST(pi.minutes_taken AS FLOAT64) AS minutes_taken,
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
    pi.created_at_kst AS inquiry_created_at_kst,
    DATE(DATE_TRUNC(pi.created_at_kst, MONTH)) AS year_month,
    CURRENT_TIMESTAMP() AS ingested_at
  FROM `karrotmarket.team_operation.phone_inquiries_verbose` AS pi
  WHERE pi.admin_user_id IS NOT NULL
    AND pi.tck_call_gc_id IS NOT NULL
    AND pi.created_at_kst >= DATETIME(DATE_SUB(CURRENT_DATE("Asia/Seoul"), INTERVAL 3 DAY))
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY pi.id
    ORDER BY pi.created_at DESC
  ) = 1
) AS s
ON t.phone_inquiry_id = s.phone_inquiry_id
WHEN MATCHED THEN UPDATE SET
  genesys_conversation_id = s.genesys_conversation_id,
  admin_user_id           = s.admin_user_id,
  admin_name              = s.admin_name,
  team                    = s.team,
  category                = s.category,
  content                 = s.content,
  call_start              = s.call_start,
  call_end                = s.call_end,
  minutes_taken           = s.minutes_taken,
  duration_sec            = s.duration_sec,
  call_date_kst           = s.call_date_kst,
  call_start_kst          = s.call_start_kst,
  inquiry_created_at_kst  = s.inquiry_created_at_kst,
  year_month              = s.year_month,
  ingested_at             = s.ingested_at
WHEN NOT MATCHED THEN INSERT (
  phone_inquiry_id,
  genesys_conversation_id,
  admin_user_id,
  admin_name,
  team,
  category,
  content,
  call_start,
  call_end,
  minutes_taken,
  duration_sec,
  call_date_kst,
  call_start_kst,
  inquiry_created_at_kst,
  year_month,
  ingested_at
) VALUES (
  s.phone_inquiry_id,
  s.genesys_conversation_id,
  s.admin_user_id,
  s.admin_name,
  s.team,
  s.category,
  s.content,
  s.call_start,
  s.call_end,
  s.minutes_taken,
  s.duration_sec,
  s.call_date_kst,
  s.call_start_kst,
  s.inquiry_created_at_kst,
  s.year_month,
  s.ingested_at
);

-- feedback_thread_aggregation — 인앱 문의 스레드 집계 테이블 (일 1회 MERGE)
--
-- 원천 뷰 `karrotmarket.team_operation.vw_feedback_thread_aggregation` 은
-- 2025-01-01 이후 feedbacks + 전체 feedback_replies + CSAT 를 매번 집계한다.
-- 앱이 이 뷰를 목록마다 치면 쿼리 비용이 반복된다. 이 테이블은 뷰와 같은 43컬럼을
-- 갖고, 최근 N일 동안 변동된 스레드만 다시 집계해 upsert 한다.
--
-- 원천 뷰 DDL 은 2026-09-18 INFORMATION_SCHEMA.VIEWS 에서 확인.
-- 뷰 로직이 바뀌면 아래 USING 절을 같이 고쳐야 contents_concat 파서가 깨지지 않는다.
-- 바깥에서 뷰를 SELECT … WHERE 하면 GROUP BY 때문에 날짜 프루닝이 안 걸린다.
--
-- ── 스캔량 (2026-09-18 dry run) ──────────────────────────────────
--   뷰 전체 SELECT            6.87 GB
--   이 배치(lookback 3~7일)   6.94 GB
-- 줄지 않는다. 원천 feedbacks / feedback_replies / feedback_threads 가 전부
-- 비파티션·비클러스터라 WHERE 로 행을 걸러도 컬럼은 통째로 스캔된다.
-- 즉 이 배치의 이득은 "스캔이 싸진다"가 아니라 "하루 1회만 스캔한다"이다.
-- (앱이 목록/필터마다 뷰를 치면 조회 1회당 6.87 GB. 배치 후엔 파티션+클러스터된
--  이 테이블만 읽는다.) lookback 은 슬롯 시간과 재기록 행수를 줄이고,
-- 나중에 원천이 파티셔닝되면 그때 스캔량까지 같이 줄어든다.
--
-- ── 뷰 대조 (2026-09-18, lookback 7일 = 스레드 48,147건) ─────────
--   contents_concat / thread_last_event_at_kst / n_feedback_rows /
--   n_reply_rows / admin_agg / status / csat_id / human_cnt /
--   feedback_start_timestamp : 전부 0건 불일치
--   any_admin_id 2,619건 / feedback_renewal_team 76건 / category 일부는
--     "값이 다른 게 아니라 뷰의 ANY_VALUE 가 매번 다른 값을 고르는" 케이스다.
--     아래 aggregated_threads 주석 참고 — 여기서는 결정적으로 고정했다.
--     NULL 개수는 네 컬럼 모두 뷰와 완전히 동일하고,
--     앱 FEEDBACK_BASE_WHERE 통과 건수도 4,050건으로 뷰와 같다.
--
-- ── 배치 위치 ───────────────────────────────────────────────────
-- 테이블은 원천 뷰 바로 옆(`karrotmarket.team_operation`)에 둔다. dev/prod 구분
--   없이 하나다 — 원천 뷰가 하나인 것과 같다. 앱은 lib/bqRefs.ts 의 feedbackBq 로 읽는다.
-- 스케줄드 쿼리는 `data-proj-470202` 에서 만든다 (cross-project write).
--   두 데이터셋 모두 US 라 같은 리전에서 돈다 (확인함: team_operation = US).
--   Destination table 설정은 반드시 비운다 — 이 스크립트가 직접 MERGE 한다.
--   매일 00:00 UTC (09:00 KST) / 표시 이름 예: feedback_thread_aggregation_merge
--
-- !! 권한: 스케줄드 쿼리를 도는 주체가 karrotmarket.team_operation 에 쓸 수 있어야 한다.
--    - 사용자 자격증명으로 만들면(콘솔 기본) 만든 사람 계정에 WRITER 가 필요하다.
--      2026-09-18 기준 현재 ADC 계정은 tables.create / tables.updateData 보유 확인.
--    - 서비스 계정으로 돌리려면 그 SA 를 team_operation 에 WRITER 로 추가해야 한다.
--      data-proj-470202 의 전송 서비스 에이전트
--      (service-249579685661@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com) 는
--      현재 team_operation ACL 에 없다.
--
-- 최초 적재 / 전체 백필: lookback_days 를 9999 로 두고 1회 실행.
--   스레드 약 140만건이 한 번에 들어온다. 이후 일 배치는 lookback_days 로 복귀.
-- MERGE 는 원천에서 사라진 스레드를 지우지 않는다. 필요하면 분기 1회
--   lookback_days=9999 로 전체 재적재하거나 테이블을 새로 만든다.

DECLARE lookback_days INT64 DEFAULT 7;
DECLARE lookback_start DATETIME DEFAULT DATETIME(
  DATE_SUB(CURRENT_DATE("Asia/Seoul"), INTERVAL lookback_days DAY)
);
DECLARE source_floor DATETIME DEFAULT DATETIME("2025-01-01");

CREATE TABLE IF NOT EXISTS `karrotmarket.team_operation.feedback_thread_aggregation` (
  feedback_thread_id                    INT64     NOT NULL,
  any_admin_name                        STRING,
  any_admin_id                          INT64,
  feedback_category_path_id             STRING,
  display_full_category_name            STRING,
  internal_feedback_category_path_name  STRING,
  work_group_name                       STRING,
  work_group_name_ko                    STRING,
  work_group_team                       STRING,
  feedback_renewal_team                 STRING,
  thread_first_event_at_kst             DATETIME,
  thread_last_event_at_kst              DATETIME,
  first_feedback_at_kst                 DATETIME,
  last_feedback_at_kst                  DATETIME,
  first_reply_at_kst                    DATETIME,
  last_reply_at_kst                     DATETIME,
  n_feedback_rows                       INT64,
  n_reply_rows                          INT64,
  contents_concat                       STRING,
  feedback_start_timestamp              TIMESTAMP,
  status                                INT64,
  user_selected_category_id             INT64,
  admin_agg                             STRING,
  first_reply_admin_id                  INT64,
  first_reply_admin_name                STRING,
  last_reply_admin_id                   INT64,
  last_reply_admin_name                 STRING,
  admin_cnt                             INT64,
  daangne_cnt                           INT64,
  human_cnt                             INT64,
  csat_id                               STRING,
  csat_created_at_kst                   DATETIME,
  csat_rate                             FLOAT64,
  csat_comment                          STRING,
  csat_choice_correct_answer            INT64,
  csat_choice_quick_answer              INT64,
  csat_choice_kindly                    INT64,
  csat_choice_positive_etc              INT64,
  csat_choice_different_answer          INT64,
  csat_choice_cant_understand           INT64,
  csat_choice_unfriendly                INT64,
  csat_choice_late_reply                INT64,
  csat_choice_negative_etc              INT64,
  feedback_date_kst                     DATE,
  year_month                            DATE,
  ingested_at                           TIMESTAMP
)
PARTITION BY feedback_date_kst
CLUSTER BY feedback_thread_id, feedback_renewal_team, any_admin_id
OPTIONS (
  description = "인앱 문의 스레드 스냅샷. vw_feedback_thread_aggregation 일 1회 MERGE(변동 스레드 upsert)."
);

-- ── 일 배치: 변동 스레드 식별 → 해당 스레드만 원천 뷰와 동일하게 재집계 → MERGE ─

MERGE `karrotmarket.team_operation.feedback_thread_aggregation` AS t
USING (
  WITH
  changed_threads AS (
    SELECT id AS feedback_thread_id
    FROM `karrotmarket.db_karrot_cs_kr.feedback_threads`
    WHERE created_at >= TIMESTAMP(lookback_start, "Asia/Seoul")
      OR updated_at >= TIMESTAMP(lookback_start, "Asia/Seoul")
      OR closed_at >= TIMESTAMP(lookback_start, "Asia/Seoul")

    UNION DISTINCT

    SELECT DISTINCT feedback_thread_id
    FROM `karrotmarket.db_karrot_cs_kr.feedbacks`
    WHERE feedback_thread_id IS NOT NULL
      AND (
        DATETIME(created_at, "Asia/Seoul") >= lookback_start
        OR DATETIME(updated_at, "Asia/Seoul") >= lookback_start
      )

    UNION DISTINCT

    SELECT DISTINCT f.feedback_thread_id
    FROM `karrotmarket.db_karrot_cs_kr.feedback_replies` AS fr
    INNER JOIN `karrotmarket.db_karrot_cs_kr.feedbacks` AS f
      ON f.id = fr.feedback_id
    WHERE f.feedback_thread_id IS NOT NULL
      AND (
        DATETIME(fr.created_at, "Asia/Seoul") >= lookback_start
        OR DATETIME(fr.updated_at, "Asia/Seoul") >= lookback_start
      )

    UNION DISTINCT

    SELECT DISTINCT csat.inquiry_id AS feedback_thread_id
    FROM `karrotmarket.team_operation.vw_feedback_chat_CSAT_rawlog_verbose` AS csat
    WHERE csat.inquiry_type = "FeedbackThread"
      AND csat.inquiry_id IS NOT NULL
      AND csat.created_at_kst >= lookback_start
  ),

  admin_info AS (
    SELECT admin_user_id, ANY_VALUE(first_name) AS first_name
    FROM `karrotmarket.team_operation.vw_admin_user_info`
    GROUP BY admin_user_id
  ),

  ft_base AS (
    SELECT id, status, user_selected_category_id
    FROM `karrotmarket.db_karrot_cs_kr.feedback_threads`
    WHERE id IN (SELECT feedback_thread_id FROM changed_threads)
      AND created_at >= TIMESTAMP(source_floor, "Asia/Seoul")
  ),

  fb_base AS (
    SELECT * EXCEPT (rn)
    FROM (
      SELECT
        fb.id AS feedback_id,
        fb.user_id AS feedback_user_id,
        fb.status AS feedback_status,
        fb.content AS feedback_content,
        fb.admin_memo AS feedback_admin_memo,
        fb.feedback_replies_count,
        fb.processed_at_kst AS feedback_processed_at_kst,
        fb.created_at_kst AS feedback_created_at_kst,
        fb.category_id,
        fb.work_group_name,
        fb.work_group_name_ko,
        fb.work_group_team,
        fb.feedback_parent_category_name AS display_parent_category_name,
        fb.feedback_category_name AS display_category_name,
        fb.feedback_thread_id,
        fb.feedback_category_path_id,
        fb.feedback_category_path_name AS display_full_category_name,
        fb.internal_feedback_category_path_name,
        fb.admin_user_id AS feedback_admin_user_id,
        fb.admin_renewal_team AS feedback_renewal_team,
        fb.admin_first_name AS feedback_admin_name,
        ROW_NUMBER() OVER (PARTITION BY fb.id ORDER BY fb.created_at_kst DESC) AS rn
      FROM `karrotmarket.team_operation.vw_feedback_verbose` AS fb
      WHERE fb.feedback_thread_id IN (SELECT feedback_thread_id FROM changed_threads)
        AND fb.created_at_kst >= source_floor
        AND fb.feedback_thread_id IS NOT NULL
    )
    WHERE rn = 1
  ),

  csat_first AS (
    SELECT * EXCEPT (rn)
    FROM (
      SELECT
        csat.csat_id,
        csat.inquiry_id,
        csat.created_at_kst AS csat_created_at_kst,
        csat.rate AS csat_rate,
        csat.comment AS csat_comment,
        csat.choice_correct_answer,
        csat.choice_quick_answer,
        csat.choice_kindly,
        csat.choice_positive_etc,
        csat.choice_different_answer,
        csat.choice_cant_understand,
        csat.choice_unfriendly,
        csat.choice_late_reply,
        csat.choice_negative_etc,
        ROW_NUMBER() OVER (PARTITION BY csat.inquiry_id ORDER BY csat.created_at_kst DESC) AS rn
      FROM `karrotmarket.team_operation.vw_feedback_chat_CSAT_rawlog_verbose` AS csat
      WHERE csat.inquiry_type = "FeedbackThread"
        AND csat.inquiry_id IN (SELECT feedback_thread_id FROM changed_threads)
    )
    WHERE rn = 1
  ),

  reply_base AS (
    SELECT
      fr.feedback_id,
      fr.admin_user_id AS reply_admin_id,
      fr.content AS reply_content,
      fr.id AS reply_id,
      DATETIME(fr.created_at, "Asia/Seoul") AS reply_created_at_kst,
      aui.first_name AS reply_admin_name
    FROM `karrotmarket.db_karrot_cs_kr.feedback_replies` AS fr
    INNER JOIN fb_base AS fb
      ON fb.feedback_id = fr.feedback_id
    LEFT JOIN admin_info AS aui
      ON fr.admin_user_id = aui.admin_user_id
  ),

  events AS (
    SELECT
      fb.feedback_thread_id,
      fb.feedback_category_path_id,
      fb.display_full_category_name,
      fb.internal_feedback_category_path_name,
      fb.work_group_name,
      fb.work_group_name_ko,
      fb.work_group_team,
      fb.feedback_renewal_team,
      "FEEDBACK" AS row_kind,
      fb.feedback_created_at_kst AS event_at_kst,
      fb.feedback_id,
      CAST(NULL AS INT64) AS reply_admin_id,
      fb.feedback_admin_user_id AS actor_admin_id,
      CAST(NULL AS INT64) AS reply_id,
      fb.feedback_admin_name AS actor_admin_name,
      fb.feedback_user_id,
      fb.feedback_status,
      fb.feedback_processed_at_kst,
      fb.feedback_admin_memo AS memo,
      fb.feedback_content AS content
    FROM fb_base AS fb

    UNION ALL

    SELECT
      fb.feedback_thread_id,
      fb.feedback_category_path_id,
      fb.display_full_category_name,
      fb.internal_feedback_category_path_name,
      fb.work_group_name,
      fb.work_group_name_ko,
      fb.work_group_team,
      fb.feedback_renewal_team,
      "REPLY" AS row_kind,
      rp.reply_created_at_kst AS event_at_kst,
      fb.feedback_id,
      rp.reply_admin_id,
      rp.reply_admin_id AS actor_admin_id,
      rp.reply_id,
      rp.reply_admin_name AS actor_admin_name,
      fb.feedback_user_id,
      fb.feedback_status,
      fb.feedback_processed_at_kst,
      fb.feedback_admin_memo AS memo,
      rp.reply_content AS content
    FROM fb_base AS fb
    INNER JOIN reply_base AS rp
      ON fb.feedback_id = rp.feedback_id
  ),

  admin_ordered AS (
    SELECT
      feedback_thread_id,
      COUNT(DISTINCT actor_admin_id) AS admin_cnt,
      COUNT(CASE WHEN actor_admin_id = 10588 THEN 1 END) AS daangne_cnt,
      COUNT(CASE WHEN actor_admin_id != 10588 THEN 1 END) AS human_cnt,
      STRING_AGG(admin_label, ", " ORDER BY first_reply_at_kst) AS admin_agg,
      ARRAY_AGG(
        STRUCT(actor_admin_id AS admin_id, actor_admin_name AS admin_name)
        ORDER BY first_reply_at_kst ASC
        LIMIT 1
      )[OFFSET(0)].admin_id AS first_reply_admin_id,
      ARRAY_AGG(
        STRUCT(actor_admin_id AS admin_id, actor_admin_name AS admin_name)
        ORDER BY first_reply_at_kst ASC
        LIMIT 1
      )[OFFSET(0)].admin_name AS first_reply_admin_name,
      ARRAY_AGG(
        STRUCT(actor_admin_id AS admin_id, actor_admin_name AS admin_name)
        ORDER BY last_reply_at_kst DESC
        LIMIT 1
      )[OFFSET(0)].admin_id AS last_reply_admin_id,
      ARRAY_AGG(
        STRUCT(actor_admin_id AS admin_id, actor_admin_name AS admin_name)
        ORDER BY last_reply_at_kst DESC
        LIMIT 1
      )[OFFSET(0)].admin_name AS last_reply_admin_name
    FROM (
      SELECT
        feedback_thread_id,
        actor_admin_id,
        ANY_VALUE(actor_admin_name) AS actor_admin_name,
        CONCAT(
          IFNULL(ANY_VALUE(actor_admin_name), "Unknown"),
          "(",
          CAST(actor_admin_id AS STRING),
          ")"
        ) AS admin_label,
        MIN(event_at_kst) AS first_reply_at_kst,
        MAX(event_at_kst) AS last_reply_at_kst
      FROM events
      WHERE row_kind = "REPLY"
        AND actor_admin_id IS NOT NULL
      GROUP BY feedback_thread_id, actor_admin_id
    )
    GROUP BY feedback_thread_id
  ),

  aggregated_threads AS (
    SELECT
      feedback_thread_id,
      -- 원천 뷰는 이 10개 컬럼을 ANY_VALUE 로 뽑는다. 뷰는 조회할 때마다 다시 계산하니
      -- 값이 흔들려도 티가 안 나지만, 적재 테이블은 upsert 한 값이 그대로 남는다.
      -- 한 스레드에 문의가 여러 건이면 담당 어드민·팀·카테고리가 실제로 서로 다르고
      -- (2026-09-18 기준 스레드 1,396,510건 중 admin_user_id 2개 이상 152,899건(11%),
      --  renewal_team 2개 이상 16,239건, category_path 2개 이상 60,847건),
      -- ANY_VALUE 그대로면 재실행마다 스레드가 팀 사이를 오간다.
      -- 앱은 any_admin_id / feedback_renewal_team 로 평가 대상을 거르므로(FEEDBACK_BASE_WHERE)
      -- "가장 최근 이벤트가 이긴다"로 고정한다.
      --   any_admin_*        → 담당자가 붙은 가장 최근 이벤트(문의·답변 공통)
      --   카테고리/팀 계열    → 가장 최근 FEEDBACK(= 현재 분류)
      -- 뷰와 bit 단위로 맞추고 싶으면 아래 두 ARRAY_AGG 를 ANY_VALUE 로 되돌리면 된다.
      ARRAY_AGG(
        IF(
          actor_admin_id IS NULL,
          NULL,
          STRUCT(actor_admin_id AS admin_id, actor_admin_name AS admin_name)
        )
        IGNORE NULLS
        ORDER BY event_at_kst DESC, row_kind DESC, feedback_id DESC, reply_id DESC
        LIMIT 1
      )[SAFE_OFFSET(0)] AS any_admin,
      -- 카테고리·팀 계열은 컬럼마다 따로 뽑는다. 한 STRUCT 로 묶어 "가장 최근 문의"를
      -- 통째로 쓰면, 그 문의의 담당자에게 renewal_team 이 없을 때 앞 문의가 갖고 있던
      -- 팀까지 NULL 로 덮인다(7일 창 기준 572건 확인). ANY_VALUE 도 NULL 은 건너뛰므로
      -- 여기서도 컬럼별 "가장 최근 non-null" 로 맞춘다.
      ARRAY_AGG(IF(row_kind = "FEEDBACK", feedback_category_path_id, NULL)
        IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
      )[SAFE_OFFSET(0)] AS feedback_category_path_id,
      ARRAY_AGG(IF(row_kind = "FEEDBACK", display_full_category_name, NULL)
        IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
      )[SAFE_OFFSET(0)] AS display_full_category_name,
      ARRAY_AGG(IF(row_kind = "FEEDBACK", internal_feedback_category_path_name, NULL)
        IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
      )[SAFE_OFFSET(0)] AS internal_feedback_category_path_name,
      ARRAY_AGG(IF(row_kind = "FEEDBACK", work_group_name, NULL)
        IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
      )[SAFE_OFFSET(0)] AS work_group_name,
      ARRAY_AGG(IF(row_kind = "FEEDBACK", work_group_name_ko, NULL)
        IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
      )[SAFE_OFFSET(0)] AS work_group_name_ko,
      ARRAY_AGG(IF(row_kind = "FEEDBACK", work_group_team, NULL)
        IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
      )[SAFE_OFFSET(0)] AS work_group_team,
      ARRAY_AGG(IF(row_kind = "FEEDBACK", feedback_renewal_team, NULL)
        IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
      )[SAFE_OFFSET(0)] AS feedback_renewal_team,
      MIN(event_at_kst) AS thread_first_event_at_kst,
      MAX(event_at_kst) AS thread_last_event_at_kst,
      MIN(IF(row_kind = "FEEDBACK", event_at_kst, NULL)) AS first_feedback_at_kst,
      MAX(IF(row_kind = "FEEDBACK", event_at_kst, NULL)) AS last_feedback_at_kst,
      MIN(IF(row_kind = "REPLY", event_at_kst, NULL)) AS first_reply_at_kst,
      MAX(IF(row_kind = "REPLY", event_at_kst, NULL)) AS last_reply_at_kst,
      COUNTIF(row_kind = "FEEDBACK") AS n_feedback_rows,
      COUNTIF(row_kind = "REPLY") AS n_reply_rows,
      STRING_AGG(
        CONCAT(
          "[", row_kind, "] ",
          FORMAT_DATETIME("%F %T", event_at_kst),
          IF(
            row_kind = "REPLY",
            CONCAT(" | reply_id=", CAST(reply_id AS STRING)),
            CONCAT(" | feedback_id=", CAST(feedback_id AS STRING))
          ),
          IF(
            row_kind = "REPLY",
            CONCAT(
              " | reply_admin_id=",
              CAST(reply_admin_id AS STRING),
              "(",
              IFNULL(actor_admin_name, ""),
              ")"
            ),
            CONCAT(" | feedback_user_id=", CAST(feedback_user_id AS STRING))
          ),
          "\n",
          content
        ),
        "\n\n-----\n\n"
        ORDER BY event_at_kst, row_kind, feedback_id
      ) AS contents_concat,
      TIMESTAMP(MIN(event_at_kst), "Asia/Seoul") AS feedback_start_timestamp
    FROM events
    GROUP BY feedback_thread_id
  )

  SELECT
    agg.feedback_thread_id,
    agg.any_admin.admin_name AS any_admin_name,
    agg.any_admin.admin_id AS any_admin_id,
    agg.feedback_category_path_id,
    agg.display_full_category_name,
    agg.internal_feedback_category_path_name,
    agg.work_group_name,
    agg.work_group_name_ko,
    agg.work_group_team,
    agg.feedback_renewal_team,
    agg.thread_first_event_at_kst,
    agg.thread_last_event_at_kst,
    agg.first_feedback_at_kst,
    agg.last_feedback_at_kst,
    agg.first_reply_at_kst,
    agg.last_reply_at_kst,
    agg.n_feedback_rows,
    agg.n_reply_rows,
    agg.contents_concat,
    agg.feedback_start_timestamp,
    ft.status,
    ft.user_selected_category_id,
    ao.admin_agg,
    ao.first_reply_admin_id,
    ao.first_reply_admin_name,
    ao.last_reply_admin_id,
    ao.last_reply_admin_name,
    ao.admin_cnt,
    ao.daangne_cnt,
    ao.human_cnt,
    CAST(cs.csat_id AS STRING) AS csat_id,
    cs.csat_created_at_kst,
    cs.csat_rate,
    cs.csat_comment,
    cs.choice_correct_answer AS csat_choice_correct_answer,
    cs.choice_quick_answer AS csat_choice_quick_answer,
    cs.choice_kindly AS csat_choice_kindly,
    cs.choice_positive_etc AS csat_choice_positive_etc,
    cs.choice_different_answer AS csat_choice_different_answer,
    cs.choice_cant_understand AS csat_choice_cant_understand,
    cs.choice_unfriendly AS csat_choice_unfriendly,
    cs.choice_late_reply AS csat_choice_late_reply,
    cs.choice_negative_etc AS csat_choice_negative_etc,
    DATE(agg.feedback_start_timestamp, "Asia/Seoul") AS feedback_date_kst,
    DATE(DATE_TRUNC(agg.first_feedback_at_kst, MONTH)) AS year_month,
    CURRENT_TIMESTAMP() AS ingested_at
  FROM aggregated_threads AS agg
  LEFT JOIN csat_first AS cs
    ON agg.feedback_thread_id = cs.inquiry_id
  LEFT JOIN admin_ordered AS ao
    ON agg.feedback_thread_id = ao.feedback_thread_id
  LEFT JOIN ft_base AS ft
    ON agg.feedback_thread_id = ft.id
  WHERE agg.feedback_thread_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY agg.feedback_thread_id
    ORDER BY agg.thread_last_event_at_kst DESC
  ) = 1
) AS s
ON t.feedback_thread_id = s.feedback_thread_id
WHEN MATCHED THEN UPDATE SET
  any_admin_name                       = s.any_admin_name,
  any_admin_id                         = s.any_admin_id,
  feedback_category_path_id            = s.feedback_category_path_id,
  display_full_category_name           = s.display_full_category_name,
  internal_feedback_category_path_name = s.internal_feedback_category_path_name,
  work_group_name                      = s.work_group_name,
  work_group_name_ko                   = s.work_group_name_ko,
  work_group_team                      = s.work_group_team,
  feedback_renewal_team                = s.feedback_renewal_team,
  thread_first_event_at_kst            = s.thread_first_event_at_kst,
  thread_last_event_at_kst             = s.thread_last_event_at_kst,
  first_feedback_at_kst                = s.first_feedback_at_kst,
  last_feedback_at_kst                 = s.last_feedback_at_kst,
  first_reply_at_kst                   = s.first_reply_at_kst,
  last_reply_at_kst                    = s.last_reply_at_kst,
  n_feedback_rows                      = s.n_feedback_rows,
  n_reply_rows                         = s.n_reply_rows,
  contents_concat                      = s.contents_concat,
  feedback_start_timestamp             = s.feedback_start_timestamp,
  status                               = s.status,
  user_selected_category_id            = s.user_selected_category_id,
  admin_agg                            = s.admin_agg,
  first_reply_admin_id                 = s.first_reply_admin_id,
  first_reply_admin_name               = s.first_reply_admin_name,
  last_reply_admin_id                  = s.last_reply_admin_id,
  last_reply_admin_name                = s.last_reply_admin_name,
  admin_cnt                            = s.admin_cnt,
  daangne_cnt                          = s.daangne_cnt,
  human_cnt                            = s.human_cnt,
  csat_id                              = s.csat_id,
  csat_created_at_kst                  = s.csat_created_at_kst,
  csat_rate                            = s.csat_rate,
  csat_comment                         = s.csat_comment,
  csat_choice_correct_answer           = s.csat_choice_correct_answer,
  csat_choice_quick_answer             = s.csat_choice_quick_answer,
  csat_choice_kindly                   = s.csat_choice_kindly,
  csat_choice_positive_etc             = s.csat_choice_positive_etc,
  csat_choice_different_answer         = s.csat_choice_different_answer,
  csat_choice_cant_understand          = s.csat_choice_cant_understand,
  csat_choice_unfriendly               = s.csat_choice_unfriendly,
  csat_choice_late_reply               = s.csat_choice_late_reply,
  csat_choice_negative_etc             = s.csat_choice_negative_etc,
  feedback_date_kst                    = s.feedback_date_kst,
  year_month                           = s.year_month,
  ingested_at                          = s.ingested_at
WHEN NOT MATCHED THEN INSERT (
  feedback_thread_id,
  any_admin_name,
  any_admin_id,
  feedback_category_path_id,
  display_full_category_name,
  internal_feedback_category_path_name,
  work_group_name,
  work_group_name_ko,
  work_group_team,
  feedback_renewal_team,
  thread_first_event_at_kst,
  thread_last_event_at_kst,
  first_feedback_at_kst,
  last_feedback_at_kst,
  first_reply_at_kst,
  last_reply_at_kst,
  n_feedback_rows,
  n_reply_rows,
  contents_concat,
  feedback_start_timestamp,
  status,
  user_selected_category_id,
  admin_agg,
  first_reply_admin_id,
  first_reply_admin_name,
  last_reply_admin_id,
  last_reply_admin_name,
  admin_cnt,
  daangne_cnt,
  human_cnt,
  csat_id,
  csat_created_at_kst,
  csat_rate,
  csat_comment,
  csat_choice_correct_answer,
  csat_choice_quick_answer,
  csat_choice_kindly,
  csat_choice_positive_etc,
  csat_choice_different_answer,
  csat_choice_cant_understand,
  csat_choice_unfriendly,
  csat_choice_late_reply,
  csat_choice_negative_etc,
  feedback_date_kst,
  year_month,
  ingested_at
) VALUES (
  s.feedback_thread_id,
  s.any_admin_name,
  s.any_admin_id,
  s.feedback_category_path_id,
  s.display_full_category_name,
  s.internal_feedback_category_path_name,
  s.work_group_name,
  s.work_group_name_ko,
  s.work_group_team,
  s.feedback_renewal_team,
  s.thread_first_event_at_kst,
  s.thread_last_event_at_kst,
  s.first_feedback_at_kst,
  s.last_feedback_at_kst,
  s.first_reply_at_kst,
  s.last_reply_at_kst,
  s.n_feedback_rows,
  s.n_reply_rows,
  s.contents_concat,
  s.feedback_start_timestamp,
  s.status,
  s.user_selected_category_id,
  s.admin_agg,
  s.first_reply_admin_id,
  s.first_reply_admin_name,
  s.last_reply_admin_id,
  s.last_reply_admin_name,
  s.admin_cnt,
  s.daangne_cnt,
  s.human_cnt,
  s.csat_id,
  s.csat_created_at_kst,
  s.csat_rate,
  s.csat_comment,
  s.csat_choice_correct_answer,
  s.csat_choice_quick_answer,
  s.csat_choice_kindly,
  s.csat_choice_positive_etc,
  s.csat_choice_different_answer,
  s.csat_choice_cant_understand,
  s.csat_choice_unfriendly,
  s.csat_choice_late_reply,
  s.csat_choice_negative_etc,
  s.feedback_date_kst,
  s.year_month,
  s.ingested_at
);

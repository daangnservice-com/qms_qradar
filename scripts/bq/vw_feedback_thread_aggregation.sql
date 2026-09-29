-- vw_feedback_thread_aggregation — 원천 뷰의 ANY_VALUE 비결정성 제거
--
-- 2026-09-18 적용 완료 (데이터 오너 승인). 되돌리려면
--   scripts/bq/vw_feedback_thread_aggregation.rollback.sql (변경 전 원본 정의) 실행.
--
-- 뷰는 물질 테이블(feedback_thread_aggregation)로 대체하지 않고 그대로 둔다 —
--   당일 실시간 집계가 필요할 때 쓰려고. 앱 목록 조회만 테이블로 옮겼고,
--   이 뷰와 테이블은 이제 같은 값을 낸다(아래 대조 결과).
--
-- 이 뷰는 karrotmarket.team_operation 의 공유 객체다. 해당 데이터셋 ACL 에 다른 팀
--   서비스계정(kr-voc-playground, ml-workload@p-operation-classifier, kr-query-pilot)이
--   READER 로 있는데, 누가 이 뷰를 읽는지는 확인하지 못했다 — karrotmarket 에
--   bigquery.jobs.listAll 권한이 없어 JOBS_BY_PROJECT 조회가 막힌다.
--   스키마(43컬럼 이름·타입·순서)는 그대로라 SELECT 는 안 깨지지만, 다중값 스레드의
--   팀/담당자 귀속이 바뀌므로 이 뷰를 쓰는 소비자는 하나씩 확인해 옮긴다.
--
-- ── 배치 스크립트와 값 대조 (적용 직후, lookback 7일 = 스레드 49,892건) ──
--   any_admin_id / any_admin_name / feedback_renewal_team / display_full_category_name /
--   feedback_category_path_id / internal_feedback_category_path_name / work_group_name /
--   work_group_name_ko / work_group_team / contents_concat / admin_agg / status /
--   csat_id / human_cnt / n_feedback_rows / n_reply_rows / feedback_start_timestamp /
--   thread_last_event_at_kst : 19개 컬럼 전부 0건 불일치.
--
-- ── 무엇을 왜 바꾸나 ────────────────────────────────────────────
-- aggregated_threads 의 아래 10개 컬럼이 ANY_VALUE 다. 한 스레드에 문의가 여러 건이면
-- 담당 어드민·팀·카테고리가 실제로 서로 다른데, ANY_VALUE 는 그중 아무거나 고른다.
--   2026-09-18 기준 스레드 1,396,510건 중
--     admin_user_id 2개 이상            152,899건 (11%)
--     feedback_category_path 2개 이상    60,847건
--     admin_first_name 2개 이상          50,367건
--     work_group_team 2개 이상           16,654건
--     renewal_team 2개 이상              16,239건
-- 조회할 때마다 값이 달라질 수 있어서, 같은 스레드가 팀 대시보드 사이를 오간다.
-- → "가장 최근 이벤트가 이긴다"로 고정한다. 컬럼 이름·순서·타입은 그대로다(43컬럼).
--
-- 값 분포: NULL 개수는 네 컬럼 모두 기존 뷰와 동일. 값이 바뀌는 건 위 다중값 스레드뿐이고,
--   "틀린 값 → 맞는 값"이 아니라 "아무거나 → 최신"이다. 집계 지표를 쓰는 쪽에는
--   스레드 단위 팀/담당자 귀속이 소폭 이동하는 것으로 보일 수 있다.
--
-- ── 쿼리 비용 ───────────────────────────────────────────────────
-- ANY_VALUE 와 ARRAY_AGG(... ORDER BY ... LIMIT 1) 실측 비교 (2026-09-18):
--   스캔 바이트 6,914,369,064 로 완전히 동일 → 온디맨드 비용 차이 없음.
--   슬롯: ANY_VALUE 3.12M / 3.97M ms, ARRAY_AGG 2.66M / 3.13M ms.
--   같은 변형끼리 편차(27%)가 둘 사이 격차보다 커서 차이는 노이즈 수준.
--   ARRAY_AGG(LIMIT 1) 은 배열을 쌓지 않고 그룹당 top-1 만 들고 있는 누산기라,
--   6.9GB 스캔 + contents_concat STRING_AGG 옆에서는 무시할 만하다.
--   (이 뷰는 이미 admin_ordered 에서 같은 패턴을 4개 쓰고 있다.)
--
-- ── 대안: 뷰를 물질 테이블의 얇은 별칭으로 ───────────────────────
-- 결정성만 맞추는 대신, 뷰 본문을 통째로 아래로 바꾸는 선택지도 있다.
--   SELECT * EXCEPT (feedback_date_kst, year_month, ingested_at)
--   FROM `karrotmarket.team_operation.feedback_thread_aggregation`
-- 이러면 뷰와 테이블이 영원히 같은 값이고, 뷰를 읽는 다른 팀 쿼리도 조회 1회당
-- 6.9GB → 필터한 파티션만으로 급감한다. 대신 데이터가 최대 24시간 묵는다.
-- 실시간성이 필요한 소비자가 있으면 못 쓴다 — 오너 확인 필요.

CREATE OR REPLACE VIEW `karrotmarket.team_operation.vw_feedback_thread_aggregation` AS
WITH admin_info AS (
  SELECT admin_user_id, ANY_VALUE(first_name) AS first_name
  FROM `karrotmarket.team_operation.vw_admin_user_info`
  GROUP BY admin_user_id
),

ft_base AS (
  SELECT id, status, user_selected_category_id
  FROM `karrotmarket.db_karrot_cs_kr.feedback_threads`
  WHERE created_at >= '2025-01-01'
),

fb_base AS (
  SELECT * EXCEPT(rn)
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
      ROW_NUMBER() OVER(PARTITION BY fb.id ORDER BY fb.created_at_kst DESC) AS rn
    FROM `karrotmarket.team_operation.vw_feedback_verbose` fb
    WHERE fb.created_at_kst >= '2025-01-01'
      AND feedback_thread_id IS NOT NULL
  )
  WHERE rn = 1
),

csat_first AS (
  SELECT * EXCEPT(rn)
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
      ROW_NUMBER() OVER(PARTITION BY csat.inquiry_id ORDER BY csat.created_at_kst DESC) AS rn
    FROM `karrotmarket.team_operation.vw_feedback_chat_CSAT_rawlog_verbose` csat
    WHERE csat.inquiry_type = 'FeedbackThread'
  )
  WHERE rn = 1
),

reply_base AS (
  SELECT
    fr.feedback_id,
    fr.admin_user_id AS reply_admin_id,
    fr.content AS reply_content,
    fr.id AS reply_id,
    DATETIME(fr.created_at, 'Asia/Seoul') AS reply_created_at_kst,
    aui.first_name AS reply_admin_name
  FROM `karrotmarket.db_karrot_cs_kr.feedback_replies` fr
  LEFT JOIN admin_info aui
    ON fr.admin_user_id = aui.admin_user_id
),

events AS (
  -- 1) feedback 이벤트
  SELECT
    fb.feedback_thread_id,
    fb.feedback_category_path_id,
    fb.display_full_category_name,
    fb.internal_feedback_category_path_name,
    fb.work_group_name,
    fb.work_group_name_ko,
    fb.work_group_team,
    fb.feedback_renewal_team,
    'FEEDBACK' AS row_kind,
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
  FROM fb_base fb

  UNION ALL

  -- 2) reply 이벤트
  SELECT
    fb.feedback_thread_id,
    fb.feedback_category_path_id,
    fb.display_full_category_name,
    fb.internal_feedback_category_path_name,
    fb.work_group_name,
    fb.work_group_name_ko,
    fb.work_group_team,
    fb.feedback_renewal_team,
    'REPLY' AS row_kind,
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
  FROM fb_base fb
  INNER JOIN reply_base rp
    ON fb.feedback_id = rp.feedback_id
),

admin_ordered AS (
  SELECT
    feedback_thread_id,
    COUNT(DISTINCT actor_admin_id) AS admin_cnt,
    COUNT(CASE WHEN actor_admin_id = 10588 THEN 1 ELSE NULL END) AS daangne_cnt,
    COUNT(CASE WHEN actor_admin_id != 10588 THEN 1 ELSE NULL END) AS human_cnt,
    -- 최초 답변 순서대로 참여 어드민 나열
    STRING_AGG(admin_label, ', ' ORDER BY first_reply_at_kst) AS admin_agg,

    -- 최초 답변 어드민
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

    -- 최종 답변 어드민
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
        IFNULL(ANY_VALUE(actor_admin_name), 'Unknown'),
        '(', CAST(actor_admin_id AS STRING), ')'
      ) AS admin_label,
      MIN(event_at_kst) AS first_reply_at_kst,
      MAX(event_at_kst) AS last_reply_at_kst
    FROM events
    WHERE row_kind = 'REPLY'
      AND actor_admin_id IS NOT NULL
    GROUP BY feedback_thread_id, actor_admin_id
  )
  GROUP BY feedback_thread_id
),

aggregated_threads AS (
  SELECT
    feedback_thread_id,

    -- ▼ 여기가 유일한 변경점. 기존: ANY_VALUE(...) 10개.
    --   담당자는 "담당자가 붙은 가장 최근 이벤트"(문의·답변 공통),
    --   카테고리/팀 계열은 "가장 최근 FEEDBACK"(= 현재 분류) 기준으로 고정한다.
    --   컬럼마다 따로 뽑는 이유: 한 STRUCT 로 묶어 최근 문의를 통째로 쓰면, 그 문의
    --   담당자에게 renewal_team 이 없을 때 앞 문의가 갖고 있던 팀까지 NULL 로 덮인다.
    --   ANY_VALUE 도 NULL 은 건너뛰므로 여기서도 컬럼별 "가장 최근 non-null" 로 맞춘다.
    ARRAY_AGG(
      IF(actor_admin_id IS NULL, NULL, STRUCT(actor_admin_id AS id, actor_admin_name AS name))
      IGNORE NULLS
      ORDER BY event_at_kst DESC, row_kind DESC, feedback_id DESC, reply_id DESC
      LIMIT 1
    )[SAFE_OFFSET(0)].name AS any_admin_name,
    ARRAY_AGG(
      IF(actor_admin_id IS NULL, NULL, STRUCT(actor_admin_id AS id, actor_admin_name AS name))
      IGNORE NULLS
      ORDER BY event_at_kst DESC, row_kind DESC, feedback_id DESC, reply_id DESC
      LIMIT 1
    )[SAFE_OFFSET(0)].id AS any_admin_id,
    ARRAY_AGG(IF(row_kind = 'FEEDBACK', feedback_category_path_id, NULL)
      IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS feedback_category_path_id,
    ARRAY_AGG(IF(row_kind = 'FEEDBACK', display_full_category_name, NULL)
      IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS display_full_category_name,
    ARRAY_AGG(IF(row_kind = 'FEEDBACK', internal_feedback_category_path_name, NULL)
      IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS internal_feedback_category_path_name,
    ARRAY_AGG(IF(row_kind = 'FEEDBACK', work_group_name, NULL)
      IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS work_group_name,
    ARRAY_AGG(IF(row_kind = 'FEEDBACK', work_group_name_ko, NULL)
      IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS work_group_name_ko,
    ARRAY_AGG(IF(row_kind = 'FEEDBACK', work_group_team, NULL)
      IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS work_group_team,
    ARRAY_AGG(IF(row_kind = 'FEEDBACK', feedback_renewal_team, NULL)
      IGNORE NULLS ORDER BY event_at_kst DESC, feedback_id DESC LIMIT 1
    )[SAFE_OFFSET(0)] AS feedback_renewal_team,
    -- ▲ 변경점 끝

    MIN(event_at_kst) AS thread_first_event_at_kst,
    MAX(event_at_kst) AS thread_last_event_at_kst,

    MIN(IF(row_kind='FEEDBACK', event_at_kst, NULL)) AS first_feedback_at_kst,
    MAX(IF(row_kind='FEEDBACK', event_at_kst, NULL)) AS last_feedback_at_kst,
    MIN(IF(row_kind='REPLY',   event_at_kst, NULL)) AS first_reply_at_kst,
    MAX(IF(row_kind='REPLY',   event_at_kst, NULL)) AS last_reply_at_kst,

    COUNTIF(row_kind='FEEDBACK') AS n_feedback_rows,
    COUNTIF(row_kind='REPLY') AS n_reply_rows,

    STRING_AGG(
      CONCAT(
        '[', row_kind, '] ',
        FORMAT_DATETIME('%F %T', event_at_kst),
        IF(row_kind='REPLY', CONCAT(' | reply_id=', CAST(reply_id AS STRING)), CONCAT(' | feedback_id=', CAST(feedback_id AS STRING))),
        IF(row_kind='REPLY', CONCAT(' | reply_admin_id=', CAST(reply_admin_id AS STRING), '(', IFNULL(actor_admin_name,''), ')'), CONCAT(' | feedback_user_id=', CAST(feedback_user_id AS STRING))),
        '\n', content
      ),
      '\n\n-----\n\n'
      ORDER BY event_at_kst, row_kind, feedback_id
    ) AS contents_concat,

    TIMESTAMP(MIN(event_at_kst), 'Asia/Seoul') AS feedback_start_timestamp
  FROM events
  GROUP BY feedback_thread_id
)

SELECT
  agg.*,
  ft.status,
  ft.user_selected_category_id,
  ao.admin_agg,
  ao.first_reply_admin_id,
  ao.first_reply_admin_name,
  ao.last_reply_admin_id,
  ao.last_reply_admin_name,
  ao.admin_cnt,
  daangne_cnt,
  human_cnt,
  cs.csat_id,
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
  cs.choice_negative_etc AS csat_choice_negative_etc
FROM aggregated_threads agg
LEFT JOIN csat_first cs
  ON agg.feedback_thread_id = cs.inquiry_id
LEFT JOIN admin_ordered ao
  ON agg.feedback_thread_id = ao.feedback_thread_id
LEFT JOIN ft_base ft
  ON agg.feedback_thread_id = ft.id

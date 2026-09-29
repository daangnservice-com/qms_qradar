-- ROLLBACK: vw_feedback_thread_aggregation 변경 전 원본 정의
-- 2026-09-18 INFORMATION_SCHEMA.VIEWS 에서 그대로 떠온 것. 되돌리려면 이 파일을 실행한다.

CREATE OR REPLACE VIEW `karrotmarket.team_operation.vw_feedback_thread_aggregation` AS
WITH admin_info AS (
  SELECT admin_user_id, ANY_VALUE(first_name) AS first_name
  FROM `karrotmarket.team_operation.vw_admin_user_info`
  GROUP BY admin_user_id
),

ft_base AS (
  select id, status, user_selected_category_id
  FROM `karrotmarket.db_karrot_cs_kr.feedback_threads`
  where created_at >= '2025-01-01' 
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
      fb.feedback_parent_category_name display_parent_category_name,
      fb.feedback_category_name display_category_name,
      fb.feedback_thread_id,
      fb.feedback_category_path_id,
      feedback_category_path_name display_full_category_name,
      fb.internal_feedback_category_path_name,
      fb.admin_user_id AS feedback_admin_user_id,
      fb.admin_renewal_team AS feedback_renewal_team,
      fb.admin_first_name AS feedback_admin_name,
      ROW_NUMBER() OVER(PARTITION BY fb.id ORDER BY fb.created_at_kst DESC) AS rn
    FROM `karrotmarket.team_operation.vw_feedback_verbose` fb
    WHERE fb.created_at_kst >= '2025-01-01'
    and feedback_thread_id is not null
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
  -- 💡 개선: CSAT 조인을 없애고 가볍게 만듦
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
    count(distinct actor_admin_id) as admin_cnt,
    count(case when actor_admin_id = 10588 then 1 else null end) as daangne_cnt,
    count(case when actor_admin_id != 10588 then 1 else null end) as human_cnt,
    -- 최초 답변 순서대로 참여 어드민 나열
    STRING_AGG(
      admin_label,
      ', '
      ORDER BY first_reply_at_kst
    ) AS admin_agg,

    -- 최초 답변 어드민
    ARRAY_AGG(
      STRUCT(
        actor_admin_id AS admin_id,
        actor_admin_name AS admin_name
      )
      ORDER BY first_reply_at_kst ASC
      LIMIT 1
    )[OFFSET(0)].admin_id AS first_reply_admin_id,

    ARRAY_AGG(
      STRUCT(
        actor_admin_id AS admin_id,
        actor_admin_name AS admin_name
      )
      ORDER BY first_reply_at_kst ASC
      LIMIT 1
    )[OFFSET(0)].admin_name AS first_reply_admin_name,

    -- 최종 답변 어드민
    ARRAY_AGG(
      STRUCT(
        actor_admin_id AS admin_id,
        actor_admin_name AS admin_name
      )
      ORDER BY last_reply_at_kst DESC
      LIMIT 1
    )[OFFSET(0)].admin_id AS last_reply_admin_id,

    ARRAY_AGG(
      STRUCT(
        actor_admin_id AS admin_id,
        actor_admin_name AS admin_name
      )
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
        '(',
        CAST(actor_admin_id AS STRING),
        ')'
      ) AS admin_label,

      MIN(event_at_kst) AS first_reply_at_kst,
      MAX(event_at_kst) AS last_reply_at_kst

    FROM events
    WHERE row_kind = 'REPLY'
      AND actor_admin_id IS NOT NULL

    GROUP BY
      feedback_thread_id,
      actor_admin_id
  )
  GROUP BY feedback_thread_id
),
-- 💡 개선: 스레드 단위로 먼저 완벽하게 그룹핑
aggregated_threads AS (
  SELECT
    feedback_thread_id,
    ANY_VALUE(actor_admin_name) AS any_admin_name,
    ANY_VALUE(actor_admin_id) AS any_admin_id,
    #STRING_AGG(DISTINCT CONCAT(IFNULL(actor_admin_name, 'Unknown'), '(', CAST(actor_admin_id AS STRING), ')')) AS admin_agg,
    ANY_VALUE(feedback_category_path_id) AS feedback_category_path_id,
    ANY_VALUE(display_full_category_name) AS display_full_category_name,
    ANY_VALUE(internal_feedback_category_path_name) AS internal_feedback_category_path_name,
    ANY_VALUE(work_group_name) AS work_group_name,
    ANY_VALUE(work_group_name_ko) AS work_group_name_ko,
    ANY_VALUE(work_group_team) AS work_group_team,
    ANY_VALUE(feedback_renewal_team) AS feedback_renewal_team,

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
left join admin_ordered ao
on agg.feedback_thread_id = ao.feedback_thread_id
left join
ft_base ft
on agg.feedback_thread_id = ft.id

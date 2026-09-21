-- swap 이후 분석용 뷰. 앱 런타임은 테이블을 직접 읽는다.
-- {{project}} {{dataset}}

CREATE OR REPLACE VIEW `{{project}}.{{dataset}}.vw_qradar_eval_latest_run` AS
SELECT *
FROM `{{project}}.{{dataset}}.qradar_evaluation_results`
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY channel, source_system, source_id, purpose
  ORDER BY analyzed_at DESC
) = 1;

CREATE OR REPLACE VIEW `{{project}}.{{dataset}}.vw_qradar_eval_latest_annotations` AS
SELECT * EXCEPT (rn)
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY annotation_id ORDER BY updated_at DESC) AS rn
  FROM `{{project}}.{{dataset}}.qradar_eval_human_reviews`
)
WHERE rn = 1
  AND IFNULL(deleted, FALSE) = FALSE;

CREATE OR REPLACE VIEW `{{project}}.{{dataset}}.vw_qradar_eval_item_status` AS
SELECT
  r.channel,
  r.source_system,
  r.source_id,
  r.purpose,
  r.org,
  r.analysis_id,
  r.analyzed_at,
  r.ai_label,
  r.prompt_version_id,
  r.prompt_version,
  c.completed_at AS review_completed_at,
  c.completed_by AS review_completed_by,
  cl.claimed_by AS claimed_by,
  cl.claimed_at AS claimed_at
FROM `{{project}}.{{dataset}}.vw_qradar_eval_latest_run` r
LEFT JOIN (
  SELECT *
  FROM `{{project}}.{{dataset}}.qradar_eval_review_completions`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY channel, source_system, source_id
    ORDER BY completed_at DESC
  ) = 1
) c
USING (channel, source_system, source_id)
LEFT JOIN (
  SELECT *
  FROM `{{project}}.{{dataset}}.qradar_eval_review_claims`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY channel, source_system, source_id
    ORDER BY claimed_at DESC
  ) = 1
    AND active = TRUE
) cl
USING (channel, source_system, source_id);

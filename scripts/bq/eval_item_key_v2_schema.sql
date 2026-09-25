-- eval item-key v2 물리 스키마 (리뷰용).
-- 실제 CREATE 는 scripts/migrate-eval-item-key.ts 가 lib/evalSchemaV2.ts 를 기준으로 수행한다.
-- 자리표시자: {{project}} {{dataset}}
--
-- 결과: 전화 + 인앱을 한 테이블에. 키 = channel + source_system + source_id.
-- 수기: reviews / completions / claims 도 같은 키. conversation_id 없음.

CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.qradar_evaluation_results_v2` (
  analysis_id STRING NOT NULL,
  analyzed_at TIMESTAMP NOT NULL,
  channel STRING NOT NULL,
  source_system STRING NOT NULL,
  source_id STRING NOT NULL,
  org STRING,
  purpose STRING NOT NULL,
  analyzed_by STRING,
  model STRING,
  prompt_version_id STRING,
  prompt_version STRING,
  ai_label STRING,
  turns_json STRING,
  input_snapshot_json STRING,
  channel_attrs_json STRING,
  result_json STRING NOT NULL,
  llm_call_id STRING,
  error STRING
)
PARTITION BY DATE(analyzed_at)
CLUSTER BY channel, source_id, purpose
OPTIONS (description = "채널 공통 AI 평가 실행. 수기 라벨/검수완료는 저장하지 않음.");

CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.qradar_eval_human_reviews_v2` (
  annotation_id STRING NOT NULL,
  channel STRING NOT NULL,
  source_system STRING NOT NULL,
  source_id STRING NOT NULL,
  criterion_id INT64,
  scope STRING,
  judgment STRING,
  review_needed BOOL,
  best_category STRING,
  source STRING,
  at_sec FLOAT64,
  segment_index INT64,
  turn_id STRING,
  comment STRING,
  quote STRING,
  ai_criterion_id INT64,
  ai_violated BOOL,
  ai_quote STRING,
  ai_reason STRING,
  payload_json STRING,
  updated_at TIMESTAMP NOT NULL,
  updated_by STRING,
  deleted BOOL
)
PARTITION BY DATE(updated_at)
CLUSTER BY channel, source_id
OPTIONS (description = "수기 주석 append-only. payload_json 은 백필 백업(후속 drop).");

CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.qradar_eval_review_completions_v2` (
  channel STRING NOT NULL,
  source_system STRING NOT NULL,
  source_id STRING NOT NULL,
  completed_at TIMESTAMP NOT NULL,
  completed_by STRING NOT NULL,
  analysis_id STRING,
  org STRING
)
PARTITION BY DATE(completed_at)
CLUSTER BY channel, source_id
OPTIONS (description = "수기 검수 완료 이벤트. 결과 JSON 복사 없음.");

CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.qradar_eval_review_claims_v2` (
  channel STRING NOT NULL,
  source_system STRING NOT NULL,
  source_id STRING NOT NULL,
  claimed_by STRING NOT NULL,
  claimed_at TIMESTAMP NOT NULL,
  active BOOL NOT NULL
)
PARTITION BY DATE(claimed_at)
CLUSTER BY channel, source_id
OPTIONS (description = "검수 찜 이벤트. 아이템별 최신 행이 현재 상태.");

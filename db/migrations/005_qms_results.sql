-- QMS 사람 평가 결과. 원천은 BQ.
-- qms_cases: 결과 뷰(vw_quality_evaluation_cases_detail_with_fallback) 사본. 뷰 한 번 읽는 데 2GB를 긁어서 야간에만 통째로 갈아 끼운다.
-- qms_eval_*: Karrot 평가 원천 테이블의 진행 상태 컬럼만. 작아서 증분 주기마다 통째로 갈아 끼운다(당월 현황용).

create table if not exists qms_cases (
  case_id bigint primary key,
  evaluation_id bigint,
  evaluation_template_id bigint,
  evaluation_target_id bigint,
  template_name text,
  year_month date,
  team_id bigint,
  team_name text,
  target_admin_user_id bigint,
  first_name text,
  status text,
  result text,
  evaluated_count bigint,
  cold_count bigint,
  extra text,
  employee_number text,
  target_query_started_at date,
  target_query_ended_at date,
  target_query_per_user_limit bigint,
  evaluation_extra text,
  evaluation_status text,
  case_content text,
  case_status text,
  case_scores text,
  case_result text,
  case_extra text,
  score_detail text,
  memo_detail text,
  fallback_current_team_name text
);

create index if not exists qms_cases_month_idx on qms_cases (year_month);
create index if not exists qms_cases_target_idx on qms_cases (evaluation_target_id);

create table if not exists qms_eval_evaluations (
  id bigint primary key,
  evaluation_template_id bigint,
  year_month date,
  status text,
  title text,
  team_id bigint
);

create index if not exists qms_eval_evaluations_month_idx on qms_eval_evaluations (year_month);

create table if not exists qms_eval_targets (
  id bigint primary key,
  evaluation_id bigint not null,
  target_admin_user_id bigint,
  status text,
  result text
);

create index if not exists qms_eval_targets_eval_idx on qms_eval_targets (evaluation_id);

create table if not exists qms_eval_cases (
  id bigint primary key,
  evaluation_target_id bigint not null,
  status text
);

create index if not exists qms_eval_cases_target_idx on qms_eval_cases (evaluation_target_id);

create table if not exists qms_eval_templates (
  id bigint primary key,
  name text
);

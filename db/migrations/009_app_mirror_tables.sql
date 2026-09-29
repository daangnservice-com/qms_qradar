-- 앱이 원천인 설정·운영 데이터. BQ 테이블과 이름·컬럼이 같다(BQ 쪽은 야간 덤프 사본).
-- 행을 바꾸면 트리거가 serving_mirror_state 에 표시하고, 덤프는 바뀐 테이블만 BQ에서 통째로 갈아 끼운다.
-- _row_id 는 서빙 전용 키라 덤프하지 않는다.

create table if not exists serving_mirror_state (
  table_name text primary key,
  changed_at timestamptz not null default now(),
  exported_at timestamptz
);

create or replace function serving_mark_mirror_changed() returns trigger language plpgsql as $$
begin
  insert into serving_mirror_state (table_name, changed_at) values (TG_TABLE_NAME, now())
  on conflict (table_name) do update set changed_at = now();
  return null;
end
$$;

create table if not exists qradar_dist_aqt (
  _row_id bigserial primary key,
  channel text,
  aqt_minutes text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_dist_aqt_changed on qradar_dist_aqt;
create trigger qradar_dist_aqt_changed after insert or update or delete or truncate on qradar_dist_aqt
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_dist_assign_detail (
  _row_id bigserial primary key,
  eval_month text,
  evaluator_name text,
  team_name text,
  channel text,
  cs text,
  unit_type text,
  is_phone text,
  is_repeat text,
  _ingested_at timestamptz,
  _source_sheet text,
  evaluator_email text,
  history_id text,
  member_id text,
  member_name text
);

drop trigger if exists qradar_dist_assign_detail_changed on qradar_dist_assign_detail;
create trigger qradar_dist_assign_detail_changed after insert or update or delete or truncate on qradar_dist_assign_detail
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_dist_assign_history (
  _row_id bigserial primary key,
  eval_month text,
  confirmed_by text,
  confirmed_at text,
  total_cs text,
  prev_repeats text,
  within_pm5 text,
  result_json text,
  ratios_json text,
  history_id text,
  meta_json text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_dist_assign_history_changed on qradar_dist_assign_history;
create trigger qradar_dist_assign_history_changed after insert or update or delete or truncate on qradar_dist_assign_history
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_dist_config (
  _row_id bigserial primary key,
  "key" text,
  "value" text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_dist_config_changed on qradar_dist_config;
create trigger qradar_dist_config_changed after insert or update or delete or truncate on qradar_dist_config
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_dist_eval_item_options (
  _row_id bigserial primary key,
  item text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_dist_eval_item_options_changed on qradar_dist_eval_item_options;
create trigger qradar_dist_eval_item_options_changed after insert or update or delete or truncate on qradar_dist_eval_item_options
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_dist_evaluators (
  _row_id bigserial primary key,
  evaluator_name text,
  avail_hours text,
  buffer_pct text,
  cs_participate text,
  ratio_pct text,
  ratio_locked text,
  _ingested_at timestamptz,
  _source_sheet text,
  evaluator_email text
);

drop trigger if exists qradar_dist_evaluators_changed on qradar_dist_evaluators;
create trigger qradar_dist_evaluators_changed after insert or update or delete or truncate on qradar_dist_evaluators
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_dist_teams (
  _row_id bigserial primary key,
  team_id text,
  team_on text,
  team_name text,
  evaluator_name text,
  headcount text,
  cs_mode text,
  difficulty text,
  cold_pct text,
  channel_name text,
  channel_on text,
  aqt text,
  job_to_be text,
  cs_to_be text,
  note text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_dist_teams_changed on qradar_dist_teams;
create trigger qradar_dist_teams_changed after insert or update or delete or truncate on qradar_dist_teams
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_eval_month_locks (
  _row_id bigserial primary key,
  eval_month text,
  confirmed_by text,
  confirmed_at text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_eval_month_locks_changed on qradar_eval_month_locks;
create trigger qradar_eval_month_locks_changed after insert or update or delete or truncate on qradar_eval_month_locks
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_eval_personal_events (
  _row_id bigserial primary key,
  id text not null,
  eval_month text not null,
  owner_email text not null,
  title text not null,
  start_date date not null,
  end_date date,
  color text,
  created_at timestamptz,
  updated_at timestamptz
);

drop trigger if exists qradar_eval_personal_events_changed on qradar_eval_personal_events;
create trigger qradar_eval_personal_events_changed after insert or update or delete or truncate on qradar_eval_personal_events
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_eval_schedule_items (
  _row_id bigserial primary key,
  id text not null,
  eval_month text not null,
  team_name text not null,
  eval_type text not null,
  channel text not null,
  member_count bigint not null,
  per_person_count bigint not null,
  total_count bigint not null,
  round_label text not null,
  start_date date,
  end_date date,
  eval_done boolean,
  leader_done boolean,
  self_done boolean,
  created_at timestamptz,
  updated_at timestamptz,
  evaluator_email text,
  members_json text,
  source_history_id text
);

drop trigger if exists qradar_eval_schedule_items_changed on qradar_eval_schedule_items;
create trigger qradar_eval_schedule_items_changed after insert or update or delete or truncate on qradar_eval_schedule_items
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_eval_target_snapshots (
  _row_id bigserial primary key,
  eval_month text,
  employee_id text,
  name_en text,
  team_name text,
  part text,
  "level" text,
  final_judge text,
  auto_judge text,
  manual_judge text,
  auto_note text,
  memo text,
  edited_by text,
  edited_at text,
  confirmed_by text,
  confirmed_at text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_eval_target_snapshots_changed on qradar_eval_target_snapshots;
create trigger qradar_eval_target_snapshots_changed after insert or update or delete or truncate on qradar_eval_target_snapshots
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_eval_targets (
  _row_id bigserial primary key,
  eval_month text,
  employee_id text,
  name_en text,
  team_name text,
  part text,
  "level" text,
  employment_type text,
  status text,
  hire_date text,
  convert_date text,
  exit_date text,
  auto_judge text,
  manual_judge text,
  final_judge text,
  auto_note text,
  memo text,
  edited_by text,
  edited_at text,
  _ingested_at timestamptz,
  _source_sheet text,
  eval_items text
);

drop trigger if exists qradar_eval_targets_changed on qradar_eval_targets;
create trigger qradar_eval_targets_changed after insert or update or delete or truncate on qradar_eval_targets
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_high_risk_flag_rules (
  _row_id bigserial primary key,
  rule_id text not null,
  "key" text not null,
  label text,
  enabled boolean,
  kind text not null,
  params_json text,
  sort_order bigint,
  updated_at timestamptz not null,
  updated_by text,
  channel text
);

drop trigger if exists qradar_high_risk_flag_rules_changed on qradar_high_risk_flag_rules;
create trigger qradar_high_risk_flag_rules_changed after insert or update or delete or truncate on qradar_high_risk_flag_rules
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_hr_employees (
  _row_id bigserial primary key,
  employee_id text,
  name_ko text,
  name_en text,
  team_name text,
  part text,
  "level" text,
  employment_type text,
  status text,
  tenure text,
  hire_date text,
  convert_date text,
  exit_date text,
  contract_end_date text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_hr_employees_changed on qradar_hr_employees;
create trigger qradar_hr_employees_changed after insert or update or delete or truncate on qradar_hr_employees
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_llm_criterion_prompts (
  _row_id bigserial primary key,
  criterion_id bigint not null,
  category text,
  label text,
  fields_json text,
  updated_at timestamptz not null,
  updated_by text,
  prompt_id text,
  version_label text,
  review_scope text,
  exposure_channels_json text
);

drop trigger if exists qradar_llm_criterion_prompts_changed on qradar_llm_criterion_prompts;
create trigger qradar_llm_criterion_prompts_changed after insert or update or delete or truncate on qradar_llm_criterion_prompts
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_llm_prompt_field_config (
  _row_id bigserial primary key,
  "key" text not null,
  label text,
  sort_order bigint,
  enabled boolean,
  updated_at timestamptz not null,
  updated_by text
);

drop trigger if exists qradar_llm_prompt_field_config_changed on qradar_llm_prompt_field_config;
create trigger qradar_llm_prompt_field_config_changed after insert or update or delete or truncate on qradar_llm_prompt_field_config
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_llm_prompt_prod_history (
  _row_id bigserial primary key,
  event_id text not null,
  template_key text not null,
  from_version_id text,
  to_version_id text not null,
  "action" text,
  note text,
  changed_at timestamptz not null,
  changed_by text
);

drop trigger if exists qradar_llm_prompt_prod_history_changed on qradar_llm_prompt_prod_history;
create trigger qradar_llm_prompt_prod_history_changed after insert or update or delete or truncate on qradar_llm_prompt_prod_history
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_llm_prompt_versions (
  _row_id bigserial primary key,
  version_id text not null,
  template_key text not null,
  version_label text,
  status text not null,
  base_prompt text,
  checklist_template text,
  response_schema_json text,
  criteria_json text,
  selected_criterion_ids text,
  output_schema_config_json text,
  use_checklist boolean,
  change_note text,
  created_at timestamptz not null,
  created_by text,
  criterion_bindings_json text,
  result_parse_config_json text,
  audio_pipeline_config_json text,
  legacy_channel_snapshot_json text
);

drop trigger if exists qradar_llm_prompt_versions_changed on qradar_llm_prompt_versions;
create trigger qradar_llm_prompt_versions_changed after insert or update or delete or truncate on qradar_llm_prompt_versions
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_long_call_thresholds (
  _row_id bigserial primary key,
  snapshot_id text not null,
  rule_key text not null,
  percentile double precision not null,
  window_days bigint not null,
  window_start date not null,
  window_end date not null,
  threshold_minutes double precision not null,
  daily_json text,
  as_of_date date not null,
  computed_at timestamptz not null
);

drop trigger if exists qradar_long_call_thresholds_changed on qradar_long_call_thresholds;
create trigger qradar_long_call_thresholds_changed after insert or update or delete or truncate on qradar_long_call_thresholds
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_slack_users (
  _row_id bigserial primary key,
  slack_user_id text not null,
  email text,
  display_name text,
  real_name text,
  is_bot boolean,
  deleted boolean,
  synced_at timestamptz
);

drop trigger if exists qradar_slack_users_changed on qradar_slack_users;
create trigger qradar_slack_users_changed after insert or update or delete or truncate on qradar_slack_users
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_stt_issue_reports (
  _row_id bigserial primary key,
  report_id text not null,
  conversation_id text not null,
  issue_type text not null,
  stt_source text,
  comment text,
  transcript_json text not null,
  transcript_text text,
  reported_by text,
  reported_at timestamptz not null,
  agent_name text,
  call_date text,
  org text,
  remote_job_id text,
  stt_options_json text,
  segment_detail_json text
);

drop trigger if exists qradar_stt_issue_reports_changed on qradar_stt_issue_reports;
create trigger qradar_stt_issue_reports_changed after insert or update or delete or truncate on qradar_stt_issue_reports
  for each statement execute function serving_mark_mirror_changed();

create table if not exists qradar_team_cold_monthly (
  _row_id bigserial primary key,
  year_month text,
  team_name text,
  total_evaluation_cases text,
  total_cold_count text,
  _ingested_at timestamptz,
  _source_sheet text
);

drop trigger if exists qradar_team_cold_monthly_changed on qradar_team_cold_monthly;
create trigger qradar_team_cold_monthly_changed after insert or update or delete or truncate on qradar_team_cold_monthly
  for each statement execute function serving_mark_mirror_changed();

create unique index if not exists qradar_llm_prompt_versions_id on qradar_llm_prompt_versions (version_id);
create index if not exists qradar_llm_prompt_versions_key on qradar_llm_prompt_versions (template_key, created_at desc);
create index if not exists qradar_llm_criterion_prompts_crit on qradar_llm_criterion_prompts (criterion_id);
create index if not exists qradar_stt_issue_reports_conv on qradar_stt_issue_reports (conversation_id);

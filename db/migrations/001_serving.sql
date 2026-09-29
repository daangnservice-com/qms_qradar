-- 서빙 레이어. Postgres 표준 문법만 사용한다 (로컬과 RDS 동일).

create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists serving_meta (
  key text primary key,
  value_json jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists serving_sync_state (
  job text primary key,
  cursor_at timestamptz,
  last_run_at timestamptz,
  last_error text
);

-- 콜 목록 인덱스. pull 은 원천 컬럼만 갱신하고 앱이 쓴 컬럼은 덮어쓰지 않는다.
create table if not exists call_serving (
  conversation_id text primary key,
  phone_inquiry_id text not null default '',
  admin_user_id text,
  admin_name text not null default '',
  team text not null default '',
  category text not null default '',
  content_snippet text not null default '',
  call_date_kst date,
  call_start_kst text not null default '',
  duration_sec integer,
  minutes_taken double precision,
  inquiry_created_at_kst timestamptz,
  year_month date,
  source_pulled_at timestamptz,
  analyzed boolean not null default false,
  review_completed boolean not null default false,
  ai_label text,
  human_result text,
  eval_flag_keys text[] not null default '{}',
  review_claimed_by text,
  review_claimed_at timestamptz,
  has_stt boolean not null default false,
  stt_source text,
  csat_rate integer,
  latest_analysis_id text,
  reviewer_emails text[] not null default '{}',
  org text,
  updated_at timestamptz not null default now()
);

create index if not exists call_serving_inquiry_idx on call_serving (inquiry_created_at_kst desc);
create index if not exists call_serving_team_idx on call_serving (team);
create index if not exists call_serving_date_idx on call_serving (call_date_kst);
create index if not exists call_serving_phone_idx on call_serving (phone_inquiry_id);

create table if not exists serving_eval_results (
  analysis_id text primary key,
  conversation_id text not null,
  org text,
  purpose text not null,
  analyzed_at timestamptz not null,
  analyzed_by text,
  prompt_version_id text,
  prompt_version text,
  ai_label text,
  row_json jsonb not null,
  exported_at timestamptz
);

create index if not exists serving_eval_results_conv_idx
  on serving_eval_results (conversation_id, analyzed_at desc);

create table if not exists serving_human_reviews (
  annotation_id text primary key,
  conversation_id text not null,
  payload_json jsonb not null,
  updated_at timestamptz not null,
  updated_by text,
  deleted boolean not null default false,
  exported_at timestamptz
);

create index if not exists serving_human_reviews_conv_idx
  on serving_human_reviews (conversation_id, updated_at desc);

create table if not exists serving_review_claims (
  conversation_id text primary key,
  claimed_by text not null,
  claimed_at timestamptz not null,
  active boolean not null,
  exported_at timestamptz
);

create table if not exists serving_review_completions (
  id bigserial primary key,
  conversation_id text not null,
  completed_at timestamptz not null,
  completed_by text not null,
  analysis_id text,
  org text,
  exported_at timestamptz
);

create index if not exists serving_review_completions_conv_idx
  on serving_review_completions (conversation_id, completed_at desc);

-- 화면이 쓰는 상담이력↔CSAT 점수. 원천 설문은 BQ pull, 이 스냅샷을 주기적으로 덤프한다.
create table if not exists serving_csat_assignments (
  phone_inquiry_id text primary key,
  conversation_id text,
  csat_rate integer,
  assigned_at timestamptz not null default now(),
  exported_at timestamptz
);

create table if not exists serving_eval_sets (
  eval_set_id text not null,
  criterion_id integer not null,
  criterion_prompt_id text,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  primary key (eval_set_id, criterion_id)
);

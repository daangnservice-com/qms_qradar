-- 호출·사용 로그. 요청 안에서는 여기만 쓰고 BQ로는 야간 덤프가 내보낸다.

create table if not exists serving_llm_call_logs (
  call_id text primary key,
  ts timestamptz not null,
  purpose text,
  conversation_id text,
  model text,
  prompt_version_id text,
  template_key text,
  latency_ms integer,
  prompt_token_count bigint,
  candidates_token_count bigint,
  total_token_count bigint,
  -- 원본 컬럼 값. 비어 있으면 raw_usage_json 에서 뽑은 값이 audio_tokens 에 들어간다.
  audio_prompt_token_count bigint,
  finish_reason text,
  seed text,
  response_id text,
  raw_usage_json text,
  raw_response_meta_json text,
  error text,
  -- 집계용 파생값 (raw_usage_json 에서 적재 시 계산)
  audio_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  exported_at timestamptz
);

create index if not exists serving_llm_call_logs_ts_idx on serving_llm_call_logs (ts);

create table if not exists serving_stt_call_logs (
  call_id text primary key,
  ts timestamptz not null,
  purpose text,
  conversation_id text,
  model text,
  language text,
  channel_count integer,
  audio_duration_sec double precision,
  billable_duration_sec double precision,
  segment_count integer,
  latency_ms integer,
  error text,
  exported_at timestamptz
);

create index if not exists serving_stt_call_logs_ts_idx on serving_stt_call_logs (ts);

create table if not exists serving_usage_events (
  id bigserial primary key,
  ts timestamptz not null,
  user_email text,
  path text,
  event text,
  exported_at timestamptz
);

create index if not exists serving_usage_events_ts_idx on serving_usage_events (ts);

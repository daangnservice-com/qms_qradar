-- 인앱 문의 CSAT. 설문은 문의 종결 뒤에 오기도 해서 본문(feedback_serving)과 따로 갱신한다.
create table if not exists feedback_csat (
  csat_id text primary key,
  thread_id text not null,
  csat_rate double precision,
  payload_json jsonb not null,
  pulled_at timestamptz not null default now()
);

create index if not exists feedback_csat_thread_idx on feedback_csat (thread_id);

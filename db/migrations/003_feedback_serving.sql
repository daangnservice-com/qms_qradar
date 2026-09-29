-- 종결된 인앱 문의 스레드. pull 은 없는 thread_id 만 넣고 기존 행은 덮어쓰지 않는다.

create table if not exists feedback_serving (
  thread_id text primary key,
  any_admin_id text,
  any_admin_name text not null default '',
  admin_agg text not null default '',
  admin_names text[] not null default '{}',
  admin_ids text[] not null default '{}',
  last_reply_admin_id text,
  last_reply_admin_name text,
  team text not null default '',
  work_group_team text not null default '',
  work_group_name_ko text not null default '',
  category text not null default '',
  internal_category text,
  contents_concat text not null default '',
  feedback_date_kst date,
  feedback_start_at timestamptz,
  first_feedback_at text not null default '',
  last_feedback_at text not null default '',
  first_reply_at text,
  last_reply_at text,
  thread_last_event_at text not null default '',
  n_feedback_rows integer not null default 0,
  n_reply_rows integer not null default 0,
  human_cnt integer not null default 0,
  daangne_cnt integer not null default 0,
  csat_id text,
  csat_rate double precision,
  csat_comment text,
  pulled_at timestamptz not null default now()
);

create index if not exists feedback_serving_start_idx on feedback_serving (feedback_start_at desc);
create index if not exists feedback_serving_date_idx on feedback_serving (feedback_date_kst);
create index if not exists feedback_serving_team_idx on feedback_serving (team);
create index if not exists feedback_serving_work_group_idx on feedback_serving (work_group_team);

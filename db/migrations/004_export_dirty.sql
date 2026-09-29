-- 행이 사라져 exported_at 으로 잡을 수 없는 변경(평가셋 연결 전부 삭제 등)을 덤프에 알린다.
create table if not exists serving_export_dirty (
  kind text not null,
  key text not null,
  marked_at timestamptz not null default now(),
  primary key (kind, key)
);

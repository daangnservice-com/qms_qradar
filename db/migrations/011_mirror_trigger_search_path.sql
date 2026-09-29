-- pg_dump 복원처럼 search_path 가 비어 있어도 트리거가 serving_mirror_state 를 찾도록 스키마를 고정한다.
create or replace function serving_mark_mirror_changed() returns trigger language plpgsql
set search_path from current
as $$
begin
  insert into serving_mirror_state (table_name, changed_at) values (TG_TABLE_NAME, now())
  on conflict (table_name) do update set changed_at = now();
  return null;
end
$$;

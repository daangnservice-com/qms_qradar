-- 평가 결과를 채널 공통으로. 인앱 문의 평가도 같은 테이블에 들어온다.
-- conversation_id 는 채널의 원천 ID(source_id)다. 전화면 Genesys 통화 ID, 인앱이면 스레드 ID.

alter table serving_eval_results add column if not exists channel text not null default 'phone';
alter table serving_eval_results add column if not exists source_system text;

update serving_eval_results
set channel = coalesce(nullif(row_json->>'channel', ''), 'phone'),
    source_system = coalesce(nullif(row_json->>'source_system', ''), source_system)
where source_system is null;

create index if not exists serving_eval_results_item_idx
  on serving_eval_results (channel, source_system, conversation_id, analyzed_at desc);

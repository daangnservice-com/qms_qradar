-- 데이터 쪽이 원천인 참조 데이터. 야간에 통째로 갈아 끼운다.

-- 원본 평가 기준(vw_evaluation_criterions)
create table if not exists qms_source_criteria (
  id bigint primary key,
  type text,
  parent_name text,
  name text,
  parent_id bigint,
  extra text
);

-- QA 수기 레퍼런스(QA_REFERENCES_VIEW). 뷰 컬럼이 바뀌어도 되도록 행을 통째로 JSON 으로 둔다.
create table if not exists qms_qa_references (
  row_no bigserial primary key,
  case_id text,
  year_month date,
  row_json jsonb not null
);

create index if not exists qms_qa_references_month_idx on qms_qa_references (year_month desc, case_id desc);

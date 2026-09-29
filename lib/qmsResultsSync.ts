// QMS 사람 평가 결과 BQ → Postgres. 요청 경로에서는 부르지 않는다(수동 새로고침 제외).
import { getBQ } from "./bigquery";
import { growthBq, karrotCsBq } from "./bqRefs";
import { withServingTx } from "./servingDb";

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

type Row = Record<string, string | null>;

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && "value" in (v as object)) return text((v as { value: unknown }).value);
  return String(v);
}

async function bqRows(query: string): Promise<Row[]> {
  const [rows] = await getBQ().query({ query, ...loc() });
  return (rows as Record<string, unknown>[]).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v)])),
  );
}

/** 테이블을 통째로 갈아 끼운다. 한 트랜잭션이라 읽는 쪽은 이전 또는 새 스냅샷만 본다. */
async function replaceAll(tables: Array<{ table: string; rows: Row[] }>): Promise<void> {
  await withServingTx(async (client) => {
    for (const { table, rows } of tables) {
      await client.query(`delete from ${table}`);
      for (let i = 0; i < rows.length; i += 1000) {
        await client.query(
          `insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb)`,
          [JSON.stringify(rows.slice(i, i + 1000))],
        );
      }
    }
  });
}

const INT_COLS = [
  "case_id",
  "evaluation_id",
  "evaluation_template_id",
  "evaluation_target_id",
  "team_id",
  "target_admin_user_id",
  "evaluated_count",
  "cold_count",
  "target_query_per_user_limit",
];
const DATE_COLS = ["year_month", "target_query_started_at", "target_query_ended_at"];
const TEXT_COLS = [
  "template_name",
  "team_name",
  "first_name",
  "status",
  "result",
  "extra",
  "employee_number",
  "evaluation_extra",
  "evaluation_status",
  "case_content",
  "case_status",
  "case_scores",
  "case_result",
  "case_extra",
  "score_detail",
  "memo_detail",
  "fallback_current_team_name",
];

/** 결과 뷰 전체를 qms_cases 로. 뷰 한 번에 약 2GB를 읽으므로 야간 또는 수동 새로고침에서만 부른다. */
export async function pullQmsCases(): Promise<number> {
  const v = growthBq.qmsCasesDetailSql();
  if (!v) return 0;
  const select = [
    ...INT_COLS.map((c) => `cast(${c} as string) as ${c}`),
    ...DATE_COLS.map((c) => `format_date('%F', ${c}) as ${c}`),
    ...TEXT_COLS,
  ].join(",\n        ");
  const rows = await bqRows(`
    select
        ${select}
    from ${v}
    where case_id is not null
    qualify row_number() over (partition by case_id order by evaluation_id desc) = 1
  `);
  await replaceAll([{ table: "qms_cases", rows }]);
  return rows.length;
}

/** Karrot 평가 원천의 진행 상태. 작아서 증분 주기마다 통째로 읽는다. */
export async function pullQmsEvalStatus(): Promise<number> {
  const [evaluations, targets, cases, templates] = await Promise.all([
    bqRows(`
      select cast(id as string) as id, cast(evaluation_template_id as string) as evaluation_template_id,
        format_date('%F', year_month) as year_month, status, json_value(extra, '$.title') as title,
        cast(team_id as string) as team_id
      from ${karrotCsBq.sql("evaluations")}
    `),
    bqRows(`
      select cast(id as string) as id, cast(evaluation_id as string) as evaluation_id,
        cast(target_admin_user_id as string) as target_admin_user_id, status, result
      from ${karrotCsBq.sql("evaluation_targets")}
    `),
    bqRows(`
      select cast(id as string) as id, cast(evaluation_target_id as string) as evaluation_target_id, status
      from ${karrotCsBq.sql("evaluation_cases")}
    `),
    bqRows(`select cast(id as string) as id, name from ${karrotCsBq.sql("evaluation_templates")}`),
  ]);
  await replaceAll([
    { table: "qms_eval_evaluations", rows: evaluations },
    { table: "qms_eval_targets", rows: targets.filter((r) => r.evaluation_id) },
    { table: "qms_eval_cases", rows: cases.filter((r) => r.evaluation_target_id) },
    { table: "qms_eval_templates", rows: templates },
  ]);
  return evaluations.length + targets.length + cases.length + templates.length;
}

let statusPulledAt = 0;
let statusPull: Promise<void> | null = null;

/**
 * 평가 현황 화면의 "새로고침". 원천을 바로 한 번 읽는다(약 1초, 수 MB).
 * 여러 명이 연달아 눌러도 1분에 한 번만, 동시 요청은 하나로 묶는다.
 */
export function refreshQmsEvalStatus(minIntervalMs = 60_000): Promise<void> {
  if (statusPull) return statusPull;
  if (Date.now() - statusPulledAt < minIntervalMs) return Promise.resolve();
  statusPull = pullQmsEvalStatus()
    .then(() => {
      statusPulledAt = Date.now();
    })
    .finally(() => {
      statusPull = null;
    });
  return statusPull;
}

/** 원본 평가 기준 뷰 → qms_source_criteria. 야간. */
export async function pullSourceCriteria(): Promise<number> {
  const v = growthBq.criteriaSql();
  if (!v) return 0;
  const rows = await bqRows(`
    select cast(id as string) as id, type, parent_name, name, cast(parent_id as string) as parent_id, extra
    from ${v}
    where id is not null
    qualify row_number() over (partition by id) = 1
  `);
  await replaceAll([{ table: "qms_source_criteria", rows }]);
  return rows.length;
}

/** QA 수기 레퍼런스 뷰 → qms_qa_references. 행을 통째로 JSON 으로 둔다. 야간. */
export async function pullQaReferences(): Promise<number> {
  const v = growthBq.qaReferencesSql();
  if (!v) return 0;
  const [raw] = await getBQ().query({
    query: `
      select cast(t.case_id as string) as case_id, format_date('%F', t.year_month) as year_month, to_json_string(t) as j
      from ${v} t
      where t.year_month >= date(@min_year_month)
    `,
    params: { min_year_month: growthBq.qaReferencesMinYearMonth },
    ...loc(),
  });
  const rows = (raw as Array<{ case_id: string | null; year_month: string | null; j: string }>).map((r) => ({
    case_id: r.case_id,
    year_month: r.year_month,
    row_json: r.j,
  }));
  await withServingTx(async (client) => {
    await client.query(`delete from qms_qa_references`);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await client.query(
        `
        insert into qms_qa_references (case_id, year_month, row_json)
        select u.case_id, u.year_month::date, u.row_json::jsonb
        from unnest($1::text[], $2::text[], $3::text[]) as u(case_id, year_month, row_json)
        `,
        [chunk.map((r) => r.case_id), chunk.map((r) => r.year_month), chunk.map((r) => r.row_json)],
      );
    }
  });
  return rows.length;
}

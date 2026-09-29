// 앱이 원천인 설정·운영 테이블(qradar_*)의 서빙 ↔ BQ 동기화.
// 서빙 Postgres 가 원천이고, BQ 쪽은 야간 덤프가 통째로 갈아 끼우는 사본이다.
// 테이블 이름·컬럼은 BQ 와 같다(db/migrations/009). 서빙 전용 _row_id 는 덤프하지 않는다.
import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { servingQuery, withServingTx } from "./servingDb";

export const MIRROR_TABLES = [
  "qradar_llm_prompt_versions",
  "qradar_llm_prompt_prod_history",
  "qradar_llm_criterion_prompts",
  "qradar_llm_prompt_field_config",
  "qradar_high_risk_flag_rules",
  "qradar_long_call_thresholds",
  "qradar_dist_config",
  "qradar_dist_aqt",
  "qradar_dist_teams",
  "qradar_dist_evaluators",
  "qradar_dist_assign_history",
  "qradar_dist_assign_detail",
  "qradar_dist_eval_item_options",
  "qradar_eval_month_locks",
  "qradar_eval_targets",
  "qradar_eval_target_snapshots",
  "qradar_hr_employees",
  "qradar_team_cold_monthly",
  "qradar_eval_schedule_items",
  "qradar_eval_personal_events",
  "qradar_stt_issue_reports",
  "qradar_slack_users",
] as const;

export type MirrorTable = (typeof MIRROR_TABLES)[number];

const loc = () => (growthBq.location ? { location: growthBq.location } : {});
const bqTable = (t: string) => growthBq.resultsSql(t);

async function bqColumns(table: string): Promise<Array<{ name: string; type: string }>> {
  const [rows] = await getBQ().query({
    query: `
      select column_name as name, data_type as type
      from \`${growthBq.projectId}.${growthBq.dataset}.INFORMATION_SCHEMA.COLUMNS\`
      where table_name = @t
      order by ordinal_position
    `,
    params: { t: table },
    ...loc(),
  });
  return (rows as Array<{ name: string; type: string }>).map((r) => ({ name: String(r.name), type: String(r.type) }));
}

const quote = (c: string) => `"${c}"`;

/**
 * 서빙이 비어 있는 테이블만 BQ 에서 통째로 가져온다. 이미 옮긴 뒤에는 아무것도 안 한다.
 * 반환값은 테이블별 가져온 행 수.
 */
export async function backfillMirrorTables(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of MIRROR_TABLES) {
    const has = await servingQuery<{ n: string }>(`select count(*) as n from ${table}`);
    if (Number(has[0]?.n ?? 0) > 0) continue;
    const cols = await bqColumns(table);
    if (!cols.length) {
      out[table] = 0;
      continue;
    }
    // to_json_string 은 TIMESTAMP 를 ISO, DATE 를 YYYY-MM-DD 로 내보내 jsonb_populate_recordset 이 그대로 읽는다.
    const [rows] = await getBQ().query({ query: `select to_json_string(t) as j from ${bqTable(table)} t`, ...loc() });
    const objs = (rows as Array<{ j: string }>).map((r) => JSON.parse(r.j) as Record<string, unknown>);
    const names = cols.map((c) => quote(c.name)).join(", ");
    await withServingTx(async (client) => {
      for (let i = 0; i < objs.length; i += 1000) {
        await client.query(
          `insert into ${table} (${names}) select ${names} from jsonb_populate_recordset(null::${table}, $1::jsonb)`,
          [JSON.stringify(objs.slice(i, i + 1000))],
        );
      }
      // 백필은 BQ 와 같은 내용이라 덤프할 필요가 없다.
      await client.query(
        `
        insert into serving_mirror_state (table_name, changed_at, exported_at) values ($1, now(), now())
        on conflict (table_name) do update set exported_at = now()
        `,
        [table],
      );
    });
    out[table] = objs.length;
  }
  return out;
}

function jsonColExpr(col: string, type: string): string {
  const v = `json_value(j, '$.${col}')`;
  switch (type) {
    case "TIMESTAMP":
      return `timestamp(${v})`;
    case "DATE":
      return `date(${v})`;
    case "DATETIME":
      return `datetime(${v})`;
    case "STRING":
      return v;
    default:
      return `cast(${v} as ${type})`;
  }
}

/** BQ 한 번에 보낼 JSON 문자열 묶음(파라미터 한도 10MB 아래). */
function chunkByBytes(rows: string[], maxBytes = 4_000_000): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let bytes = 0;
  for (const r of rows) {
    if (cur.length && bytes + r.length > maxBytes) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += r.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** 서빙 값 → JSON. timestamptz 는 ISO, date 는 YYYY-MM-DD. */
function toJsonValue(v: unknown, type: string): unknown {
  if (v == null) return null;
  if (v instanceof Date) return type === "DATE" ? v.toISOString().slice(0, 10) : v.toISOString();
  return v;
}

/** 서빙에서 바뀐 테이블을 BQ 에서 통째로 갈아 끼운다. 한 BQ 트랜잭션이라 중간 상태가 안 보인다. */
export async function exportMirrorTables(): Promise<void> {
  // changed_at 은 문자열로 받아 그대로 돌려 쓴다. JS Date 를 거치면 마이크로초가 잘려 계속 바뀐 것으로 보인다.
  const dirty = await servingQuery<{ table_name: string; changed_at: string }>(
    `
    select table_name, changed_at::text as changed_at from serving_mirror_state
    where exported_at is null or changed_at > exported_at
    `,
  );
  const known = new Set<string>(MIRROR_TABLES);
  for (const { table_name: table, changed_at: changedAt } of dirty) {
    if (!known.has(table)) continue;
    const cols = await bqColumns(table);
    if (!cols.length) {
      console.warn(`[servingMirror] BQ 에 ${table} 가 없어 덤프를 건너뜀`);
      continue;
    }
    // pg 는 date 를 로컬 자정 Date 로 준다. 날짜가 밀리지 않게 문자열로 읽는다.
    const select = cols
      .map((c) => (c.type === "DATE" ? `${quote(c.name)}::text as ${quote(c.name)}` : quote(c.name)))
      .join(", ");
    const rows = await servingQuery<Record<string, unknown>>(`select ${select} from ${table} order by _row_id`);
    const json = rows.map((r) => JSON.stringify(Object.fromEntries(cols.map((c) => [c.name, toJsonValue(r[c.name], c.type)]))));
    const chunks = chunkByBytes(json);
    const names = cols.map((c) => `\`${c.name}\``).join(", ");
    const exprs = cols.map((c) => jsonColExpr(c.name, c.type)).join(", ");
    const inserts = chunks
      .map((_, i) => `insert into ${bqTable(table)} (${names}) select ${exprs} from unnest(@rows${i}) as j;`)
      .join("\n");
    const params: Record<string, string[]> = {};
    const types: Record<string, string[]> = {};
    chunks.forEach((c, i) => {
      params[`rows${i}`] = c;
      types[`rows${i}`] = ["STRING"];
    });
    await getBQ().query({
      query: `
        begin transaction;
        delete from ${bqTable(table)} where true;
        ${inserts}
        commit transaction;
      `,
      ...(chunks.length ? { params, types } : {}),
      ...loc(),
    });
    // 덤프 도중 또 바뀌었으면 changed_at 이 더 커서 다음 덤프에 다시 잡힌다.
    await servingQuery(`update serving_mirror_state set exported_at = $2::timestamptz where table_name = $1`, [table, changedAt]);
    console.log(`[servingMirror] exported ${table} ${rows.length}`);
  }
}

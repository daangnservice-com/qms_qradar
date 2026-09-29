// 평가 배분·명단·일정 테이블(qradar_dist_*, qradar_eval_*) 서빙 Postgres 접근.
// 원천은 서빙 DB 이고 BQ 는 야간 덤프 사본이다(lib/servingMirror.ts). 테이블 이름은 BQ 와 같다.
import type pg from "pg";
import { servingQuery, servingRows, withServingTx } from "./servingDb";

/**
 * 평가 배분 셋 조건. `2026-08` 은 버전 없는 그 달 셋(접두 일치, _verN 제외), `2026-08_ver2` 는 정확히 일치.
 * 파라미터는 `@month`. lib/distSet.ts 의 evalMonthWhereSql 과 같은 규칙(BQ 문법판).
 */
export function evalMonthWherePg(column = "eval_month"): string {
  return `(
    ${column}::text = @month
    OR (
      @month !~ '_ver[0-9]+$'
      AND starts_with(${column}::text, @month)
      AND ${column}::text !~ '_ver[0-9]+'
    )
  )`;
}

export function distRows<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params: Record<string, unknown> = {},
  client?: pg.PoolClient,
): Promise<T[]> {
  return servingRows<T>(text, params, client);
}

const colCache = new Map<string, Promise<string[]>>();

/** 서빙 테이블 컬럼(서빙 전용 _row_id 제외). */
export function distTableCols(table: string): Promise<string[]> {
  let p = colCache.get(table);
  if (!p) {
    p = servingQuery<{ column_name: string }>(
      `
      select column_name from information_schema.columns
      where table_schema = current_schema() and table_name = $1 and column_name <> '_row_id'
      order by ordinal_position
      `,
      [table],
    ).then((rows) => rows.map((r) => r.column_name));
    p.catch(() => colCache.delete(table));
    colCache.set(table, p);
  }
  return p;
}

const quote = (c: string) => `"${c}"`;

/** 행을 넣는다. 테이블에 없는 키는 버린다. `_ingested_at`·`_source_sheet` 가 비면 채운다. */
export async function insertDistRows(
  table: string,
  rows: Array<Record<string, unknown>>,
  client?: pg.PoolClient,
): Promise<void> {
  if (!rows.length) return;
  const cols = await distTableCols(table);
  const ingestedAt = new Date().toISOString();
  const fitted = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of cols) if (c in r) o[c] = r[c];
    if (cols.includes("_ingested_at") && !o._ingested_at) o._ingested_at = ingestedAt;
    if (cols.includes("_source_sheet") && !o._source_sheet) o._source_sheet = "qradar";
    return o;
  });
  const names = cols.map(quote).join(", ");
  const run = async (c: pg.PoolClient) => {
    for (let i = 0; i < fitted.length; i += 1000) {
      await c.query(
        `insert into ${table} (${names}) select ${names} from jsonb_populate_recordset(null::${table}, $1::jsonb)`,
        [JSON.stringify(fitted.slice(i, i + 1000))],
      );
    }
  };
  if (client) await run(client);
  else await withServingTx(run);
}

/**
 * 테이블을 통째로 갈아 끼운다(예전 BQ WRITE_TRUNCATE 적재와 같은 모양: 없는 값은 빈 문자열).
 * 한 트랜잭션이라 읽는 쪽은 이전 또는 새 내용만 본다.
 */
export async function replaceDistTable(table: string, rows: Array<Record<string, string>>): Promise<void> {
  const cols = await distTableCols(table);
  const ingestedAt = new Date().toISOString();
  const normalized = rows.map((r) => {
    const o: Record<string, string> = {};
    for (const c of cols) {
      if (c === "_ingested_at") o[c] = ingestedAt;
      else if (c === "_source_sheet") o[c] = r._source_sheet ?? "qradar";
      else o[c] = r[c] ?? "";
    }
    return o;
  });
  await withServingTx(async (client) => {
    await client.query(`delete from ${table}`);
    await insertDistRows(table, normalized, client);
  });
}

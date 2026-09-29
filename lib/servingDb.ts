// 서빙 Postgres (서버 전용). 클라이언트에서 import 하지 않는다.
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function servingDatabaseUrl(): string {
  const url = process.env.SERVING_DATABASE_URL?.trim();
  if (!url) throw new Error("SERVING_DATABASE_URL 이 없습니다.");
  return url;
}

export function servingConfigured(): boolean {
  return Boolean(process.env.SERVING_DATABASE_URL?.trim());
}

function poolConfig(connectionString: string): pg.PoolConfig {
  const sslmode = connectionString.match(/[?&]sslmode=([^&]+)/i)?.[1]?.toLowerCase();
  const ssl = sslmode && sslmode !== "disable" ? { rejectUnauthorized: false } : undefined;
  return { connectionString, max: 10, ssl };
}

export function getServingPool(): pg.Pool {
  if (!pool) pool = new Pool(poolConfig(servingDatabaseUrl()));
  return pool;
}

export async function closeServingPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

export async function servingQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const res = await getServingPool().query<T>(text, values);
  return res.rows;
}

export async function withServingTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getServingPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * BQ 행과 같은 모양으로 돌려준다. BQ 에서 옮겨 온 스토어가 행 해석 코드를 그대로 쓰게 하려는 것.
 * timestamptz → ISO 문자열, date → 'YYYY-MM-DD', int8·numeric → number.
 */
const BQ_LIKE_TYPES: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => {
    if (oid === pg.types.builtins.TIMESTAMPTZ || oid === pg.types.builtins.TIMESTAMP) {
      const base = pg.types.getTypeParser(oid, "text") as (v: string) => Date;
      return (v: string) => {
        const d = base(v);
        return Number.isNaN(d.getTime()) ? v : d.toISOString();
      };
    }
    if (oid === pg.types.builtins.DATE) return (v: string) => v;
    if (oid === pg.types.builtins.INT8 || oid === pg.types.builtins.NUMERIC) return (v: string) => Number(v);
    return pg.types.getTypeParser(oid, format ?? "text");
  }) as pg.CustomTypesConfig["getTypeParser"],
};

/**
 * `@name` 파라미터를 $n 으로 바꿔 실행한다(같은 이름은 같은 번호). 행은 BQ 모양(BQ_LIKE_TYPES).
 * 문자열 리터럴 안의 @ 는 건드리지 않도록 `@` 뒤에 영문자로 시작하는 이름만 바꾼다.
 */
export async function servingRows<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params: Record<string, unknown> = {},
  client?: pg.PoolClient,
): Promise<T[]> {
  const order: string[] = [];
  const sql = text.replace(/(?<![@\w])@([A-Za-z_]\w*)/g, (_, name: string) => {
    if (!(name in params)) throw new Error(`servingRows: 파라미터 @${name} 가 없습니다`);
    let i = order.indexOf(name);
    if (i < 0) i = order.push(name) - 1;
    return `$${i + 1}`;
  });
  const res = await (client ?? getServingPool()).query<T>({
    text: sql,
    values: order.map((n) => params[n]),
    types: BQ_LIKE_TYPES,
  });
  return res.rows;
}

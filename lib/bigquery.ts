import { BigQuery } from "@google-cloud/bigquery";
import { appBq } from "./bqRefs";
import { gcpAdcPreferredAuth } from "./gcpCredentials";

// 사이트 사용량(누가·어떤 페이지를·언제 접속했는지)을 BigQuery에 적재/집계한다.
// 대상 프로젝트/데이터셋/테이블은 lib/bqRefs.ts(appBq).
// 인증은 ADC 우선(gcpAdcPreferredAuth) — SA JSON은 GCS 전용.

const PROJECT_ID = appBq.projectId;
const DATASET = appBq.dataset;
const LOCATION = appBq.location;
const USAGE_TABLE = appBq.tables.usageEvents;

const USAGE_SCHEMA = [
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" }, // 접속 시각(UTC)
  { name: "user_email", type: "STRING", mode: "NULLABLE" }, // 접속자
  { name: "path", type: "STRING", mode: "NULLABLE" }, // 조회한 경로
  { name: "event", type: "STRING", mode: "NULLABLE" }, // 이벤트 종류(기본 pageview)
] as const;

let _bq: BigQuery | null = null;
export function getBQ(): BigQuery {
  if (!_bq) {
    _bq = new BigQuery({
      projectId: PROJECT_ID,
      ...gcpAdcPreferredAuth(),
    });
  }
  return _bq;
}

// 데이터셋·테이블이 없으면 생성한다(테이블별 최초 1회, 프로세스 수명 동안 캐시).
// ⚠️ 데이터셋에 기본 테이블 만료(defaultTableExpiration)를 설정하지 않는다 —
//    과거 다른 데이터셋의 60일 기본 만료로 데이터가 통째로 자동 삭제된 사고를 반복하지 않기 위함.
const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

const _ensured = new Map<string, Promise<void>>();
function ensureTable(name: string, schema: readonly { name: string; type: string; mode: string }[]): Promise<void> {
  let p = _ensured.get(name);
  if (!p) {
    p = (async () => {
      const bq = getBQ();
      const dataset = bq.dataset(DATASET);
      const [dsExists] = await dataset.exists();
      if (!dsExists) await dataset.create({ location: LOCATION }).catch((e) => { if (!isAlreadyExists(e)) throw e; });
      const table = dataset.table(name);
      const [tExists] = await table.exists();
      if (!tExists) await table.create({ schema: schema as unknown as { name: string; type: string; mode: string }[] }).catch((e) => { if (!isAlreadyExists(e)) throw e; });
    })().catch((err) => {
      _ensured.delete(name); // 실패 시 다음 호출에서 재시도할 수 있도록 캐시 해제
      throw err;
    });
    _ensured.set(name, p);
  }
  return p;
}

export const ensureUsageTable = () => ensureTable(USAGE_TABLE, USAGE_SCHEMA);

// 조회 이벤트 1건 적재(fire-and-forget). 실패해도 호출부에서 무시한다.
export async function insertUsageEvent(event: { email: string; path: string; type?: string }): Promise<void> {
  await ensureUsageTable();
  await getBQ()
    .dataset(DATASET)
    .table(USAGE_TABLE)
    .insert(
      [
        {
          ts: new Date().toISOString(),
          user_email: String(event.email ?? ""),
          path: String(event.path ?? ""),
          event: String(event.type ?? "pageview"),
        },
      ],
      { skipInvalidRows: true, ignoreUnknownValues: true },
    );
}

export interface UsageStats {
  totalViews: number;
  totalUsers: number;
  totalActions: number;
  daily: { date: string; views: number; users: number }[];
  byPath: { path: string; views: number; users: number }[];
  byAction: { event: string; count: number; users: number }[]; // 기능별 사용 횟수
  byUser: {
    email: string;
    views: number;
    lastSeen: string;
    paths: { path: string; views: number }[]; // 이 사용자의 화면별 사용
    daily: { date: string; views: number }[]; // 이 사용자의 일별 접속
    actions: { event: string; count: number }[]; // 이 사용자의 기능별 사용
  }[];
}

const num = (v: unknown) => Number(v ?? 0);
const tsStr = (v: unknown) =>
  v && typeof v === "object" && "value" in v ? String((v as { value: string }).value) : String(v ?? "");

// 최근 N일 사용량 집계(일별·경로별·사용자별). 대시보드용. 한국시간(Asia/Seoul) 기준 날짜 집계.
export async function getUsageStats(days = 30): Promise<UsageStats> {
  await ensureUsageTable();
  const T = `\`${PROJECT_ID}.${DATASET}.${USAGE_TABLE}\``;
  const period = "ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
  // 페이지 조회(pageview) vs 기능 사용(액션)을 분리 집계. 검증용 행(event='__verify')은 항상 제외.
  const viewWhere = `WHERE ${period} AND COALESCE(event,'pageview') = 'pageview'`;
  const actWhere = `WHERE ${period} AND event NOT IN ('pageview','__verify') AND event IS NOT NULL`;
  const run = (query: string) => getBQ().query({ query, params: { days }, location: LOCATION });

  const [[daily], [byPath], [byUser], [userPaths], [userDaily], [byAction], [userActions]] = await Promise.all([
    run(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(ts,'Asia/Seoul')) AS date, COUNT(*) AS views, COUNT(DISTINCT user_email) AS users FROM ${T} ${viewWhere} GROUP BY date ORDER BY date`),
    run(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT user_email) AS users FROM ${T} ${viewWhere} GROUP BY path ORDER BY views DESC`),
    run(`SELECT user_email AS email, COUNT(*) AS views, MAX(ts) AS last_seen FROM ${T} ${viewWhere} GROUP BY email ORDER BY views DESC`),
    run(`SELECT user_email AS email, path, COUNT(*) AS views FROM ${T} ${viewWhere} GROUP BY email, path`),
    run(`SELECT user_email AS email, FORMAT_DATE('%Y-%m-%d', DATE(ts,'Asia/Seoul')) AS date, COUNT(*) AS views FROM ${T} ${viewWhere} GROUP BY email, date`),
    run(`SELECT event, COUNT(*) AS count, COUNT(DISTINCT user_email) AS users FROM ${T} ${actWhere} GROUP BY event ORDER BY count DESC`),
    run(`SELECT user_email AS email, event, COUNT(*) AS count FROM ${T} ${actWhere} GROUP BY email, event`),
  ]);

  const daily2 = (daily as Record<string, unknown>[]).map((r) => ({ date: String(r.date), views: num(r.views), users: num(r.users) }));
  const byPath2 = (byPath as Record<string, unknown>[]).map((r) => ({ path: String(r.path ?? ""), views: num(r.views), users: num(r.users) }));
  const byAction2 = (byAction as Record<string, unknown>[]).map((r) => ({ event: String(r.event ?? ""), count: num(r.count), users: num(r.users) }));

  // 사용자별 상세(화면·일별·액션)를 이메일 기준으로 묶어 byUser에 붙인다.
  const pathsByEmail = new Map<string, { path: string; views: number }[]>();
  for (const r of userPaths as Record<string, unknown>[]) {
    const e = String(r.email ?? "");
    (pathsByEmail.get(e) ?? pathsByEmail.set(e, []).get(e)!).push({ path: String(r.path ?? ""), views: num(r.views) });
  }
  const dailyByEmail = new Map<string, { date: string; views: number }[]>();
  for (const r of userDaily as Record<string, unknown>[]) {
    const e = String(r.email ?? "");
    (dailyByEmail.get(e) ?? dailyByEmail.set(e, []).get(e)!).push({ date: String(r.date), views: num(r.views) });
  }
  const actionsByEmail = new Map<string, { event: string; count: number }[]>();
  for (const r of userActions as Record<string, unknown>[]) {
    const e = String(r.email ?? "");
    (actionsByEmail.get(e) ?? actionsByEmail.set(e, []).get(e)!).push({ event: String(r.event ?? ""), count: num(r.count) });
  }

  const byUser2 = (byUser as Record<string, unknown>[]).map((r) => {
    const email = String(r.email ?? "");
    return {
      email,
      views: num(r.views),
      lastSeen: tsStr(r.last_seen),
      paths: (pathsByEmail.get(email) ?? []).sort((a, b) => b.views - a.views),
      daily: (dailyByEmail.get(email) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
      actions: (actionsByEmail.get(email) ?? []).sort((a, b) => b.count - a.count),
    };
  });

  return {
    totalViews: byPath2.reduce((s, r) => s + r.views, 0),
    totalUsers: byUser2.length,
    totalActions: byAction2.reduce((s, r) => s + r.count, 0),
    daily: daily2,
    byPath: byPath2,
    byAction: byAction2,
    byUser: byUser2,
  };
}

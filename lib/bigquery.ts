import { BigQuery } from "@google-cloud/bigquery";

// 사이트 사용량(누가·어떤 페이지를·언제 접속했는지)을 BigQuery에 적재/집계한다.
//
// 대상: striped-option-493506-a7.helpdesk_x.usage_events (Asia-northeast3)
// 인증: GOOGLE_SERVICE_ACCOUNT_JSON(서비스계정 키 JSON) 우선, 없으면 ADC(Application Default Credentials).

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID ?? "striped-option-493506-a7";
const DATASET = process.env.BIGQUERY_DATASET_ID ?? "helpdesk_x";
const LOCATION = process.env.BIGQUERY_LOCATION ?? "asia-northeast3";
const USAGE_TABLE = "usage_events";

const USAGE_SCHEMA = [
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" }, // 접속 시각(UTC)
  { name: "user_email", type: "STRING", mode: "NULLABLE" }, // 접속자
  { name: "path", type: "STRING", mode: "NULLABLE" }, // 조회한 경로
  { name: "event", type: "STRING", mode: "NULLABLE" }, // 이벤트 종류(기본 pageview)
] as const;

let _bq: BigQuery | null = null;
export function getBQ(): BigQuery {
  if (!_bq) {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    _bq = new BigQuery({
      projectId: PROJECT_ID,
      // 서비스계정 키가 있으면 사용, 없으면 라이브러리 기본 인증(ADC/GOOGLE_APPLICATION_CREDENTIALS)에 위임.
      ...(saJson ? { credentials: JSON.parse(saJson) } : {}),
    });
  }
  return _bq;
}

// 데이터셋·테이블이 없으면 생성한다(최초 1회). 프로세스 수명 동안 캐시.
// ⚠️ 데이터셋에 기본 테이블 만료(defaultTableExpiration)를 설정하지 않는다 —
//    과거 다른 데이터셋의 60일 기본 만료로 데이터가 통째로 자동 삭제된 사고를 반복하지 않기 위함.
let _ensured: Promise<void> | null = null;
export function ensureUsageTable(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const bq = getBQ();
      const dataset = bq.dataset(DATASET);
      const [dsExists] = await dataset.exists();
      if (!dsExists) await dataset.create({ location: LOCATION });
      const table = dataset.table(USAGE_TABLE);
      const [tExists] = await table.exists();
      if (!tExists) await table.create({ schema: USAGE_SCHEMA as unknown as { name: string; type: string; mode: string }[] });
    })().catch((err) => {
      _ensured = null; // 실패 시 다음 호출에서 재시도할 수 있도록 캐시 해제
      throw err;
    });
  }
  return _ensured;
}

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
  daily: { date: string; views: number; users: number }[];
  byPath: { path: string; views: number; users: number }[];
  byUser: {
    email: string;
    views: number;
    lastSeen: string;
    paths: { path: string; views: number }[]; // 이 사용자의 화면별 사용
    daily: { date: string; views: number }[]; // 이 사용자의 일별 접속
  }[];
}

const num = (v: unknown) => Number(v ?? 0);
const tsStr = (v: unknown) =>
  v && typeof v === "object" && "value" in v ? String((v as { value: string }).value) : String(v ?? "");

// 최근 N일 사용량 집계(일별·경로별·사용자별). 대시보드용. 한국시간(Asia/Seoul) 기준 날짜 집계.
export async function getUsageStats(days = 30): Promise<UsageStats> {
  await ensureUsageTable();
  const T = `\`${PROJECT_ID}.${DATASET}.${USAGE_TABLE}\``;
  // 기간 필터 + 헬스체크/검증용 행(event='__verify') 제외
  const where = "WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY) AND COALESCE(event, '') != '__verify'";
  const run = (query: string) => getBQ().query({ query, params: { days }, location: LOCATION });

  const [[daily], [byPath], [byUser], [userPaths], [userDaily]] = await Promise.all([
    run(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(ts,'Asia/Seoul')) AS date, COUNT(*) AS views, COUNT(DISTINCT user_email) AS users FROM ${T} ${where} GROUP BY date ORDER BY date`),
    run(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT user_email) AS users FROM ${T} ${where} GROUP BY path ORDER BY views DESC`),
    run(`SELECT user_email AS email, COUNT(*) AS views, MAX(ts) AS last_seen FROM ${T} ${where} GROUP BY email ORDER BY views DESC`),
    run(`SELECT user_email AS email, path, COUNT(*) AS views FROM ${T} ${where} GROUP BY email, path`),
    run(`SELECT user_email AS email, FORMAT_DATE('%Y-%m-%d', DATE(ts,'Asia/Seoul')) AS date, COUNT(*) AS views FROM ${T} ${where} GROUP BY email, date`),
  ]);

  const daily2 = (daily as Record<string, unknown>[]).map((r) => ({ date: String(r.date), views: num(r.views), users: num(r.users) }));
  const byPath2 = (byPath as Record<string, unknown>[]).map((r) => ({ path: String(r.path ?? ""), views: num(r.views), users: num(r.users) }));

  // 사용자별 상세(화면·일별)를 이메일 기준으로 묶어 byUser에 붙인다.
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

  const byUser2 = (byUser as Record<string, unknown>[]).map((r) => {
    const email = String(r.email ?? "");
    return {
      email,
      views: num(r.views),
      lastSeen: tsStr(r.last_seen),
      paths: (pathsByEmail.get(email) ?? []).sort((a, b) => b.views - a.views),
      daily: (dailyByEmail.get(email) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
    };
  });

  return {
    totalViews: byPath2.reduce((s, r) => s + r.views, 0),
    totalUsers: byUser2.length,
    daily: daily2,
    byPath: byPath2,
    byUser: byUser2,
  };
}

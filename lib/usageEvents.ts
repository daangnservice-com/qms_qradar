// 사이트 사용량(누가·어떤 페이지를·언제 접속했는지). 서빙 Postgres(serving_usage_events)에 적재·집계하고
// BQ(usage_events)로는 야간 덤프가 내보낸다. ⚠️ 서버 전용.
import { servingQuery } from "./servingDb";

/** 조회 이벤트 1건 적재(fire-and-forget). 실패해도 호출부에서 무시한다. */
export async function insertUsageEvent(event: { email: string; path: string; type?: string }): Promise<void> {
  await servingQuery(
    `insert into serving_usage_events (ts, user_email, path, event) values (now(), $1, $2, $3)`,
    [String(event.email ?? ""), String(event.path ?? ""), String(event.type ?? "pageview")],
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

// 최근 N일 사용량 집계(일별·경로별·사용자별). 대시보드용. 한국시간(Asia/Seoul) 기준 날짜 집계.
export async function getUsageStats(days = 30): Promise<UsageStats> {
  const T = "serving_usage_events";
  const day = `to_char(ts at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;
  const period = "ts >= now() - make_interval(days => $1)";
  // 페이지 조회(pageview) vs 기능 사용(액션)을 분리 집계. 검증용 행(event='__verify')은 항상 제외.
  const viewWhere = `where ${period} and coalesce(event, 'pageview') = 'pageview'`;
  const actWhere = `where ${period} and event not in ('pageview', '__verify') and event is not null`;
  const run = (text: string) => servingQuery<Record<string, unknown>>(text, [days]);

  const [daily, byPath, byUser, userPaths, userDaily, byAction, userActions] = await Promise.all([
    run(`select ${day} as date, count(*) as views, count(distinct user_email) as users from ${T} ${viewWhere} group by date order by date`),
    run(`select path, count(*) as views, count(distinct user_email) as users from ${T} ${viewWhere} group by path order by views desc`),
    run(`select user_email as email, count(*) as views, max(ts) as last_seen from ${T} ${viewWhere} group by email order by views desc`),
    run(`select user_email as email, path, count(*) as views from ${T} ${viewWhere} group by email, path`),
    run(`select user_email as email, ${day} as date, count(*) as views from ${T} ${viewWhere} group by email, date`),
    run(`select event, count(*) as count, count(distinct user_email) as users from ${T} ${actWhere} group by event order by count desc`),
    run(`select user_email as email, event, count(*) as count from ${T} ${actWhere} group by email, event`),
  ]);

  const daily2 = daily.map((r) => ({ date: String(r.date), views: num(r.views), users: num(r.users) }));
  const byPath2 = byPath.map((r) => ({ path: String(r.path ?? ""), views: num(r.views), users: num(r.users) }));
  const byAction2 = byAction.map((r) => ({ event: String(r.event ?? ""), count: num(r.count), users: num(r.users) }));

  // 사용자별 상세(화면·일별·액션)를 이메일 기준으로 묶어 byUser에 붙인다.
  const group = <T>(rows: Record<string, unknown>[], pick: (r: Record<string, unknown>) => T) => {
    const out = new Map<string, T[]>();
    for (const r of rows) {
      const e = String(r.email ?? "");
      (out.get(e) ?? out.set(e, []).get(e)!).push(pick(r));
    }
    return out;
  };
  const pathsByEmail = group(userPaths, (r) => ({ path: String(r.path ?? ""), views: num(r.views) }));
  const dailyByEmail = group(userDaily, (r) => ({ date: String(r.date), views: num(r.views) }));
  const actionsByEmail = group(userActions, (r) => ({ event: String(r.event ?? ""), count: num(r.count) }));

  const byUser2 = byUser.map((r) => {
    const email = String(r.email ?? "");
    const last = r.last_seen;
    return {
      email,
      views: num(r.views),
      lastSeen: last instanceof Date ? last.toISOString() : String(last ?? ""),
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

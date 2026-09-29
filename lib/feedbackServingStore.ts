// 종결 인앱 문의 서빙. 요청 경로는 Postgres만 보고, BQ 적재는 pull 에서만 한다.
import { getBQ } from "./bigquery";
import { feedbackBq } from "./bqRefs";
import {
  parseParticipatingAdmins,
  rowToFeedbackSample,
  type FeedbackFilterOptions,
  type FeedbackSample,
  type FeedbackSampleFilters,
} from "./feedbackSamples";
import type { FeedbackCountTarget } from "./highRiskFlags";
import { servingQuery, withServingTx } from "./servingDb";
import type { CsatRecord } from "./csat";

const SELECT_LIST = `
  thread_id as feedback_thread_id,
  any_admin_id,
  any_admin_name,
  admin_agg,
  last_reply_admin_id,
  last_reply_admin_name,
  team as feedback_renewal_team,
  work_group_team,
  work_group_name_ko,
  category as display_full_category_name,
  internal_category as internal_feedback_category_path_name,
  contents_concat,
  first_feedback_at as first_feedback_at_kst,
  last_feedback_at as last_feedback_at_kst,
  first_reply_at as first_reply_at_kst,
  last_reply_at as last_reply_at_kst,
  thread_last_event_at as thread_last_event_at_kst,
  n_feedback_rows,
  n_reply_rows,
  csat_id,
  csat_rate,
  csat_comment
`;

const HIGH_RISK_SQL: Record<FeedbackCountTarget, string> = {
  feedback: "coalesce(n_feedback_rows, 0)",
  reply: "coalesce(n_reply_rows, 0)",
  total: "(coalesce(n_feedback_rows, 0) + coalesce(n_reply_rows, 0))",
};

function clean(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

export type FeedbackListPlan = { text: string; values: unknown[] };

/** 목록 1쿼리. 스레드 ID가 있으면 다른 필터는 적용하지 않는다. */
export function buildFeedbackListQuery(filters: FeedbackSampleFilters, limit: number): FeedbackListPlan {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const addCount = (value: number | null | undefined, op: ">=" | "<=", column: string) => {
    if (value == null || !Number.isFinite(value)) return;
    where.push(`${column} ${op} ${add(Math.max(0, Math.floor(value)))}`);
  };

  const sourceIds = clean(filters.sourceIds);
  if (sourceIds.length) {
    where.push(`thread_id = any(${add(sourceIds)}::text[])`);
  } else {
    const teams = clean(filters.teams);
    if (teams.length) where.push(`team = any(${add(teams)}::text[])`);
    const categories = clean(filters.categories);
    if (categories.length) where.push(`category = any(${add(categories)}::text[])`);
    const adminNames = clean(filters.adminNames);
    if (adminNames.length) {
      const p = add(adminNames);
      where.push(`(any_admin_name = any(${p}::text[]) or admin_names && ${p}::text[])`);
    }
    const adminIds = clean(filters.adminIds);
    if (adminIds.length) {
      const p = add(adminIds);
      where.push(`(any_admin_id = any(${p}::text[]) or admin_ids && ${p}::text[])`);
    }
    const csatRates = [
      ...new Set((filters.csatRates ?? []).filter((rate) => Number.isInteger(rate) && rate >= 1 && rate <= 5)),
    ];
    if (csatRates.length || filters.csatIncludeNone) {
      const clauses: string[] = [];
      if (csatRates.length) clauses.push(`cast(csat_rate as int) = any(${add(csatRates)}::int[])`);
      if (filters.csatIncludeNone) clauses.push("csat_rate is null");
      where.push(`(${clauses.join(" or ")})`);
    }
    addCount(filters.feedbackCountMin, ">=", "n_feedback_rows");
    addCount(filters.feedbackCountMax, "<=", "n_feedback_rows");
    addCount(filters.replyCountMin, ">=", "n_reply_rows");
    addCount(filters.replyCountMax, "<=", "n_reply_rows");
    addCount(filters.humanCountMin, ">=", "human_cnt");
    addCount(filters.humanCountMax, "<=", "human_cnt");
    const risk = (filters.highRiskCountAny ?? []).filter((p) => Number.isFinite(p.minCount) && p.minCount >= 0);
    if (risk.length) {
      const parts = risk.map((p) => {
        const target: FeedbackCountTarget =
          p.countTarget === "feedback" || p.countTarget === "reply" ? p.countTarget : "total";
        return `${HIGH_RISK_SQL[target]} >= ${add(Math.max(0, Math.floor(p.minCount)))}`;
      });
      where.push(`(${parts.join(" or ")})`);
    }
    if (filters.dateStart) where.push(`feedback_date_kst >= ${add(filters.dateStart)}::date`);
    if (filters.dateEnd) where.push(`feedback_date_kst <= ${add(filters.dateEnd)}::date`);
  }

  const limitParam = add(safeLimit);
  return {
    text: `
      select ${SELECT_LIST}
      from feedback_serving
      ${where.length ? `where ${where.join("\n        and ")}` : ""}
      order by feedback_start_at desc nulls last
      limit ${limitParam}
    `,
    values,
  };
}

export async function listServingFeedbackSamples(
  filters: FeedbackSampleFilters = {},
  limit = 100,
): Promise<FeedbackSample[]> {
  const plan = buildFeedbackListQuery(filters, limit);
  const rows = await servingQuery<Record<string, unknown>>(plan.text, plan.values);
  return rows.map(rowToFeedbackSample).filter((row): row is FeedbackSample => Boolean(row));
}

export async function listServingFeedbackFilterOptions(): Promise<FeedbackFilterOptions> {
  const rows = await servingQuery<{ team: string; name: string; category: string }>(`
    select distinct team, any_admin_name as name, category
    from feedback_serving
    where feedback_date_kst >= current_date - interval '90 days'
  `);
  const teamAgents = new Map<string, { team: string; name: string }>();
  const categories = new Set<string>();
  for (const row of rows) {
    const team = row.team ?? "";
    const name = (row.name ?? "").trim();
    const category = (row.category ?? "").trim();
    if (name) teamAgents.set(`${team}:${name}`, { team, name });
    if (category) categories.add(category);
  }
  return {
    teamAgents: [...teamAgents.values()],
    categories: [...categories].sort((a, b) => a.localeCompare(b, "ko")),
  };
}

type InsertRow = {
  threadId: string;
  anyAdminId: string | null;
  anyAdminName: string;
  adminAgg: string;
  adminNames: string[];
  adminIds: string[];
  lastReplyAdminId: string | null;
  lastReplyAdminName: string | null;
  team: string;
  workGroupTeam: string;
  workGroupNameKo: string;
  category: string;
  internalCategory: string | null;
  contents: string;
  feedbackDate: string | null;
  feedbackStartAt: string | null;
  firstFeedbackAt: string;
  lastFeedbackAt: string;
  firstReplyAt: string | null;
  lastReplyAt: string | null;
  threadLastEventAt: string;
  nFeedback: number;
  nReply: number;
  humanCnt: number;
  daangneCnt: number;
  csatId: string | null;
  csatRate: number | null;
  csatComment: string | null;
};

function bqStr(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) return String((v as { value: unknown }).value);
  return v == null ? "" : String(v);
}

function bqNum(v: unknown): number | null {
  const n = Number(bqStr(v));
  return Number.isFinite(n) && bqStr(v) !== "" ? n : null;
}

const INSERT_SQL = `
  insert into feedback_serving (
    thread_id, any_admin_id, any_admin_name, admin_agg, admin_names, admin_ids,
    last_reply_admin_id, last_reply_admin_name, team, work_group_team, work_group_name_ko,
    category, internal_category, contents_concat, feedback_date_kst, feedback_start_at,
    first_feedback_at, last_feedback_at, first_reply_at, last_reply_at, thread_last_event_at,
    n_feedback_rows, n_reply_rows, human_cnt, daangne_cnt, csat_id, csat_rate, csat_comment
  ) values (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::date,$16::timestamptz,
    $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
  )
  on conflict (thread_id) do nothing
`;

async function insertFeedbackRows(rows: InsertRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    inserted += await withServingTx(async (client) => {
      let n = 0;
      for (const r of chunk) {
        const res = await client.query(INSERT_SQL, [
          r.threadId,
          r.anyAdminId,
          r.anyAdminName,
          r.adminAgg,
          r.adminNames,
          r.adminIds,
          r.lastReplyAdminId,
          r.lastReplyAdminName,
          r.team,
          r.workGroupTeam,
          r.workGroupNameKo,
          r.category,
          r.internalCategory,
          r.contents,
          r.feedbackDate,
          r.feedbackStartAt,
          r.firstFeedbackAt,
          r.lastFeedbackAt,
          r.firstReplyAt,
          r.lastReplyAt,
          r.threadLastEventAt,
          r.nFeedback,
          r.nReply,
          r.humanCnt,
          r.daangneCnt,
          r.csatId,
          r.csatRate,
          r.csatComment,
        ]);
        n += res.rowCount ?? 0;
      }
      return n;
    });
  }
  return inserted;
}

function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function monthWindows(start: string, end: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cursor = `${start.slice(0, 7)}-01`;
  while (cursor < end) {
    const [y, m] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const from = cursor < start ? start : cursor;
    const to = next < end ? next : end;
    if (from < to) out.push([from, to]);
    cursor = next;
  }
  return out;
}

let pullTail: Promise<unknown> = Promise.resolve();

/** 문의 시작부터 종결까지 가장 오래 걸린 스레드가 146일이었다. 시작일 파티션을 이만큼 거슬러 본다. */
const PARTITION_DAYS = 180;

export type FeedbackPullOptions = {
  /** 2025-02 부터 종결 시각과 무관하게 전량 (월 단위로 나눠 읽는다). */
  full?: boolean;
  /** 최근 N일 안에 종결된 스레드만. 기본 3일. */
  closedWithinDays?: number;
};

/**
 * 종결 스레드를 넣는다. 이미 있는 thread_id 는 건너뛴다. 끝난 문의는 다시 바뀌지 않는다.
 * 기본은 최근 3일 안에 종결된 스레드다. 시작일로 자르면 사흘 넘게 걸린 문의(약 30%)가 영영 빠진다.
 */
export function pullFeedbackThreads(opts?: FeedbackPullOptions): Promise<number> {
  const run = pullTail.then(() => pullFeedbackThreadsBody(opts));
  pullTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function pullFeedbackThreadsBody(opts?: FeedbackPullOptions): Promise<number> {
    const end = addDays(seoulToday(), 1);
    const incremental = !opts?.full;
    const closedWithin = Math.max(1, Math.floor(opts?.closedWithinDays ?? 3));
    const start = opts?.full ? "2025-02-01" : addDays(seoulToday(), -PARTITION_DAYS);
    let inserted = 0;
    // 최근 종결분은 결과가 작아서 한 번에, 넓게 볼 때는 월 단위로 나눠 메모리를 아낀다.
    const windows: Array<[string, string]> = incremental && closedWithin <= 7 ? [[start, end]] : monthWindows(start, end);
    for (const [from, to] of windows) {
      const [rows] = await getBQ().query({
        query: `
          select
            cast(feedback_thread_id as string) as thread_id,
            cast(any_admin_id as string) as any_admin_id,
            any_admin_name,
            admin_agg,
            cast(last_reply_admin_id as string) as last_reply_admin_id,
            last_reply_admin_name,
            feedback_renewal_team,
            work_group_team,
            work_group_name_ko,
            display_full_category_name,
            internal_feedback_category_path_name,
            contents_concat,
            format_date('%F', feedback_date_kst) as feedback_date_kst,
            format_timestamp('%FT%T%Ez', feedback_start_timestamp, 'Asia/Seoul') as feedback_start_at,
            format_datetime('%F %T', first_feedback_at_kst) as first_feedback_at,
            format_datetime('%F %T', last_feedback_at_kst) as last_feedback_at,
            format_datetime('%F %T', first_reply_at_kst) as first_reply_at,
            format_datetime('%F %T', last_reply_at_kst) as last_reply_at,
            format_datetime('%F %T', thread_last_event_at_kst) as thread_last_event_at,
            n_feedback_rows,
            n_reply_rows,
            human_cnt,
            daangne_cnt,
            csat_id,
            csat_rate,
            csat_comment
          from ${feedbackBq.sourceSql()}
          where status = 10
            and feedback_start_timestamp is not null
            and any_admin_id is not null
            and feedback_renewal_team is not null
            and thread_last_event_at_kst <= datetime_sub(current_datetime('Asia/Seoul'), interval 2 hour)
            and feedback_date_kst >= date(@fromDate)
            and feedback_date_kst < date(@toDate)
            ${incremental ? `and thread_last_event_at_kst >= datetime_sub(current_datetime('Asia/Seoul'), interval ${closedWithin} day)` : ""}
        `,
        params: { fromDate: from, toDate: to },
        types: { fromDate: "STRING", toDate: "STRING" },
        location: feedbackBq.location,
      });
      const mapped: InsertRow[] = (rows as Record<string, unknown>[]).flatMap((r) => {
        const threadId = bqStr(r.thread_id);
        if (!threadId) return [];
        const admins = parseParticipatingAdmins(bqStr(r.admin_agg));
        return [
          {
            threadId,
            anyAdminId: bqStr(r.any_admin_id) || null,
            anyAdminName: bqStr(r.any_admin_name),
            adminAgg: bqStr(r.admin_agg),
            adminNames: admins.map((a) => a.name),
            adminIds: admins.map((a) => a.id),
            lastReplyAdminId: bqStr(r.last_reply_admin_id) || null,
            lastReplyAdminName: bqStr(r.last_reply_admin_name) || null,
            team: bqStr(r.feedback_renewal_team),
            workGroupTeam: bqStr(r.work_group_team),
            workGroupNameKo: bqStr(r.work_group_name_ko),
            category: bqStr(r.display_full_category_name),
            internalCategory: bqStr(r.internal_feedback_category_path_name) || null,
            contents: bqStr(r.contents_concat),
            feedbackDate: bqStr(r.feedback_date_kst) || null,
            feedbackStartAt: bqStr(r.feedback_start_at) || null,
            firstFeedbackAt: bqStr(r.first_feedback_at),
            lastFeedbackAt: bqStr(r.last_feedback_at),
            firstReplyAt: bqStr(r.first_reply_at) || null,
            lastReplyAt: bqStr(r.last_reply_at) || null,
            threadLastEventAt: bqStr(r.thread_last_event_at),
            nFeedback: bqNum(r.n_feedback_rows) ?? 0,
            nReply: bqNum(r.n_reply_rows) ?? 0,
            humanCnt: bqNum(r.human_cnt) ?? 0,
            daangneCnt: bqNum(r.daangne_cnt) ?? 0,
            csatId: bqStr(r.csat_id) || null,
            csatRate: bqNum(r.csat_rate),
            csatComment: bqStr(r.csat_comment) || null,
          },
        ];
      });
      const n = await insertFeedbackRows(mapped);
      inserted += n;
      console.log(`[feedback] ${from}..${to} fetched ${mapped.length} inserted ${n}`);
    }
    return inserted;
}

/**
 * 인앱 CSAT 반영. 원본(선택지·코멘트 포함)은 feedback_csat 에, 목록 필터용 점수·코멘트는 feedback_serving 에.
 * 본문은 건드리지 않는다. 반환값은 목록 행이 바뀐 스레드 수.
 */
export async function applyFeedbackCsat(records: CsatRecord[]): Promise<number> {
  let changed = 0;
  for (let i = 0; i < records.length; i += 1000) {
    const chunk = records.slice(i, i + 1000).filter((r) => r.csatId && r.phoneInquiryId);
    if (!chunk.length) continue;
    await servingQuery(
      `
      insert into feedback_csat (csat_id, thread_id, csat_rate, payload_json, pulled_at)
      select u.csat_id, u.thread_id, u.csat_rate, u.payload_json::jsonb, now()
      from unnest($1::text[], $2::text[], $3::float8[], $4::text[]) as u(csat_id, thread_id, csat_rate, payload_json)
      on conflict (csat_id) do update set
        thread_id = excluded.thread_id,
        csat_rate = excluded.csat_rate,
        payload_json = excluded.payload_json,
        pulled_at = now()
      where feedback_csat.payload_json is distinct from excluded.payload_json
      `,
      [
        chunk.map((r) => r.csatId),
        chunk.map((r) => r.phoneInquiryId),
        chunk.map((r) => r.rate),
        chunk.map((r) => JSON.stringify(r)),
      ],
    );
    const res = await servingQuery<{ thread_id: string }>(
      `
      update feedback_serving f set
        csat_id = u.csat_id,
        csat_rate = u.csat_rate,
        csat_comment = nullif(u.csat_comment, '')
      from unnest($1::text[], $2::text[], $3::float8[], $4::text[]) as u(thread_id, csat_id, csat_rate, csat_comment)
      where f.thread_id = u.thread_id
        and (f.csat_id, f.csat_rate, f.csat_comment) is distinct from (u.csat_id, u.csat_rate, nullif(u.csat_comment, ''))
      returning f.thread_id
      `,
      [
        chunk.map((r) => r.phoneInquiryId),
        chunk.map((r) => r.csatId),
        chunk.map((r) => r.rate),
        chunk.map((r) => r.comment ?? ""),
      ],
    );
    changed += res.length;
  }
  return changed;
}

/** 인앱 CSAT 상세. 없으면 null (pull 전이거나 설문 없음). */
export async function getServingFeedbackCsat(csatId: string): Promise<CsatRecord | null> {
  const id = csatId.trim();
  if (!id) return null;
  const rows = await servingQuery<{ payload_json: CsatRecord | string }>(
    `select payload_json from feedback_csat where csat_id = $1`,
    [id],
  );
  const raw = rows[0]?.payload_json;
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as CsatRecord) : raw;
}

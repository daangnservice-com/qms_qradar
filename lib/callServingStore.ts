// 콜 목록 인덱스 조회·원천 컬럼 적재. 온디맨드 경로는 이 파일만 Postgres를 친다.
import type { CsatRecord } from "./csat";
import type { EvaluationSample, SampleFilters, SttSource } from "./types";
import { servingQuery } from "./servingDb";

const SNIPPET_MAX = 200;

export type ServingListMeta = {
  longEnabled: boolean;
  longMinutes: number | null;
  longMinMinutes: number | null;
  longKey: string;
  dsatEnabled: boolean;
  dsatMax: number;
  dsatKey: string;
};

const DEFAULT_META: ServingListMeta = {
  longEnabled: false,
  longMinutes: null,
  longMinMinutes: null,
  longKey: "long_call",
  dsatEnabled: true,
  dsatMax: 2,
  dsatKey: "dsat",
};

const KEYS_SQL = `
  (
    select coalesce(array_agg(distinct k), '{}')
    from unnest(
      coalesce(s.eval_flag_keys, '{}'::text[])
      || case
           when meta.dsat_enabled and s.csat_rate is not null and s.csat_rate <= meta.dsat_max
           then array[meta.dsat_key]::text[]
           else '{}'::text[]
         end
      || case
           when meta.long_enabled
            and meta.long_minutes is not null
            and s.duration_sec is not null
            and s.duration_sec > 0
            and (meta.long_min_minutes is null or s.duration_sec / 60.0 >= meta.long_min_minutes)
            and s.duration_sec / 60.0 >= meta.long_minutes
           then array[meta.long_key]::text[]
           else '{}'::text[]
         end
    ) as k
  )
`;

const META_SQL = `
  cross join (
    select
      coalesce((select (value_json->>'enabled')::boolean from serving_meta where key = 'long_call'), false) as long_enabled,
      (select (value_json->>'thresholdMinutes')::double precision from serving_meta where key = 'long_call') as long_minutes,
      (select (value_json->>'minMinutes')::double precision from serving_meta where key = 'long_call') as long_min_minutes,
      coalesce((select value_json->>'key' from serving_meta where key = 'long_call'), 'long_call') as long_key,
      coalesce((select (value_json->>'enabled')::boolean from serving_meta where key = 'dsat'), true) as dsat_enabled,
      coalesce((select (value_json->>'maxRate')::int from serving_meta where key = 'dsat'), 2) as dsat_max,
      coalesce((select value_json->>'key' from serving_meta where key = 'dsat'), 'dsat') as dsat_key
  ) meta
`;

function clean(a?: string[]): string[] {
  return (a ?? []).map((s) => s.trim()).filter(Boolean);
}

export type ServingListPlan =
  | { empty: true }
  | { empty: false; text: string; values: unknown[] };

export function buildServingListQuery(input: {
  filters: SampleFilters;
  limit: number;
  mineEmail?: string | null;
  reviewRequestIds?: string[] | null;
}): ServingListPlan {
  const filters = input.filters ?? {};
  const limit = Math.min(Math.max(Math.floor(input.limit) || 100, 1), 500);
  if (filters.reviewRequestedOnly && !(input.reviewRequestIds ?? []).length) return { empty: true };
  if (filters.mineOnly && !input.mineEmail?.trim()) return { empty: true };

  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  };
  const addArr = (column: string, vals: string[]) => {
    if (!vals.length) return;
    values.push(vals);
    where.push(`${column} = any($${values.length}::text[])`);
  };

  addArr("listed.conversation_id", clean(filters.conversationIds));
  addArr("listed.phone_inquiry_id", clean(filters.phoneInquiryIds));
  addArr("listed.admin_user_id", clean(filters.adminUserIds));
  addArr("listed.admin_name", clean(filters.adminNames));
  addArr("listed.team", clean(filters.teams));
  addArr("listed.category", clean(filters.categories));
  if (filters.callDateStart) add("listed.call_date_kst >= ?::date", filters.callDateStart);
  if (filters.callDateEnd) add("listed.call_date_kst <= ?::date", filters.callDateEnd);
  if (filters.callLenMin != null) add("listed.minutes_taken >= ?", filters.callLenMin);
  if (filters.callLenMax != null) add("listed.minutes_taken <= ?", filters.callLenMax);
  if (filters.analyzedOnly && !filters.reviewStatus) where.push("listed.analyzed");
  if (filters.reviewStatus === "completed") where.push("listed.review_completed");
  if (filters.reviewStatus === "incomplete") where.push("not listed.review_completed");
  if (filters.sttStatus === "present") where.push("listed.has_stt");
  if (filters.sttStatus === "absent") where.push("not listed.has_stt");

  const rates = (filters.csatRates ?? []).filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);
  const includeNone = filters.csatIncludeNone === true;
  if (rates.length || includeNone) {
    const parts: string[] = [];
    if (rates.length) {
      values.push(rates);
      parts.push(`listed.csat_rate = any($${values.length}::int[])`);
    }
    if (includeNone) parts.push("listed.csat_rate is null");
    where.push(`(${parts.join(" or ")})`);
  }

  if (filters.mineOnly) {
    values.push(input.mineEmail!.trim().toLowerCase());
    const p = `$${values.length}`;
    where.push(
      `(lower(listed.review_claimed_by) = ${p} or ${p} = any(listed.reviewer_emails_lower)) and not listed.review_completed`,
    );
  }
  if (filters.reviewRequestedOnly) {
    values.push(input.reviewRequestIds ?? []);
    where.push(`listed.conversation_id = any($${values.length}::text[])`);
  }

  const picked = clean(filters.highRiskFlagKeys);
  if (picked.length) {
    values.push(picked);
    where.push(`listed.high_risk_flag_keys && $${values.length}::text[]`);
  } else if (filters.highRiskOnly) {
    where.push("cardinality(listed.high_risk_flag_keys) > 0");
  }

  values.push(limit);
  const text = `
    select * from (
      select
        s.*,
        (select coalesce(array_agg(lower(e)), '{}') from unnest(coalesce(s.reviewer_emails, '{}'::text[])) e) as reviewer_emails_lower,
        ${KEYS_SQL} as high_risk_flag_keys
      from call_serving s
      ${META_SQL}
    ) listed
    ${where.length ? `where ${where.join("\n      and ")}` : ""}
    order by listed.inquiry_created_at_kst desc nulls last
    limit $${values.length}
  `;
  return { empty: false, text, values };
}

function dateOnly(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function iso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowToServingSample(r: Record<string, unknown>): EvaluationSample {
  const keys = Array.isArray(r.high_risk_flag_keys) ? r.high_risk_flag_keys.map((k) => String(k)) : [];
  const stt = r.stt_source != null ? String(r.stt_source) : null;
  return {
    conversationId: String(r.conversation_id ?? ""),
    phoneInquiryId: r.phone_inquiry_id ? String(r.phone_inquiry_id) : "",
    adminName: r.admin_name ? String(r.admin_name) : "",
    team: r.team ? String(r.team) : "",
    category: r.category ? String(r.category) : "",
    callDate: dateOnly(r.call_date_kst),
    callStartKst: r.call_start_kst ? String(r.call_start_kst) : "",
    contentSnippet: r.content_snippet ? String(r.content_snippet).slice(0, SNIPPET_MAX) : "",
    callDurationSec: numOrNull(r.duration_sec),
    analyzed: r.analyzed === true,
    reviewCompleted: r.review_completed === true,
    aiLabel: r.ai_label != null ? String(r.ai_label) : null,
    humanResult: r.human_result != null ? String(r.human_result) : null,
    highRiskFlagKeys: keys,
    csatRate: numOrNull(r.csat_rate),
    reviewClaimedBy: r.review_claimed_by ? String(r.review_claimed_by) : null,
    reviewClaimedAt: iso(r.review_claimed_at),
    hasStt: r.has_stt === true,
    sttSource: (stt as SttSource | null) ?? null,
  };
}

export async function listServingSamples(input: {
  filters?: SampleFilters;
  limit?: number;
  mineEmail?: string | null;
  reviewRequestIds?: string[] | null;
}): Promise<EvaluationSample[]> {
  const plan = buildServingListQuery({
    filters: input.filters ?? {},
    limit: input.limit ?? 100,
    mineEmail: input.mineEmail,
    reviewRequestIds: input.reviewRequestIds,
  });
  if (plan.empty) return [];
  const rows = await servingQuery<Record<string, unknown>>(plan.text, plan.values);
  return rows.map(rowToServingSample);
}

export async function listServingFilterOptions(): Promise<{
  teamAgents: { team: string; name: string }[];
  categories: string[];
}> {
  const [pairs, cats] = await Promise.all([
    servingQuery<{ team: string; name: string }>(`
      select distinct team, admin_name as name
      from call_serving
      where admin_name <> ''
      order by team, admin_name
    `),
    servingQuery<{ category: string }>(`
      select distinct category
      from call_serving
      where category <> ''
      order by category
    `),
  ]);
  return {
    teamAgents: pairs.map((r) => ({ team: r.team ?? "", name: r.name })),
    categories: cats.map((r) => r.category),
  };
}

export async function listServingCaseMeta(
  conversationIds: string[],
): Promise<Map<string, { adminName: string; callDate: string }>> {
  const ids = [...new Set(conversationIds.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, { adminName: string; callDate: string }>();
  if (!ids.length) return out;
  const rows = await servingQuery<{ conversation_id: string; admin_name: string; call_date_kst: unknown }>(
    `select conversation_id, admin_name, call_date_kst from call_serving where conversation_id = any($1::text[])`,
    [ids],
  );
  for (const r of rows) {
    out.set(r.conversation_id, { adminName: r.admin_name ?? "", callDate: dateOnly(r.call_date_kst) });
  }
  return out;
}

export async function servingPhoneInquiryId(conversationId: string): Promise<string | null> {
  const id = conversationId.trim();
  if (!id) return null;
  const rows = await servingQuery<{ phone_inquiry_id: string }>(
    `select phone_inquiry_id from call_serving where conversation_id = $1 and phone_inquiry_id <> '' limit 1`,
    [id],
  );
  return rows[0]?.phone_inquiry_id ?? null;
}

export async function getServingCsat(phoneInquiryId: string): Promise<CsatRecord | null> {
  const id = phoneInquiryId.trim();
  if (!id) return null;
  const rows = await servingQuery<{ payload_json: CsatRecord | string | null }>(
    `select payload_json from serving_csat_assignments where phone_inquiry_id = $1`,
    [id],
  );
  const raw = rows[0]?.payload_json;
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as CsatRecord) : raw;
}

export async function servingConversationByInquiry(
  phoneInquiryId: string,
): Promise<{ conversationId: string; phoneInquiryId: string } | null> {
  const id = phoneInquiryId.trim();
  if (!id) return null;
  const rows = await servingQuery<{ conversation_id: string; phone_inquiry_id: string }>(
    `select conversation_id, phone_inquiry_id from call_serving where phone_inquiry_id = $1 order by inquiry_created_at_kst desc nulls last limit 1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return { conversationId: r.conversation_id, phoneInquiryId: r.phone_inquiry_id };
}

export type CallSourceRow = {
  conversationId: string;
  phoneInquiryId: string;
  adminUserId: string | null;
  adminName: string;
  team: string;
  category: string;
  contentSnippet: string;
  callDateKst: string | null;
  callStartKst: string;
  durationSec: number | null;
  minutesTaken: number | null;
  inquiryCreatedAtKst: string | null;
  yearMonth: string | null;
};

const UPSERT_CHUNK = 1000;

function chunks<T>(rows: T[], size = UPSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * 원천 컬럼만 upsert. 검수·평가·찜 컬럼은 유지한다.
 * 값이 같으면 행을 다시 쓰지 않는다(전량 재스캔이 매번 수만 행을 갱신하지 않게).
 * 반환값은 새로 넣거나 바뀐 행 수.
 */
export async function upsertCallSources(rows: CallSourceRow[]): Promise<number> {
  const byId = new Map(rows.filter((r) => r.conversationId).map((r) => [r.conversationId, r]));
  let n = 0;
  for (const chunk of chunks([...byId.values()])) {
    const res = await servingQuery<{ conversation_id: string }>(
      `
      insert into call_serving (
        conversation_id, phone_inquiry_id, admin_user_id, admin_name, team, category,
        content_snippet, call_date_kst, call_start_kst, duration_sec, minutes_taken,
        inquiry_created_at_kst, year_month, source_pulled_at
      )
      select
        u.conversation_id, u.phone_inquiry_id, u.admin_user_id, u.admin_name, u.team, u.category,
        u.content_snippet, u.call_date_kst::date, u.call_start_kst, u.duration_sec, u.minutes_taken,
        u.inquiry_created_at_kst::timestamptz, u.year_month::date, now()
      from unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
        $7::text[], $8::text[], $9::text[], $10::int[], $11::float8[], $12::text[], $13::text[]
      ) as u(
        conversation_id, phone_inquiry_id, admin_user_id, admin_name, team, category,
        content_snippet, call_date_kst, call_start_kst, duration_sec, minutes_taken,
        inquiry_created_at_kst, year_month
      )
      on conflict (conversation_id) do update set
        phone_inquiry_id = excluded.phone_inquiry_id,
        admin_user_id = excluded.admin_user_id,
        admin_name = excluded.admin_name,
        team = excluded.team,
        category = excluded.category,
        content_snippet = excluded.content_snippet,
        call_date_kst = excluded.call_date_kst,
        call_start_kst = excluded.call_start_kst,
        duration_sec = excluded.duration_sec,
        minutes_taken = excluded.minutes_taken,
        inquiry_created_at_kst = excluded.inquiry_created_at_kst,
        year_month = excluded.year_month,
        source_pulled_at = now()
      where (
        call_serving.phone_inquiry_id, call_serving.admin_user_id, call_serving.admin_name,
        call_serving.team, call_serving.category, call_serving.content_snippet,
        call_serving.call_date_kst, call_serving.call_start_kst, call_serving.duration_sec,
        call_serving.minutes_taken, call_serving.inquiry_created_at_kst, call_serving.year_month
      ) is distinct from (
        excluded.phone_inquiry_id, excluded.admin_user_id, excluded.admin_name,
        excluded.team, excluded.category, excluded.content_snippet,
        excluded.call_date_kst, excluded.call_start_kst, excluded.duration_sec,
        excluded.minutes_taken, excluded.inquiry_created_at_kst, excluded.year_month
      )
      returning conversation_id
      `,
      [
        chunk.map((r) => r.conversationId),
        chunk.map((r) => r.phoneInquiryId),
        chunk.map((r) => r.adminUserId),
        chunk.map((r) => r.adminName),
        chunk.map((r) => r.team),
        chunk.map((r) => r.category),
        chunk.map((r) => r.contentSnippet.slice(0, SNIPPET_MAX)),
        chunk.map((r) => r.callDateKst),
        chunk.map((r) => r.callStartKst),
        chunk.map((r) => (r.durationSec == null ? null : Math.round(r.durationSec))),
        chunk.map((r) => r.minutesTaken),
        chunk.map((r) => r.inquiryCreatedAtKst),
        chunk.map((r) => r.yearMonth),
      ],
    );
    n += res.length;
  }
  return n;
}

/**
 * 전화 CSAT 반영. 점수나 통화 연결이 바뀐 행만 exported_at 을 비워 다시 덤프한다.
 * 반환값은 새로 넣거나 바뀐 행 수.
 */
export async function applyCsatRates(
  rows: Array<{ phoneInquiryId: string; conversationId: string | null; rate: number | null; payload?: CsatRecord | null }>,
): Promise<number> {
  const byId = new Map(rows.filter((r) => r.phoneInquiryId).map((r) => [r.phoneInquiryId, r]));
  let n = 0;
  for (const chunk of chunks([...byId.values()])) {
    const changed = await servingQuery<{ phone_inquiry_id: string }>(
      `
      insert into serving_csat_assignments
        (phone_inquiry_id, conversation_id, csat_rate, assigned_at, exported_at, payload_json)
      select u.phone_inquiry_id, u.conversation_id, u.csat_rate, now(), null, u.payload_json::jsonb
      from unnest($1::text[], $2::text[], $3::int[], $4::text[])
        as u(phone_inquiry_id, conversation_id, csat_rate, payload_json)
      on conflict (phone_inquiry_id) do update set
        conversation_id = coalesce(excluded.conversation_id, serving_csat_assignments.conversation_id),
        csat_rate = excluded.csat_rate,
        payload_json = excluded.payload_json,
        assigned_at = case
          when serving_csat_assignments.csat_rate is distinct from excluded.csat_rate
            or serving_csat_assignments.conversation_id is distinct from coalesce(excluded.conversation_id, serving_csat_assignments.conversation_id)
          then now()
          else serving_csat_assignments.assigned_at
        end,
        exported_at = case
          when serving_csat_assignments.csat_rate is distinct from excluded.csat_rate
            or serving_csat_assignments.conversation_id is distinct from coalesce(excluded.conversation_id, serving_csat_assignments.conversation_id)
          then null
          else serving_csat_assignments.exported_at
        end
      where serving_csat_assignments.csat_rate is distinct from excluded.csat_rate
        or serving_csat_assignments.conversation_id is distinct from coalesce(excluded.conversation_id, serving_csat_assignments.conversation_id)
        or serving_csat_assignments.payload_json is distinct from excluded.payload_json
      returning phone_inquiry_id
      `,
      [
        chunk.map((r) => r.phoneInquiryId),
        chunk.map((r) => r.conversationId),
        chunk.map((r) => (r.rate == null ? null : Math.round(r.rate))),
        chunk.map((r) => (r.payload ? JSON.stringify(r.payload) : null)),
      ],
    );
    await servingQuery(
      `
      update call_serving c set csat_rate = u.csat_rate, updated_at = now()
      from unnest($1::text[], $2::int[]) as u(phone_inquiry_id, csat_rate)
      where c.phone_inquiry_id = u.phone_inquiry_id
        and c.csat_rate is distinct from u.csat_rate
      `,
      [chunk.map((r) => r.phoneInquiryId), chunk.map((r) => (r.rate == null ? null : Math.round(r.rate)))],
    );
    n += changed.length;
  }
  return n;
}

export async function patchCallApp(
  conversationId: string,
  patch: {
    analyzed?: boolean;
    reviewCompleted?: boolean;
    aiLabel?: string | null;
    humanResult?: string | null;
    evalFlagKeys?: string[];
    hasStt?: boolean;
    sttSource?: string | null;
    latestAnalysisId?: string | null;
    org?: string | null;
    phoneInquiryId?: string | null;
    clearClaim?: boolean;
  },
): Promise<void> {
  const id = conversationId.trim();
  if (!id) return;
  await servingQuery(
    `
    insert into call_serving (conversation_id, phone_inquiry_id)
    values ($1, coalesce($2, ''))
    on conflict (conversation_id) do nothing
    `,
    [id, patch.phoneInquiryId ?? ""],
  );
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.analyzed != null) set("analyzed", patch.analyzed);
  if (patch.reviewCompleted != null) set("review_completed", patch.reviewCompleted);
  if (patch.aiLabel !== undefined) set("ai_label", patch.aiLabel);
  if (patch.humanResult !== undefined) set("human_result", patch.humanResult);
  if (patch.evalFlagKeys) set("eval_flag_keys", patch.evalFlagKeys);
  if (patch.hasStt != null) set("has_stt", patch.hasStt);
  if (patch.sttSource !== undefined) set("stt_source", patch.sttSource);
  if (patch.latestAnalysisId !== undefined) set("latest_analysis_id", patch.latestAnalysisId);
  if (patch.org !== undefined) set("org", patch.org);
  if (patch.phoneInquiryId) set("phone_inquiry_id", patch.phoneInquiryId);
  if (patch.clearClaim) {
    sets.push("review_claimed_by = null", "review_claimed_at = null");
  }
  await servingQuery(`update call_serving set ${sets.join(", ")} where conversation_id = $1`, values);
}

export async function refreshReviewerEmails(conversationId: string): Promise<void> {
  const id = conversationId.trim();
  if (!id) return;
  await servingQuery(
    `
    insert into call_serving (conversation_id)
    values ($1)
    on conflict (conversation_id) do nothing
    `,
    [id],
  );
  await servingQuery(
    `
    update call_serving set
      reviewer_emails = coalesce((
        select array_agg(distinct updated_by)
        from serving_human_reviews
        where conversation_id = $1
          and not deleted
          and updated_by is not null
          and updated_by <> ''
      ), '{}'),
      updated_at = now()
    where conversation_id = $1
    `,
    [id],
  );
}

export async function saveServingMeta(key: string, value: unknown): Promise<void> {
  await servingQuery(
    `
    insert into serving_meta (key, value_json, updated_at)
    values ($1, $2::jsonb, now())
    on conflict (key) do update set value_json = excluded.value_json, updated_at = now()
    `,
    [key, JSON.stringify(value)],
  );
}

export { DEFAULT_META };

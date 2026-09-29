// BQ SSOT → Postgres pull, Postgres → BQ 덤프. 요청 경로에서는 부르지 않는다.
import { getBQ } from "./bigquery";
import { growthBq, qradarTable } from "./bqRefs";
import { CASES_SINCE } from "./evaluationCasesSql";
import { PHONE_SOURCE_SYSTEM } from "./evaluationChannel";
import { listHighRiskFlagRules } from "./highRiskFlagStore";
import { getOrRefreshLongCallThreshold } from "./longCallThresholdStore";
import { resolveDsatRule } from "./highRiskFlags";
import {
  applyCsatRates,
  saveServingMeta,
  upsertCallSources,
  type CallSourceRow,
} from "./callServingStore";
import { getServingPool, servingConfigured, servingQuery } from "./servingDb";

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

function bqStr(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) return String((v as { value: unknown }).value);
  return v == null ? "" : String(v);
}

function bqNum(v: unknown): number | null {
  const n = Number(bqStr(v));
  return Number.isFinite(n) ? n : null;
}

function jsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  const text = bqStr(v);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function flagKeysFromAttrs(raw: unknown): string[] {
  const flags = jsonObj(raw).highRiskFlags;
  if (!Array.isArray(flags)) return [];
  return flags
    .map((f) => (f && typeof f === "object" ? String((f as { key?: unknown }).key ?? "") : ""))
    .filter(Boolean);
}

function sttFromRow(r: Record<string, unknown>): string | null {
  const s =
    bqStr(jsonObj(r.channel_attrs_json).sttSource) ||
    bqStr(jsonObj(r.result_json).sttSource) ||
    bqStr(r.stt_source);
  return s || null;
}

async function markJob(job: string, error: string | null): Promise<void> {
  await servingQuery(
    `
    insert into serving_sync_state (job, last_run_at, last_error)
    values ($1, now(), $2)
    on conflict (job) do update set last_run_at = now(), last_error = excluded.last_error
    `,
    [job, error],
  );
}

/** 콜 원천 pull. `sinceDays`를 주면 그 기간에 생성된 상담이력만, 없으면 전량 재스캔. */
export async function pullCallSources(opts?: { sinceDays?: number }): Promise<number> {
  const since = opts?.sinceDays
    ? `and inquiry_created_at_kst >= datetime_sub(current_datetime('Asia/Seoul'), interval ${Math.max(1, Math.floor(opts.sinceDays))} day)`
    : "";
  const [rows] = await getBQ().query({
    query: `
      select
        genesys_conversation_id as conversation_id,
        cast(phone_inquiry_id as string) as phone_inquiry_id,
        cast(admin_user_id as string) as admin_user_id,
        admin_name,
        team,
        category,
        content,
        format_date('%F', call_date_kst) as call_date_kst,
        format_datetime('%F %T', call_start_kst) as call_start_kst,
        duration_sec,
        minutes_taken,
        format_datetime('%FT%T', inquiry_created_at_kst) as inquiry_created_at_kst,
        format_date('%F', year_month) as year_month
      from ${growthBq.casesSql()}
      where ${CASES_SINCE}
        and genesys_conversation_id is not null
        ${since}
      qualify row_number() over (
        partition by genesys_conversation_id
        order by inquiry_created_at_kst desc
      ) = 1
    `,
    ...loc(),
  });
  const mapped: CallSourceRow[] = (rows as Record<string, unknown>[]).map((r) => {
    const created = bqStr(r.inquiry_created_at_kst);
    return {
      conversationId: bqStr(r.conversation_id),
      phoneInquiryId: bqStr(r.phone_inquiry_id),
      adminUserId: bqStr(r.admin_user_id) || null,
      adminName: bqStr(r.admin_name),
      team: bqStr(r.team),
      category: bqStr(r.category),
      contentSnippet: bqStr(r.content),
      callDateKst: bqStr(r.call_date_kst) || null,
      callStartKst: bqStr(r.call_start_kst),
      durationSec: bqNum(r.duration_sec),
      minutesTaken: bqNum(r.minutes_taken),
      inquiryCreatedAtKst: created ? `${created}+09` : null,
      yearMonth: bqStr(r.year_month) || null,
    };
  }).filter((r) => r.conversationId);
  const n = await upsertCallSources(mapped);
  console.log(`[servingSync] cases fetched ${mapped.length}, changed ${n}`);
  return n;
}

/** 인앱 문의 전량 pull 시작일. 원천 뷰는 날짜로 잘라도 읽는 양이 같아서 전화도 같은 날부터 읽는다. */
const CSAT_FULL_SINCE = "2025-02-01";

/**
 * 전화·인앱 CSAT pull. 원천 뷰가 쿼리마다 약 600MB를 읽어서 한 번에 둘 다 가져온다.
 * `sinceDays`를 주면 그 기간에 들어온 설문만(설문은 통화·문의 뒤 늦게 온다), 없으면 전량.
 */
export async function pullCsat(opts?: { sinceDays?: number }): Promise<number> {
  const { listCsatRecordsSince } = await import("./csatServer");
  const { applyFeedbackCsat } = await import("./feedbackServingStore");
  const records = await listCsatRecordsSince(
    opts?.sinceDays ? { sinceDays: opts.sinceDays } : { sinceDate: CSAT_FULL_SINCE },
  );
  const phone = records.filter((r) => r.inquiryType === "PhoneInquiry").map((r) => r.record);
  const feedback = records.filter((r) => r.inquiryType === "FeedbackThread").map((r) => r.record);

  const known = await servingQuery<{ phone_inquiry_id: string; conversation_id: string }>(
    `select phone_inquiry_id, conversation_id from call_serving where phone_inquiry_id = any($1::text[])`,
    [phone.map((r) => r.phoneInquiryId)],
  );
  const byInquiry = new Map(known.map((r) => [r.phone_inquiry_id, r.conversation_id]));
  const phoneChanged = await applyCsatRates(
    phone
      .filter((record) => byInquiry.has(record.phoneInquiryId))
      .map((record) => ({
        phoneInquiryId: record.phoneInquiryId,
        conversationId: byInquiry.get(record.phoneInquiryId) ?? null,
        rate: record.rate,
        payload: record,
      })),
  );
  const feedbackChanged = await applyFeedbackCsat(feedback);
  console.log(
    `[servingSync] csat phone ${phone.length} (changed ${phoneChanged}), feedback ${feedback.length} (changed ${feedbackChanged})`,
  );
  return phoneChanged + feedbackChanged;
}

export async function pullServingMeta(): Promise<void> {
  const rules = await listHighRiskFlagRules({ channel: "phone" });
  const longRule = rules.find((r) => r.enabled && r.kind === "long_call_percentile");
  const dsat = resolveDsatRule(rules);
  const snap = longRule
    ? await getOrRefreshLongCallThreshold({
        percentile: Number(longRule.params.percentile ?? 10),
        ruleKey: longRule.key,
      })
    : null;
  await saveServingMeta("long_call", {
    enabled: Boolean(longRule && snap?.thresholdMinutes),
    thresholdMinutes: snap?.thresholdMinutes ?? null,
    minMinutes: longRule?.params.minMinutes ?? null,
    key: longRule?.key || "long_call",
  });
  await saveServingMeta("dsat", {
    enabled: dsat.enabled,
    maxRate: dsat.maxRate,
    key: dsat.key,
  });
}

async function bqRows(query: string): Promise<Record<string, unknown>[]> {
  const [rows] = await getBQ().query({ query, ...loc() });
  return rows as Record<string, unknown>[];
}

/**
 * BQ 평가 결과(전화·인앱)를 버전 전부 Postgres로 복사한다. 이미 있는 analysis_id 는 건드리지 않는다.
 * BQ에 있는 행이므로 exported_at 을 채우고, 서빙에만 있던 행 중 BQ에도 있는 것은 덤프 완료로 표시한다.
 * call_serving 은 건드리지 않는다.
 */
export async function backfillEvalResultHistory(): Promise<Record<string, unknown>[]> {
  const results = growthBq.resultsSql(growthBq.resultsTable);
  const resultRows = await bqRows(`
    select * from ${results}
    where source_id is not null and source_id != ''
  `);
  let inserted = 0;
  for (const r of resultRows) {
    const conversationId = bqStr(r.source_id) || bqStr(r.conversation_id);
    const analysisId = bqStr(r.analysis_id);
    if (!conversationId || !analysisId) continue;
    const record = {
      ...r,
      analysis_id: analysisId,
      conversation_id: conversationId,
      source_id: conversationId,
      analyzed_at: bqStr(r.analyzed_at),
      turns_json: bqStr(r.turns_json) || bqStr(r.transcript_json),
      transcript_json: bqStr(r.transcript_json) || bqStr(r.turns_json),
      result_json: typeof r.result_json === "string" ? r.result_json : JSON.stringify(r.result_json ?? {}),
    };
    const res = await servingQuery<{ analysis_id: string }>(
      `
      insert into serving_eval_results (
        analysis_id, conversation_id, org, purpose, analyzed_at, analyzed_by,
        prompt_version_id, prompt_version, ai_label, row_json, exported_at, channel, source_system
      ) values ($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10::jsonb, now(), $11, $12)
      on conflict (analysis_id) do nothing
      returning analysis_id
      `,
      [
        analysisId,
        conversationId,
        bqStr(r.org) || null,
        bqStr(r.purpose) || "call_eval",
        bqStr(r.analyzed_at),
        bqStr(r.analyzed_by) || null,
        bqStr(r.prompt_version_id) || null,
        bqStr(r.prompt_version) || null,
        bqStr(r.ai_label) || null,
        JSON.stringify(record),
        bqStr(r.channel) || "phone",
        bqStr(r.source_system) || null,
      ],
    );
    inserted += res.length;
  }
  await servingQuery(
    `update serving_eval_results set exported_at = now() where exported_at is null and analysis_id = any($1::text[])`,
    [resultRows.map((r) => bqStr(r.analysis_id)).filter(Boolean)],
  );
  console.log(`[backfill] results bq ${resultRows.length}, inserted ${inserted}`);
  return resultRows;
}

/** 이미 BQ에 있는 앱 행을 Postgres로 1회 복사한다. exported_at 을 채워 바로 다시 덤프하지 않는다. */
export async function backfillAppTables(): Promise<void> {
  const reviews = growthBq.resultsSql(growthBq.evalHumanReviews);
  const claims = growthBq.resultsSql(growthBq.evalReviewClaims);
  const completions = growthBq.resultsSql(growthBq.evalReviewCompletions);
  const sets = growthBq.resultsSql(growthBq.evalSetCriteria);

  console.log("[backfill] reviews");
  const reviewRows = await bqRows(`
    select * from ${reviews}
    qualify row_number() over (partition by annotation_id order by updated_at desc) = 1
  `);
  for (const r of reviewRows) {
    const payloadRaw = r.payload_json;
    const payload = typeof payloadRaw === "string" ? payloadRaw : JSON.stringify(payloadRaw ?? {});
    let parsed: { annotationId?: string; conversationId?: string } = {};
    try {
      parsed = JSON.parse(payload) as { annotationId?: string; conversationId?: string };
    } catch {
      parsed = {};
    }
    const annotationId = bqStr(r.annotation_id) || parsed.annotationId || "";
    const conversationId = bqStr(r.source_id) || bqStr(r.conversation_id) || parsed.conversationId || "";
    if (!annotationId || !conversationId) continue;
    await servingQuery(
      `
      insert into serving_human_reviews
        (annotation_id, conversation_id, payload_json, updated_at, updated_by, deleted, exported_at)
      values ($1, $2, $3::jsonb, $4::timestamptz, $5, $6, now())
      on conflict (annotation_id) do nothing
      `,
      [annotationId, conversationId, payload, bqStr(r.updated_at), bqStr(r.updated_by) || null, r.deleted === true],
    );
  }

  console.log(`[backfill] reviews ${reviewRows.length}`);
  const claimRows = await bqRows(`
    select * from ${claims}
    qualify row_number() over (
      partition by source_id
      order by claimed_at desc
    ) = 1
  `);
  for (const r of claimRows) {
    const conversationId = bqStr(r.source_id) || bqStr(r.conversation_id);
    if (!conversationId) continue;
    const active = r.active === true;
    await servingQuery(
      `
      insert into serving_review_claims (conversation_id, claimed_by, claimed_at, active, exported_at)
      values ($1, $2, $3::timestamptz, $4, now())
      on conflict (conversation_id) do nothing
      `,
      [conversationId, bqStr(r.claimed_by), bqStr(r.claimed_at), active],
    );
    if (active) {
      await servingQuery(
        `
        update call_serving set
          review_claimed_by = $2,
          review_claimed_at = $3::timestamptz
        where conversation_id = $1 and review_claimed_by is null
        `,
        [conversationId, bqStr(r.claimed_by), bqStr(r.claimed_at)],
      );
    }
  }

  console.log(`[backfill] claims ${claimRows.length}`);
  const completionRows = await bqRows(`
    select * from ${completions}
    qualify row_number() over (
      partition by source_id
      order by completed_at desc
    ) = 1
  `);
  for (const r of completionRows) {
    const conversationId = bqStr(r.source_id) || bqStr(r.conversation_id);
    if (!conversationId) continue;
    await servingQuery(
      `
      insert into serving_review_completions
        (conversation_id, completed_at, completed_by, analysis_id, org, exported_at)
      select $1, $2::timestamptz, $3, $4, $5, now()
      where not exists (
        select 1 from serving_review_completions
        where conversation_id = $1 and completed_at = $2::timestamptz
      )
      `,
      [conversationId, bqStr(r.completed_at), bqStr(r.completed_by), bqStr(r.analysis_id) || null, bqStr(r.org) || null],
    );
    await servingQuery(
      `update call_serving set review_completed = true where conversation_id = $1`,
      [conversationId],
    );
  }

  console.log(`[backfill] completions ${completionRows.length}`);
  const resultRows = await backfillEvalResultHistory();
  const latestByConv = new Map<string, Record<string, unknown>>();
  for (const r of resultRows) {
    if ((bqStr(r.channel) || "phone") !== "phone") continue;
    const id = bqStr(r.source_id) || bqStr(r.conversation_id);
    const prev = latestByConv.get(id);
    if (!prev || bqStr(r.analyzed_at) > bqStr(prev.analyzed_at)) latestByConv.set(id, r);
  }
  for (const [conversationId, r] of latestByConv) {
    const turns = bqStr(r.turns_json) || bqStr(r.transcript_json);
    await servingQuery(
      `
      update call_serving set
        analyzed = true,
        ai_label = coalesce($2, ai_label),
        latest_analysis_id = coalesce(latest_analysis_id, $3),
        has_stt = has_stt or $4,
        stt_source = coalesce(stt_source, $5),
        org = coalesce(org, $6),
        eval_flag_keys = $7::text[]
      where conversation_id = $1
      `,
      [
        conversationId,
        bqStr(r.ai_label) || null,
        bqStr(r.analysis_id),
        Boolean(turns && turns !== "[]"),
        sttFromRow(r),
        bqStr(r.org) || null,
        flagKeysFromAttrs(r.channel_attrs_json),
      ],
    );
  }

  console.log("[backfill] eval sets");
  const setRows = await bqRows(`select * from ${sets}`);
  for (const r of setRows) {
    const evalSetId = bqStr(r.eval_set_id);
    const criterionId = bqNum(r.criterion_id);
    if (!evalSetId || criterionId == null) continue;
    await servingQuery(
      `
      insert into serving_eval_sets
        (eval_set_id, criterion_id, criterion_prompt_id, sort_order, enabled, created_at, exported_at)
      values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), now())
      on conflict (eval_set_id, criterion_id) do nothing
      `,
      [
        evalSetId,
        criterionId,
        bqStr(r.criterion_prompt_id) || null,
        bqNum(r.sort_order) ?? 0,
        r.enabled !== false,
        bqStr(r.created_at) || null,
      ],
    );
  }

  await servingQuery(
    `
    update call_serving c set reviewer_emails = coalesce(s.emails, '{}')
    from (
      select conversation_id, array_agg(distinct updated_by) as emails
      from serving_human_reviews
      where not deleted and updated_by is not null and updated_by <> ''
      group by conversation_id
    ) s
    where c.conversation_id = s.conversation_id
    `,
  );
  await fillHumanResults();
  await markJob("backfill-app", null);
}

/** 검수 완료 건의 목록 라벨. 결과 JSON을 다시 쓰지 않고 현재 검수로 파생한다. */
async function fillHumanResults(): Promise<void> {
  const { listEvalReviewsByConversationIds } = await import("./evalReviewStore");
  const { checklistFromEvalPayload, deriveHumanReviewNeededLabel } = await import("./humanResultDerive");
  const done = await servingQuery<{ conversation_id: string }>(
    `select conversation_id from call_serving where review_completed`,
  );
  const ids = done.map((r) => r.conversation_id).filter(Boolean);
  if (!ids.length) return;
  const reviews = await listEvalReviewsByConversationIds(ids);
  const latest = await servingQuery<{ conversation_id: string; row_json: Record<string, unknown> | string }>(
    `
    select distinct on (conversation_id) conversation_id, row_json
    from serving_eval_results
    where conversation_id = any($1::text[])
    order by conversation_id, analyzed_at desc
    `,
    [ids],
  );
  const byId = new Map(latest.map((r) => [r.conversation_id, r.row_json]));
  for (const id of ids) {
    const raw = byId.get(id);
    const record = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw ?? {});
    const checklist = checklistFromEvalPayload({ resultJson: bqStr(record.result_json) || null });
    const humanResult = deriveHumanReviewNeededLabel(checklist, reviews.get(id) ?? []);
    if (!humanResult) continue;
    await servingQuery(
      `update call_serving set human_result = $2 where conversation_id = $1`,
      [id, humanResult],
    );
  }
}

type BqTypes = Record<string, string | string[]>;

async function queryBq(query: string, params: Record<string, unknown>, types: BqTypes): Promise<void> {
  await getBQ().query({ query, params, types, ...loc() });
}

function iso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function nullableStr(v: unknown): string | null {
  const s = bqStr(v);
  return s === "" ? null : s;
}

function jsonText(v: unknown): string | null {
  if (v == null || v === "") return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

async function pullQmsStatus(): Promise<number> {
  const { pullQmsEvalStatus } = await import("./qmsResultsSync");
  return pullQmsEvalStatus();
}

async function pullQmsResults(): Promise<number> {
  const { pullQmsCases } = await import("./qmsResultsSync");
  return pullQmsCases();
}

async function pullSourceCriteriaStep(): Promise<number> {
  const { pullSourceCriteria } = await import("./qmsResultsSync");
  return pullSourceCriteria();
}

async function pullQaReferencesStep(): Promise<number> {
  const { pullQaReferences } = await import("./qmsResultsSync");
  return pullQaReferences();
}

async function pullFeedback(opts?: { closedWithinDays?: number }): Promise<number> {
  const { pullFeedbackThreads } = await import("./feedbackServingStore");
  return pullFeedbackThreads(opts);
}

type BqColType = "STRING" | "INT64" | "FLOAT64" | "BOOL" | "TIMESTAMP";
type DumpRow = Record<string, string | number | boolean | null>;

/** 쿼리 파라미터 한도(10MB) 아래로 행을 나눈다. 전사 JSON이 커서 건수로는 못 자른다. */
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

function jsonColExpr(col: string, type: BqColType): string {
  const v = `json_value(j, '$.${col}')`;
  if (type === "TIMESTAMP") return `timestamp(${v})`;
  if (type === "STRING") return v;
  return `cast(${v} as ${type})`;
}

/**
 * 행을 JSON 문자열 배열 하나로 보내 BQ에 insert 한다.
 * 컬럼별 배열 파라미터는 NULL 원소를 받지 않아서, 값 하나만 비어도 덤프 전체가 멈춘다.
 * `skipExisting`을 주면 BQ에 같은 키가 이미 있는 행은 건너뛴다(재시도 중복 방지).
 */
async function insertJsonRows(
  tableSql: string,
  cols: Record<string, BqColType>,
  rows: DumpRow[],
  skipExisting?: { key: string; recentCol: string },
): Promise<void> {
  if (!rows.length) return;
  const names = Object.keys(cols);
  const select = names.map((c) => `${jsonColExpr(c, cols[c])} as ${c}`).join(",\n            ");
  const guard = skipExisting
    ? `
        where not exists (
          select 1 from ${tableSql} t
          where t.${skipExisting.recentCol} >= timestamp_sub(timestamp(@min_at), interval 1 day)
            and t.${skipExisting.key} = src.${skipExisting.key}
        )`
    : "";
  for (const chunk of chunkByBytes(rows.map((r) => JSON.stringify(r)))) {
    const params: Record<string, unknown> = { rows: chunk };
    const types: BqTypes = { rows: ["STRING"] };
    if (skipExisting) {
      params.min_at = chunk
        .map((r) => String((JSON.parse(r) as DumpRow)[skipExisting.recentCol] ?? ""))
        .filter(Boolean)
        .reduce((m, v) => (v < m ? v : m), new Date().toISOString());
      types.min_at = "STRING";
    }
    await queryBq(
      `
      insert into ${tableSql} (${names.join(", ")})
      select ${names.map((c) => `src.${c}`).join(", ")}
      from (
        select
            ${select}
        from unnest(@rows) as j
      ) src${guard}
      `,
      params,
      types,
    );
  }
}

/** exported_at 이 빈 행을 batch 단위로 덤프하고 표시한다. */
async function drainPending<T extends Record<string, unknown>>(opts: {
  label: string;
  select: string;
  batch: number;
  toRow: (r: T) => DumpRow;
  insert: (rows: DumpRow[]) => Promise<void>;
  /** 덤프한 값 그대로일 때만 표시한다. 그 사이 바뀐 행은 다음 덤프로 넘어간다. */
  markSql: string;
  markParams: (rows: T[]) => unknown[];
}): Promise<void> {
  for (;;) {
    const pending = await servingQuery<T>(`${opts.select} limit ${opts.batch}`);
    if (!pending.length) break;
    await opts.insert(pending.map(opts.toRow));
    await servingQuery(opts.markSql, opts.markParams(pending));
    console.log(`[servingSync] exported ${opts.label} ${pending.length}`);
    if (pending.length < opts.batch) break;
  }
}

async function exportEvalResults(): Promise<void> {
  const { ensureEvalResultsTable } = await import("./evalResultStore");
  await ensureEvalResultsTable();
  const resultsSql = growthBq.resultsSql(growthBq.resultsTable);
  await drainPending<{ analysis_id: string; row_json: Record<string, unknown> | string }>({
    label: "eval results",
    select: `select analysis_id, row_json from serving_eval_results where exported_at is null order by analyzed_at`,
    batch: 200,
    toRow: (p) => {
      const r = typeof p.row_json === "string" ? (JSON.parse(p.row_json) as Record<string, unknown>) : p.row_json;
      return {
        analysis_id: p.analysis_id,
        analyzed_at: iso(r.analyzed_at) ?? new Date().toISOString(),
        channel: bqStr(r.channel) || "phone",
        source_system: bqStr(r.source_system) || PHONE_SOURCE_SYSTEM,
        source_id: bqStr(r.source_id) || bqStr(r.conversation_id),
        org: nullableStr(r.org),
        purpose: bqStr(r.purpose) || "call_eval",
        analyzed_by: nullableStr(r.analyzed_by),
        model: nullableStr(r.model),
        prompt_version_id: nullableStr(r.prompt_version_id),
        prompt_version: nullableStr(r.prompt_version),
        ai_label: r.ai_label == null ? null : bqStr(r.ai_label),
        turns_json: jsonText(r.turns_json) ?? jsonText(r.transcript_json),
        input_snapshot_json: jsonText(r.input_snapshot_json),
        channel_attrs_json: jsonText(r.channel_attrs_json),
        result_json: jsonText(r.result_json) ?? "{}",
        llm_call_id: nullableStr(r.llm_call_id),
        error: nullableStr(r.error),
      };
    },
    insert: (rows) =>
      insertJsonRows(
        resultsSql,
        {
          analysis_id: "STRING",
          analyzed_at: "TIMESTAMP",
          channel: "STRING",
          source_system: "STRING",
          source_id: "STRING",
          org: "STRING",
          purpose: "STRING",
          analyzed_by: "STRING",
          model: "STRING",
          prompt_version_id: "STRING",
          prompt_version: "STRING",
          ai_label: "STRING",
          turns_json: "STRING",
          input_snapshot_json: "STRING",
          channel_attrs_json: "STRING",
          result_json: "STRING",
          llm_call_id: "STRING",
          error: "STRING",
        },
        rows,
        { key: "analysis_id", recentCol: "analyzed_at" },
      ),
    markSql: `update serving_eval_results set exported_at = now() where analysis_id = any($1::text[])`,
    markParams: (rows) => [rows.map((p) => p.analysis_id)],
  });
}

async function exportHumanReviews(): Promise<void> {
  const sql = growthBq.resultsSql(growthBq.evalHumanReviews);
  await drainPending<Record<string, unknown>>({
    label: "reviews",
    select: `select * from serving_human_reviews where exported_at is null order by updated_at`,
    batch: 500,
    toRow: (r) => ({
      annotation_id: String(r.annotation_id),
      channel: "phone",
      source_system: PHONE_SOURCE_SYSTEM,
      source_id: String(r.conversation_id),
      payload_json: jsonText(r.payload_json) ?? "{}",
      updated_at: iso(r.updated_at),
      updated_by: nullableStr(r.updated_by),
      deleted: r.deleted === true,
    }),
    insert: (rows) =>
      insertJsonRows(sql, {
        annotation_id: "STRING",
        channel: "STRING",
        source_system: "STRING",
        source_id: "STRING",
        payload_json: "STRING",
        updated_at: "TIMESTAMP",
        updated_by: "STRING",
        deleted: "BOOL",
      }, rows),
    markSql: `
      update serving_human_reviews t set exported_at = now()
      from unnest($1::text[], $2::timestamptz[]) as u(annotation_id, updated_at)
      where t.annotation_id = u.annotation_id and t.updated_at = u.updated_at
    `,
    markParams: (rows) => [rows.map((r) => String(r.annotation_id)), rows.map((r) => iso(r.updated_at))],
  });
}

async function exportReviewCompletions(): Promise<void> {
  const sql = growthBq.resultsSql(growthBq.evalReviewCompletions);
  await drainPending<Record<string, unknown>>({
    label: "completions",
    select: `select * from serving_review_completions where exported_at is null order by completed_at`,
    batch: 500,
    toRow: (r) => ({
      channel: "phone",
      source_system: PHONE_SOURCE_SYSTEM,
      source_id: String(r.conversation_id),
      completed_at: iso(r.completed_at),
      completed_by: bqStr(r.completed_by),
      analysis_id: nullableStr(r.analysis_id),
      org: nullableStr(r.org),
    }),
    insert: (rows) =>
      insertJsonRows(sql, {
        channel: "STRING",
        source_system: "STRING",
        source_id: "STRING",
        completed_at: "TIMESTAMP",
        completed_by: "STRING",
        analysis_id: "STRING",
        org: "STRING",
      }, rows),
    markSql: `update serving_review_completions set exported_at = now() where id = any($1::bigint[])`,
    markParams: (rows) => [rows.map((r) => r.id)],
  });
}

/** 찜 상태 변경 이력. BQ 쪽은 append 이벤트이고 최신 행이 현재 상태다. */
async function exportReviewClaims(): Promise<void> {
  const sql = growthBq.resultsSql(growthBq.evalReviewClaims);
  await drainPending<Record<string, unknown>>({
    label: "claims",
    select: `select * from serving_review_claims where exported_at is null order by claimed_at`,
    batch: 500,
    toRow: (r) => ({
      channel: "phone",
      source_system: PHONE_SOURCE_SYSTEM,
      source_id: String(r.conversation_id),
      claimed_by: bqStr(r.claimed_by),
      claimed_at: iso(r.claimed_at),
      active: r.active === true,
    }),
    insert: (rows) =>
      insertJsonRows(sql, {
        channel: "STRING",
        source_system: "STRING",
        source_id: "STRING",
        claimed_by: "STRING",
        claimed_at: "TIMESTAMP",
        active: "BOOL",
      }, rows),
    // 완료 처리는 claimed_at 을 그대로 두고 active 만 끈다. 그래서 active 까지 비교한다.
    markSql: `
      update serving_review_claims t set exported_at = now()
      from unnest($1::text[], $2::text[], $3::timestamptz[], $4::boolean[]) as u(conversation_id, claimed_by, claimed_at, active)
      where t.conversation_id = u.conversation_id
        and t.claimed_by = u.claimed_by
        and t.claimed_at = u.claimed_at
        and t.active = u.active
    `,
    markParams: (rows) => [
      rows.map((r) => String(r.conversation_id)),
      rows.map((r) => bqStr(r.claimed_by)),
      rows.map((r) => iso(r.claimed_at)),
      rows.map((r) => r.active === true),
    ],
  });
}

async function exportCsatAssignments(): Promise<void> {
  const sql = growthBq.resultsSql(qradarTable("csat_assignments"));
  await getBQ().query({
    query: `
      create table if not exists ${sql} (
        phone_inquiry_id STRING,
        conversation_id STRING,
        csat_rate INT64,
        assigned_at TIMESTAMP
      )
    `,
    ...loc(),
  });
  await drainPending<Record<string, unknown>>({
    label: "csat",
    select: `select * from serving_csat_assignments where exported_at is null order by phone_inquiry_id`,
    batch: 1000,
    toRow: (r) => ({
      phone_inquiry_id: String(r.phone_inquiry_id),
      conversation_id: nullableStr(r.conversation_id),
      csat_rate: r.csat_rate == null ? null : Number(r.csat_rate),
      assigned_at: iso(r.assigned_at) ?? new Date().toISOString(),
    }),
    insert: (rows) =>
      insertJsonRows(sql, {
        phone_inquiry_id: "STRING",
        conversation_id: "STRING",
        csat_rate: "INT64",
        assigned_at: "TIMESTAMP",
      }, rows),
    markSql: `
      update serving_csat_assignments t set exported_at = now()
      from unnest($1::text[], $2::int[], $3::text[]) as u(phone_inquiry_id, csat_rate, conversation_id)
      where t.phone_inquiry_id = u.phone_inquiry_id
        and t.csat_rate is not distinct from u.csat_rate
        and t.conversation_id is not distinct from u.conversation_id
    `,
    markParams: (rows) => [
      rows.map((r) => String(r.phone_inquiry_id)),
      rows.map((r) => (r.csat_rate == null ? null : Number(r.csat_rate))),
      rows.map((r) => nullableStr(r.conversation_id)),
    ],
  });
}

/** 평가셋 연결은 셋 단위로 BQ를 통째로 갈아 끼운다. 연결을 전부 지운 셋은 dirty 표시로 잡는다. */
async function exportEvalSets(): Promise<void> {
  const sql = growthBq.resultsSql(growthBq.evalSetCriteria);
  const startedAt = new Date().toISOString();
  const dirty = await servingQuery<{ eval_set_id: string }>(
    `
    select distinct eval_set_id from serving_eval_sets where exported_at is null
    union
    select key from serving_export_dirty where kind = 'eval_set'
    `,
  );
  for (const { eval_set_id: setId } of dirty) {
    const bindings = await servingQuery<Record<string, unknown>>(
      `select * from serving_eval_sets where eval_set_id = $1 order by sort_order`,
      [setId],
    );
    await queryBq(`delete from ${sql} where eval_set_id = @eval_set_id`, { eval_set_id: setId }, { eval_set_id: "STRING" });
    await insertJsonRows(
      sql,
      {
        eval_set_id: "STRING",
        criterion_id: "INT64",
        criterion_prompt_id: "STRING",
        sort_order: "INT64",
        enabled: "BOOL",
        created_at: "TIMESTAMP",
      },
      bindings.map((b) => ({
        eval_set_id: String(b.eval_set_id),
        criterion_id: Number(b.criterion_id),
        criterion_prompt_id: nullableStr(b.criterion_prompt_id),
        sort_order: Number(b.sort_order ?? 0),
        enabled: b.enabled !== false,
        created_at: iso(b.created_at) ?? startedAt,
      })),
    );
    await servingQuery(`update serving_eval_sets set exported_at = now() where eval_set_id = $1`, [setId]);
    await servingQuery(
      `delete from serving_export_dirty where kind = 'eval_set' and key = $1 and marked_at <= $2::timestamptz`,
      [setId, startedAt],
    );
  }
}

const LLM_LOG_COLS: Record<string, BqColType> = {
  call_id: "STRING",
  ts: "TIMESTAMP",
  purpose: "STRING",
  conversation_id: "STRING",
  model: "STRING",
  prompt_version_id: "STRING",
  template_key: "STRING",
  latency_ms: "INT64",
  prompt_token_count: "INT64",
  candidates_token_count: "INT64",
  total_token_count: "INT64",
  audio_prompt_token_count: "INT64",
  finish_reason: "STRING",
  seed: "STRING",
  response_id: "STRING",
  raw_usage_json: "STRING",
  raw_response_meta_json: "STRING",
  error: "STRING",
};

const STT_LOG_COLS: Record<string, BqColType> = {
  call_id: "STRING",
  ts: "TIMESTAMP",
  purpose: "STRING",
  conversation_id: "STRING",
  model: "STRING",
  language: "STRING",
  channel_count: "INT64",
  audio_duration_sec: "FLOAT64",
  billable_duration_sec: "FLOAT64",
  segment_count: "INT64",
  latency_ms: "INT64",
  error: "STRING",
};

/** 서빙 행에서 BQ 컬럼만 골라 덤프 행으로. timestamp 는 ISO 로. */
function pickDumpRow(r: Record<string, unknown>, cols: Record<string, BqColType>): DumpRow {
  const out: DumpRow = {};
  for (const [c, t] of Object.entries(cols)) {
    const v = r[c];
    if (v == null) out[c] = null;
    else if (t === "TIMESTAMP") out[c] = iso(v);
    else if (t === "INT64" || t === "FLOAT64") out[c] = Number(v);
    else if (t === "BOOL") out[c] = v === true;
    else out[c] = String(v);
  }
  return out;
}

async function exportLlmCallLogs(): Promise<void> {
  const { ensureLlmCallLogTable } = await import("./llmCallLog");
  await ensureLlmCallLogTable();
  const sql = growthBq.resultsSql(growthBq.llmCallLogs);
  await drainPending<Record<string, unknown>>({
    label: "llm logs",
    select: `select * from serving_llm_call_logs where exported_at is null order by ts`,
    batch: 500,
    toRow: (r) => pickDumpRow(r, LLM_LOG_COLS),
    insert: (rows) => insertJsonRows(sql, LLM_LOG_COLS, rows, { key: "call_id", recentCol: "ts" }),
    markSql: `update serving_llm_call_logs set exported_at = now() where call_id = any($1::text[])`,
    markParams: (rows) => [rows.map((r) => String(r.call_id))],
  });
}

async function exportSttCallLogs(): Promise<void> {
  const { ensureSttCallLogTable } = await import("./sttCallLog");
  await ensureSttCallLogTable();
  const sql = growthBq.resultsSql(growthBq.sttCallLogs);
  await drainPending<Record<string, unknown>>({
    label: "stt logs",
    select: `select * from serving_stt_call_logs where exported_at is null order by ts`,
    batch: 1000,
    toRow: (r) => pickDumpRow(r, STT_LOG_COLS),
    insert: (rows) => insertJsonRows(sql, STT_LOG_COLS, rows, { key: "call_id", recentCol: "ts" }),
    markSql: `update serving_stt_call_logs set exported_at = now() where call_id = any($1::text[])`,
    markParams: (rows) => [rows.map((r) => String(r.call_id))],
  });
}

async function exportUsageEvents(): Promise<void> {
  const { ensureUsageTable } = await import("./bigquery");
  await ensureUsageTable();
  const { appBq } = await import("./bqRefs");
  const sql = appBq.sql(appBq.tables.usageEvents);
  await drainPending<Record<string, unknown>>({
    label: "usage events",
    select: `select * from serving_usage_events where exported_at is null order by id`,
    batch: 2000,
    toRow: (r) => ({
      ts: iso(r.ts),
      user_email: nullableStr(r.user_email),
      path: nullableStr(r.path),
      event: nullableStr(r.event),
    }),
    insert: (rows) => insertJsonRows(sql, { ts: "TIMESTAMP", user_email: "STRING", path: "STRING", event: "STRING" }, rows),
    markSql: `update serving_usage_events set exported_at = now() where id = any($1::bigint[])`,
    markParams: (rows) => [rows.map((r) => r.id)],
  });
}

/** BQ 로그 3종을 서빙으로 1회 복사한다(집계 화면이 과거 기간도 보이게). 다시 돌려도 중복되지 않는다. */
export async function backfillCallLogs(): Promise<void> {
  const { insertLlmCallLogs } = await import("./llmCallLog");
  const { insertSttCallLogs } = await import("./sttCallLog");
  const num = (v: unknown) => (v == null || v === "" ? null : Number(bqStr(v)));
  const str = (v: unknown) => (v == null ? null : bqStr(v));

  const llm = await bqRows(`select * from ${growthBq.resultsSql(growthBq.llmCallLogs)}`);
  await insertLlmCallLogs(
    llm.map((r) => ({
      callId: bqStr(r.call_id),
      ts: bqStr(r.ts),
      purpose: str(r.purpose),
      conversationId: str(r.conversation_id),
      model: str(r.model),
      promptVersionId: str(r.prompt_version_id),
      templateKey: str(r.template_key),
      latencyMs: num(r.latency_ms),
      promptTokenCount: num(r.prompt_token_count),
      candidatesTokenCount: num(r.candidates_token_count),
      totalTokenCount: num(r.total_token_count),
      audioPromptTokenCount: num(r.audio_prompt_token_count),
      finishReason: str(r.finish_reason),
      seed: str(r.seed),
      responseId: str(r.response_id),
      rawUsageJson: str(r.raw_usage_json),
      rawResponseMetaJson: str(r.raw_response_meta_json),
      error: str(r.error),
    })),
    { exported: true },
  );

  const stt = await bqRows(`select * from ${growthBq.resultsSql(growthBq.sttCallLogs)}`);
  await insertSttCallLogs(
    stt.map((r) => ({
      callId: bqStr(r.call_id),
      ts: bqStr(r.ts),
      purpose: str(r.purpose),
      conversationId: str(r.conversation_id),
      model: str(r.model),
      language: str(r.language),
      channelCount: num(r.channel_count),
      audioDurationSec: num(r.audio_duration_sec),
      billableDurationSec: num(r.billable_duration_sec),
      segmentCount: num(r.segment_count),
      latencyMs: num(r.latency_ms),
      error: str(r.error),
    })),
    { exported: true },
  );

  // 사용 이벤트는 키가 없어 서빙에 BQ 에서 온 행(덤프 완료 표시)이 이미 있으면 건너뛴다.
  const already = await servingQuery<{ n: string }>(
    `select count(*) as n from serving_usage_events where exported_at is not null`,
  );
  let usage = 0;
  if (Number(already[0]?.n ?? 0) === 0) {
    const { appBq } = await import("./bqRefs");
    const rows = await bqRows(`select ts, user_email, path, event from ${appBq.sql(appBq.tables.usageEvents)}`);
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      await servingQuery(
        `
        insert into serving_usage_events (ts, user_email, path, event, exported_at)
        select u.ts::timestamptz, u.user_email, u.path, u.event, now()
        from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as u(ts, user_email, path, event)
        `,
        [chunk.map((r) => bqStr(r.ts)), chunk.map((r) => str(r.user_email)), chunk.map((r) => str(r.path)), chunk.map((r) => str(r.event))],
      );
    }
    usage = rows.length;
  }
  console.log(`[backfill] llm logs ${llm.length}, stt logs ${stt.length}, usage events ${usage}`);
}

async function exportMirrorTablesStep(): Promise<void> {
  const { exportMirrorTables } = await import("./servingMirror");
  await exportMirrorTables();
}

export async function exportServingDumps(): Promise<void> {
  const steps: Array<[string, () => Promise<void>]> = [
    ["eval-results", exportEvalResults],
    ["reviews", exportHumanReviews],
    ["completions", exportReviewCompletions],
    ["claims", exportReviewClaims],
    ["csat", exportCsatAssignments],
    ["eval-sets", exportEvalSets],
    ["llm-logs", exportLlmCallLogs],
    ["stt-logs", exportSttCallLogs],
    ["usage-events", exportUsageEvents],
    ["mirror-tables", exportMirrorTablesStep],
  ];
  // 한 테이블이 실패해도 나머지 덤프는 진행한다.
  const errors: string[] = [];
  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[servingSync] export ${name}:`, message);
      errors.push(`${name}: ${message}`);
    }
  }
  if (errors.length) throw new Error(errors.join(" | ").slice(0, 2000));
}

export type ServingSyncMode = "fast" | "nightly";

/** 증분 pull 이 보는 기간. 하루 넘게 멈췄다 켜져도 놓치지 않게 여유를 둔다. */
const FAST_CASE_DAYS = 2;
const FAST_CSAT_DAYS = 3;
/** 야간 보정은 증분이 며칠 멈췄어도 메우도록 넓게 본다. */
const NIGHTLY_FEEDBACK_CLOSED_DAYS = 7;

/** 단계가 이 값을 돌려주면 이번 틱에는 돌지 않은 것이다. 실행 기록을 남기지 않는다. */
const SKIPPED = Symbol("skipped");

/** CSAT 원천은 쿼리마다 약 600MB라 증분도 한 시간에 한 번만. */
const FAST_CSAT_EVERY_MS = 60 * 60 * 1000;

async function lastSuccessAt(jobs: string[]): Promise<number> {
  const rows = await servingQuery<{ at: Date | null }>(
    `select max(last_run_at) as at from serving_sync_state where job = any($1::text[]) and last_error is null`,
    [jobs],
  );
  return rows[0]?.at ? new Date(rows[0].at).getTime() : 0;
}

async function pullCsatIfDue(): Promise<number | typeof SKIPPED> {
  const last = await lastSuccessAt(["fast:pull-csat", "nightly:pull-csat"]);
  if (Date.now() - last < FAST_CSAT_EVERY_MS) return SKIPPED;
  return pullCsat({ sinceDays: FAST_CSAT_DAYS });
}

function syncSteps(mode: ServingSyncMode): Array<[string, () => Promise<unknown>]> {
  if (mode === "fast") {
    return [
      ["fast:pull-cases", () => pullCallSources({ sinceDays: FAST_CASE_DAYS })],
      ["fast:pull-csat", pullCsatIfDue],
      ["fast:pull-meta", pullServingMeta],
      ["fast:pull-feedback", () => pullFeedback()],
      ["fast:pull-qms-status", pullQmsStatus],
    ];
  }
  return [
    ["nightly:pull-cases", () => pullCallSources()],
    ["nightly:pull-csat", () => pullCsat()],
    ["nightly:pull-meta", pullServingMeta],
    ["nightly:pull-feedback", () => pullFeedback({ closedWithinDays: NIGHTLY_FEEDBACK_CLOSED_DAYS })],
    ["nightly:pull-qms-status", pullQmsStatus],
    ["nightly:pull-qms-cases", pullQmsResults],
    ["nightly:pull-source-criteria", pullSourceCriteriaStep],
    ["nightly:pull-qa-refs", pullQaReferencesStep],
    ["nightly:export", exportServingDumps],
  ];
}

/** 같은 DB를 보는 프로세스가 여럿이어도 한 번에 하나만 돈다. 이미 돌고 있으면 false. */
async function withSyncLock(fn: () => Promise<void>): Promise<boolean> {
  const client = await getServingPool().connect();
  try {
    const got = await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(hashtext('serving-sync')) as ok`);
    if (!got.rows[0]?.ok) return false;
    try {
      await fn();
    } finally {
      await client.query(`select pg_advisory_unlock(hashtext('serving-sync'))`);
    }
    return true;
  } finally {
    client.release();
  }
}

export async function runServingSync(mode: ServingSyncMode = "fast"): Promise<boolean> {
  return withSyncLock(async () => {
    for (const [job, fn] of syncSteps(mode)) {
      const t0 = Date.now();
      try {
        if ((await fn()) === SKIPPED) continue;
        await markJob(job, null);
        console.log(`[servingSync] ${job} ${Date.now() - t0}ms`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[servingSync] ${job}:`, message);
        await markJob(job, message).catch(() => undefined);
      }
    }
    await markJob(mode, null);
  });
}

/** 야간 작업 시각(KST). */
const NIGHTLY_HOUR_KST = Number(process.env.SERVING_NIGHTLY_HOUR_KST ?? 3);

/** 가장 최근에 지난 야간 작업 예정 시각. */
export function lastNightlySlot(now: Date, hourKst = NIGHTLY_HOUR_KST): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const slot = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), hourKst) - 9 * 3600_000;
  return new Date(slot <= now.getTime() ? slot : slot - 24 * 3600_000);
}

async function nightlyDue(now: Date): Promise<boolean> {
  const rows = await servingQuery<{ last_run_at: Date | null }>(
    `select last_run_at from serving_sync_state where job = 'nightly'`,
  );
  const last = rows[0]?.last_run_at;
  return !last || new Date(last).getTime() < lastNightlySlot(now).getTime();
}

let started = false;
let running = false;

export function startServingSyncLoop(): void {
  if (started || !servingConfigured()) return;
  const ms = Number(process.env.SERVING_SYNC_INTERVAL_MS ?? 15 * 60 * 1000);
  if (!Number.isFinite(ms) || ms <= 0) return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // 야간 전량이 밀려 있으면 증분 대신 그것부터 돈다(전량이 증분을 포함한다).
      const mode: ServingSyncMode = (await nightlyDue(new Date())) ? "nightly" : "fast";
      const ran = await runServingSync(mode);
      if (!ran) console.log("[servingSync] 다른 프로세스가 동기화 중이라 건너뜀");
    } catch (e) {
      console.warn("[servingSync] tick:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), ms);
}

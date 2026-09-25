import { getBQ } from "./bigquery";
import { growthBq, qradarTable } from "./bqRefs";
import { isEvalItemKeyV2, phoneIdEqSql, phoneIdInSql, phoneScopeParams } from "./evalItemKey";
import { EVAL_REVIEW_COMPLETIONS_V2_SCHEMA } from "./evalSchemaV2";
import { PHONE_SOURCE_SYSTEM } from "./evaluationChannel";

export type EvalReviewCompletion = {
  conversationId: string;
  completedAt: string;
  completedBy: string;
  /** 완료 시점의 최신 AI 평가 analysis_id */
  analysisId: string | null;
  org: string | null;
};

const TABLE = qradarTable("eval_review_completions");
const loc = () => (growthBq.location ? { location: growthBq.location } : {});
const completionTable = () =>
  getBQ().dataset(growthBq.dataset, { projectId: growthBq.projectId }).table(TABLE);

const SCHEMA = [
  { name: "conversation_id", type: "STRING", mode: "REQUIRED" },
  { name: "completed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "completed_by", type: "STRING", mode: "REQUIRED" },
  { name: "analysis_id", type: "STRING", mode: "NULLABLE" },
  { name: "org", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureEvalReviewCompletionTable(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const bq = getBQ();
      const ds = bq.dataset(growthBq.dataset, { projectId: growthBq.projectId });
      const [dsExists] = await ds.exists();
      if (!dsExists) {
        await ds.create({ location: growthBq.location ?? "US" }).catch((e) => {
          if (!isAlreadyExists(e)) throw e;
        });
      }
      const t = ds.table(TABLE);
      const [exists] = await t.exists();
      if (!exists) {
        await t
          .create({
            schema: EVAL_REVIEW_COMPLETIONS_V2_SCHEMA,
            timePartitioning: { type: "DAY", field: "completed_at" },
            clustering: { fields: ["channel", "source_id"] },
          })
          .catch((e) => {
            if (!isAlreadyExists(e)) throw e;
          });
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

function tsValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) {
    return String((v as { value: string }).value);
  }
  return String(v ?? "");
}

function rowToCompletion(r: Record<string, unknown>): EvalReviewCompletion | null {
  const conversationId = String(r.conversation_id ?? r.source_id ?? "").trim();
  const completedBy = String(r.completed_by ?? "").trim();
  if (!conversationId || !completedBy) return null;
  return {
    conversationId,
    completedAt: tsValue(r.completed_at),
    completedBy,
    analysisId: r.analysis_id != null ? String(r.analysis_id) : null,
    org: r.org != null ? String(r.org) : null,
  };
}

/** 수기 검수 완료 이벤트 append (결과 행 복사 없음) */
export async function saveReviewCompletion(input: {
  conversationId: string;
  completedBy: string;
  analysisId?: string | null;
  org?: string | null;
}): Promise<EvalReviewCompletion> {
  await ensureEvalReviewCompletionTable();
  const conversationId = input.conversationId.trim();
  const completedBy = input.completedBy.trim();
  if (!conversationId) throw new Error("conversationId 필요");
  if (!completedBy) throw new Error("completedBy 필요");
  const completedAt = new Date().toISOString();
  const row: EvalReviewCompletion = {
    conversationId,
    completedAt,
    completedBy,
    analysisId: input.analysisId?.trim() || null,
    org: input.org?.trim() || null,
  };
  await completionTable().insert(
    [
      (await isEvalItemKeyV2())
        ? {
            channel: "phone",
            source_system: PHONE_SOURCE_SYSTEM,
            source_id: row.conversationId,
            completed_at: row.completedAt,
            completed_by: row.completedBy,
            analysis_id: row.analysisId,
            org: row.org,
          }
        : {
            conversation_id: row.conversationId,
            completed_at: row.completedAt,
            completed_by: row.completedBy,
            analysis_id: row.analysisId,
            org: row.org,
          },
    ],
    { skipInvalidRows: true, ignoreUnknownValues: true },
  );
  return row;
}

export async function getLatestReviewCompletion(
  conversationId: string,
): Promise<EvalReviewCompletion | null> {
  const id = conversationId.trim();
  if (!id) return null;
  await ensureEvalReviewCompletionTable();
  const sql = growthBq.resultsSql(TABLE);
  const v2 = await isEvalItemKeyV2();
  try {
    const [rows] = await getBQ().query({
      query: `
        select *
        from ${sql}
        where ${phoneIdEqSql(v2, "conversation_id")}
        order by completed_at desc
        limit 1
      `,
      params: { conversation_id: id, ...phoneScopeParams(v2) },
      ...loc(),
    });
    const raw = (rows as Record<string, unknown>[])[0];
    return raw ? rowToCompletion(raw) : null;
  } catch (e) {
    console.warn("[evalReviewCompletionStore] getLatest:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** conversation별 최신 완료 이벤트 */
export async function listLatestReviewCompletionsByConversationIds(
  conversationIds: string[],
): Promise<Map<string, EvalReviewCompletion>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<string, EvalReviewCompletion>();
  if (!ids.length) return out;
  await ensureEvalReviewCompletionTable();
  const sql = growthBq.resultsSql(TABLE);
  const v2 = await isEvalItemKeyV2();
  try {
    const [rows] = await getBQ().query({
      query: `
        select *
        from ${sql}
        where ${phoneIdInSql(v2, "ids")}
        qualify row_number() over (partition by ${v2 ? "channel, source_system, source_id" : "conversation_id"} order by completed_at desc) = 1
      `,
      params: { ids, ...phoneScopeParams(v2) },
      ...loc(),
    });
    for (const raw of rows as Record<string, unknown>[]) {
      const c = rowToCompletion(raw);
      if (c) out.set(c.conversationId, c);
    }
  } catch (e) {
    console.warn("[evalReviewCompletionStore] listByIds:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** 기간 내 최신 완료 이벤트 (conversation별 1건) */
export async function listReviewCompletionsInPeriod(opts: {
  startIso: string;
  endIso: string;
  org?: string | null;
  limit?: number;
}): Promise<EvalReviewCompletion[]> {
  await ensureEvalReviewCompletionTable();
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 2000) || 2000, 1), 5000);
  const sql = growthBq.resultsSql(TABLE);
  const org = opts.org?.trim() || null;
  const v2 = await isEvalItemKeyV2();
  const partition = v2 ? "channel, source_system, source_id" : "conversation_id";
  try {
    const [rows] = await getBQ().query({
      query: `
        select *
        from (
          select *
          from ${sql}
          where completed_at >= timestamp(@start_iso)
            and completed_at < timestamp(@end_iso)
            ${org ? "and org = @org" : ""}
          qualify row_number() over (partition by ${partition} order by completed_at desc) = 1
        )
        order by completed_at desc
        limit @limit
      `,
      params: {
        start_iso: opts.startIso,
        end_iso: opts.endIso,
        limit: lim,
        ...(org ? { org } : {}),
      },
      ...loc(),
    });
    return (rows as Record<string, unknown>[])
      .map(rowToCompletion)
      .filter((c): c is EvalReviewCompletion => Boolean(c));
  } catch (e) {
    console.warn("[evalReviewCompletionStore] listInPeriod:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** 최근 완료 conversation id (completed_at desc) */
export async function listRecentCompletedConversationIds(opts?: {
  org?: string | null;
  limit?: number;
}): Promise<string[]> {
  await ensureEvalReviewCompletionTable();
  const lim = Math.min(Math.max(Math.floor(opts?.limit ?? 100) || 100, 1), 500);
  const sql = growthBq.resultsSql(TABLE);
  const org = opts?.org?.trim() || null;
  const v2 = await isEvalItemKeyV2();
  const idCol = v2 ? "source_id" : "conversation_id";
  try {
    const [rows] = await getBQ().query({
      query: `
        select ${idCol} as conversation_id
        from (
          select ${idCol}, completed_at
          from ${sql}
          where ${idCol} is not null and ${idCol} != ''
            ${org ? "and org = @org" : ""}
          qualify row_number() over (partition by ${v2 ? "channel, source_system, source_id" : "conversation_id"} order by completed_at desc) = 1
        )
        order by completed_at desc
        limit @limit
      `,
      params: { limit: lim, ...(org ? { org } : {}) },
      ...loc(),
    });
    return (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
  } catch (e) {
    console.warn("[evalReviewCompletionStore] listRecent:", e instanceof Error ? e.message : e);
    return [];
  }
}

import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq, qradarTable } from "./bqRefs";
import {
  isBestMarkCategoryId,
  normalizeJudgment,
  normalizeReviewNeeded,
  type BestMarkCategoryId,
  type EvalReviewAnnotation,
  type HumanJudgment,
} from "./evalReviewTypes";
import { parseCriterionReviewScope, type CriterionReviewScope } from "./promptTypes";

export type {
  BestMarkCategoryId,
  EvalReviewAnnotation,
  HumanJudgment,
} from "./evalReviewTypes";
export {
  BEST_MARK_CATEGORIES,
  bestMarkLabel,
  isBestMarkCategoryId,
  normalizeJudgment,
  normalizeReviewNeeded,
  commentHasGaman,
  inferLegacyReviewNeeded,
  needsLegacyReviewNeededBackfill,
  annotationReviewNeeded,
  annotationFinalCold,
} from "./evalReviewTypes";

const TABLE = qradarTable("eval_human_reviews");
const loc = () => (growthBq.location ? { location: growthBq.location } : {});
const reviewTable = () =>
  getBQ().dataset(growthBq.dataset, { projectId: growthBq.projectId }).table(TABLE);

const SCHEMA = [
  { name: "annotation_id", type: "STRING", mode: "REQUIRED" },
  { name: "conversation_id", type: "STRING", mode: "REQUIRED" },
  { name: "payload_json", type: "STRING", mode: "REQUIRED" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "updated_by", type: "STRING", mode: "NULLABLE" },
  { name: "deleted", type: "BOOLEAN", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureEvalReviewTable(): Promise<void> {
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
          .create({ schema: SCHEMA as unknown as { name: string; type: string; mode: string }[] })
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

function rowToAnnotation(r: Record<string, unknown>): EvalReviewAnnotation | null {
  try {
    const payload = JSON.parse(String(r.payload_json ?? "{}")) as Partial<EvalReviewAnnotation>;
    if (!payload?.annotationId || !payload?.conversationId) return null;
    const judgment = normalizeJudgment(payload.judgment);
    const bestCategory =
      judgment === "best" && isBestMarkCategoryId(payload.bestCategory) ? payload.bestCategory : null;
    const reviewNeeded = judgment === "best" ? null : normalizeReviewNeeded(payload.reviewNeeded);
    return {
      annotationId: payload.annotationId,
      conversationId: payload.conversationId,
      source: payload.source === "ai" ? "ai" : "human",
      atSec: Number(payload.atSec) || 0,
      segmentIndex: payload.segmentIndex ?? null,
      criterionId: Number(payload.criterionId) || 0,
      judgment,
      reviewNeeded,
      bestCategory,
      scope: parseCriterionReviewScope(payload.scope),
      comment: String(payload.comment ?? ""),
      aiCriterionId: payload.aiCriterionId ?? null,
      aiViolated: payload.aiViolated ?? null,
      aiQuote: payload.aiQuote ?? null,
      aiReason: payload.aiReason ?? null,
      quote: payload.quote ?? null,
      updatedAt: String(payload.updatedAt ?? ""),
      updatedBy: String(payload.updatedBy ?? ""),
    };
  } catch {
    return null;
  }
}

function tsValue(updated: unknown): string {
  if (updated && typeof updated === "object" && "value" in (updated as object)) {
    return String((updated as { value: string }).value);
  }
  return String(updated ?? "");
}

function collectLatestAnnotations(rows: Record<string, unknown>[]): EvalReviewAnnotation[] {
  const latest = new Map<string, EvalReviewAnnotation>();
  const deleted = new Set<string>();
  for (const raw of rows) {
    const id = String(raw.annotation_id ?? "");
    if (!id) continue;
    if (raw.deleted === true) {
      if (!latest.has(id)) deleted.add(id);
      continue;
    }
    if (deleted.has(id) || latest.has(id)) continue;
    const a = rowToAnnotation(raw);
    if (!a) continue;
    a.updatedAt = a.updatedAt || tsValue(raw.updated_at);
    a.updatedBy = a.updatedBy || String(raw.updated_by ?? "");
    latest.set(a.annotationId, a);
  }
  return [...latest.values()];
}

/** conversation 기준 최신 비삭제 주석 */
export async function listEvalReviews(conversationId: string): Promise<EvalReviewAnnotation[]> {
  await ensureEvalReviewTable();
  const sql = growthBq.resultsSql(TABLE);
  try {
    const [rows] = await getBQ().query({
      query: `
        select annotation_id, conversation_id, payload_json, updated_at, updated_by, deleted
        from ${sql}
        where conversation_id = @conversation_id
        order by updated_at desc
      `,
      params: { conversation_id: conversationId },
      ...loc(),
    });
    return collectLatestAnnotations(rows as Record<string, unknown>[]);
  } catch (e) {
    console.warn("[evalReviewStore] list fallback:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * conversation id 목록 기준 최신 비삭제 주석 (배치).
 */
export async function listEvalReviewsByConversationIds(
  conversationIds: string[],
): Promise<Map<string, EvalReviewAnnotation[]>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<string, EvalReviewAnnotation[]>();
  if (!ids.length) return out;
  await ensureEvalReviewTable();
  const sql = growthBq.resultsSql(TABLE);
  try {
    const [rows] = await getBQ().query({
      query: `
        select annotation_id, conversation_id, payload_json, updated_at, updated_by, deleted
        from ${sql}
        where conversation_id in unnest(@ids)
        order by updated_at desc
      `,
      params: { ids },
      ...loc(),
    });
    const byConv = new Map<string, Record<string, unknown>[]>();
    for (const raw of rows as Record<string, unknown>[]) {
      const cid = String(raw.conversation_id ?? "");
      if (!cid) continue;
      const list = byConv.get(cid) ?? [];
      list.push(raw);
      byConv.set(cid, list);
    }
    for (const [cid, convRows] of byConv) {
      out.set(cid, collectLatestAnnotations(convRows));
    }
  } catch (e) {
    console.warn("[evalReviewStore] listByIds fallback:", e instanceof Error ? e.message : e);
  }
  return out;
}

/**
 * 최신 비삭제 주석의 updated_by 가 해당 이메일인 conversation id.
 * (내가 남긴 수기 검수가 1개 이상인 케이스)
 */
export async function listConversationIdsReviewedBy(
  email: string,
  limit = 500,
): Promise<string[]> {
  const who = email.trim();
  if (!who) return [];
  const lim = Math.min(Math.max(1, Math.floor(limit)), 1000);
  await ensureEvalReviewTable();
  const sql = growthBq.resultsSql(TABLE);
  try {
    const [rows] = await getBQ().query({
      query: `
        select distinct conversation_id
        from (
          select conversation_id, updated_by, deleted,
            row_number() over (partition by annotation_id order by updated_at desc) as rn
          from ${sql}
          where conversation_id in (
            select distinct conversation_id from ${sql} where updated_by = @email
          )
        )
        where rn = 1
          and ifnull(deleted, false) = false
          and updated_by = @email
        limit @lim
      `,
      params: { email: who, lim },
      ...loc(),
    });
    return (rows as Record<string, unknown>[])
      .map((r) => String(r.conversation_id ?? "").trim())
      .filter(Boolean);
  } catch (e) {
    console.warn("[evalReviewStore] listByReviewer fallback:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 최근 수기 리뷰 전체(conversation 무관). 프롬프트 개선 백데이터용.
 * annotation_id 기준 최신 비삭제만, updated_at desc.
 */
export async function listRecentEvalReviews(limit = 2000): Promise<EvalReviewAnnotation[]> {
  await ensureEvalReviewTable();
  const sql = growthBq.resultsSql(TABLE);
  const lim = Math.min(Math.max(1, Math.floor(limit)), 5000);
  try {
    const [rows] = await getBQ().query({
      query: `
        select annotation_id, conversation_id, payload_json, updated_at, updated_by, deleted
        from ${sql}
        order by updated_at desc
        limit @lim
      `,
      params: { lim: lim * 3 },
      ...loc(),
    });
    const all = collectLatestAnnotations(rows as Record<string, unknown>[]);
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return all.slice(0, lim);
  } catch (e) {
    console.warn("[evalReviewStore] listRecent fallback:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function saveEvalReview(
  input: Omit<EvalReviewAnnotation, "annotationId" | "updatedAt"> & { annotationId?: string },
): Promise<EvalReviewAnnotation> {
  await ensureEvalReviewTable();
  const updatedAt = new Date().toISOString();
  const judgment = normalizeJudgment(input.judgment);
  const bestCategory: BestMarkCategoryId | null =
    judgment === "best" && isBestMarkCategoryId(input.bestCategory) ? input.bestCategory : null;
  const reviewNeeded =
    judgment === "best"
      ? null
      : (normalizeReviewNeeded(input.reviewNeeded) ?? (input.source === "human" ? true : null));
  const scope: CriterionReviewScope = parseCriterionReviewScope(input.scope);
  const criterionId = judgment === "best" ? 0 : Number(input.criterionId) || 0;
  const annotationId =
    scope === "conversation" && criterionId > 0
      ? `conversation:${input.conversationId}:${criterionId}`
      : input.annotationId?.trim() || randomUUID();
  const row: EvalReviewAnnotation = {
    annotationId,
    conversationId: input.conversationId,
    source: input.source,
    atSec: Number(input.atSec) || 0,
    segmentIndex: scope === "conversation" ? null : input.segmentIndex ?? null,
    criterionId,
    judgment,
    reviewNeeded,
    bestCategory,
    scope,
    comment: String(input.comment ?? ""),
    aiCriterionId: input.aiCriterionId ?? null,
    aiViolated: input.aiViolated ?? null,
    aiQuote: input.aiQuote ?? null,
    aiReason: input.aiReason ?? null,
    quote: input.quote ?? null,
    updatedAt,
    updatedBy: input.updatedBy,
  };
  await reviewTable().insert(
    [
      {
        annotation_id: annotationId,
        conversation_id: row.conversationId,
        payload_json: JSON.stringify(row),
        updated_at: updatedAt,
        updated_by: row.updatedBy,
        deleted: false,
      },
    ],
    { skipInvalidRows: true, ignoreUnknownValues: true },
  );
  return row;
}

export async function deleteEvalReview(input: {
  annotationId: string;
  conversationId: string;
  updatedBy: string;
}): Promise<void> {
  await ensureEvalReviewTable();
  const updatedAt = new Date().toISOString();
  await reviewTable().insert(
    [
      {
        annotation_id: input.annotationId,
        conversation_id: input.conversationId,
        payload_json: JSON.stringify({ annotationId: input.annotationId, deleted: true }),
        updated_at: updatedAt,
        updated_by: input.updatedBy,
        deleted: true,
      },
    ],
    { skipInvalidRows: true, ignoreUnknownValues: true },
  );
}

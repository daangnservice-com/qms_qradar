import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import {
  ensureEvalResultsTable,
  getLatestEvalResult,
  listLatestQaEvalResults,
  listUsedQaPromptVersions as listUsedVersionsFromStore,
  saveEvalResult,
  type EvalResultRow,
} from "./evalResultStore";
import { normalizeHumanResult, canonicalizeReviewNeededLabel } from "./resultParse";
import { REVIEW_NEEDED_LABEL, REVIEW_NOT_NEEDED_LABEL } from "./promptTypes";
import { listEvalReviewsByConversationIds, type EvalReviewAnnotation } from "./evalReviewStore";
import { checklistFromEvalPayload, deriveHumanReviewNeededIds } from "./humanResultDerive";
import { compareCriterionScores, parseScoreDetail, type HumanScoreItem } from "./scoreDetailParse";
import type { ResultParseConfig } from "./promptTypes";
import type { EvaluationResult } from "./types";
import { CS_CHECKLIST } from "./csChecklist";

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

export interface QaReferenceSample {
  conversationId: string;
  phoneInquiryId: string | null;
  humanResult: string;
  /** score_detail 에서 파싱한 부적합 항목 (id+라벨) */
  humanScoreItems: HumanScoreItem[];
  scoreDetailRaw: string;
  memoDetail: string;
  /** 평가 월 (뷰 year_month, YYYY-MM-01) */
  yearMonth: string | null;
  raw: Record<string, unknown>;
}

export interface QaEvalRow {
  qaRunId: string;
  analyzedAt: string;
  conversationId: string;
  phoneInquiryId: string | null;
  humanResult: string;
  aiLabel: string;
  match: boolean;
  promptVersionId: string | null;
  model: string | null;
  resultJson: string;
  transcriptJson: string;
  checklistJson: string;
  llmCallId: string | null;
  audioKept: boolean;
  audioPath: string | null;
  error: string | null;
  analyzedBy: string | null;
}

export interface ConfusionMatrix {
  labels: string[];
  /** matrix[humanIndex][aiIndex] */
  counts: number[][];
  total: number;
  accuracy: number;
}

/** @deprecated 통합 테이블 ensure */
export function ensureQaEvalTable(): Promise<void> {
  return ensureEvalResultsTable();
}

function evalRowToQa(row: EvalResultRow): QaEvalRow {
  return {
    qaRunId: row.analysisId,
    analyzedAt: row.analyzedAt,
    conversationId: row.conversationId,
    phoneInquiryId: row.phoneInquiryId,
    humanResult: row.humanResult,
    aiLabel: row.aiLabel,
    match: Boolean(row.match),
    promptVersionId: row.promptVersionId,
    model: row.model,
    resultJson: row.resultJson,
    transcriptJson: row.transcriptJson,
    checklistJson: row.checklistJson,
    llmCallId: row.llmCallId,
    audioKept: Boolean(row.audioKept),
    audioPath: row.audioPath,
    error: row.error,
    analyzedBy: row.analyzedBy,
  };
}

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real && row[real] != null && String(row[real]).trim()) return String(row[real]).trim();
  }
  return null;
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s.startsWith("{") && !s.startsWith("[")) return null;
    try {
      const o = JSON.parse(s) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function extractConversationId(row: Record<string, unknown>): string | null {
  // 뷰 스키마: genesys_conversation_id 는 case_content JSON 안에 있음
  const content = parseJsonObject(row.case_content);
  if (content) {
    const fromContent = pickString(content, [
      "genesys_conversation_id",
      "conversation_id",
      "conversationId",
    ]);
    if (fromContent) return fromContent;
  }
  // 혹시 case_result 가 JSON 오브젝트인 경우
  const resultObj = parseJsonObject(row.case_result);
  if (resultObj) {
    const fromResult = pickString(resultObj, [
      "genesys_conversation_id",
      "conversation_id",
      "conversationId",
    ]);
    if (fromResult) return fromResult;
  }
  return pickString(row, ["genesys_conversation_id", "conversation_id", "conversationId"]);
}

function extractPhoneInquiryId(row: Record<string, unknown>): string | null {
  const content = parseJsonObject(row.case_content);
  if (content) {
    const id = pickString(content, ["상담이력 ID", "phone_inquiry_id", "phoneInquiryId", "inquiry_id"]);
    if (id) return id;
  }
  return pickString(row, ["phone_inquiry_id", "phoneInquiryId", "case_id"]);
}

/** 수기 라벨: case_result 가 'cold'/'hot' 문자열이거나 JSON.result */
function extractHumanResult(row: Record<string, unknown>): string {
  const resultObj = parseJsonObject(row.case_result);
  if (resultObj) {
    return normalizeHumanResult(
      pickString(resultObj, ["result", "label", "case_result", "human_result"]) ?? "",
    );
  }
  const plain = pickString(row, ["case_result", "result", "human_result", "label"]);
  return normalizeHumanResult(plain ?? "");
}

function extractYearMonth(row: Record<string, unknown>): string | null {
  const raw = row.year_month;
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    const v = String((raw as { value: string }).value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** 수기 레퍼런스 뷰 목록 (year_month >= QA_REFERENCES_MIN_YEAR_MONTH) */
export async function listQaReferenceSamples(limit = 500): Promise<QaReferenceSample[]> {
  const viewSql = growthBq.qaReferencesSql();
  if (!viewSql) throw new Error("QA_REFERENCES_VIEW 미설정");

  const minYm = growthBq.qaReferencesMinYearMonth;
  const [rows] = await getBQ().query({
    query: `
      select *
      from ${viewSql}
      where year_month >= date(@min_year_month)
      order by year_month desc, case_id desc
      limit @limit
    `,
    params: { min_year_month: minYm, limit },
    ...loc(),
  });

  const list = (rows as Record<string, unknown>[]).map((r) => {
    const scoreDetailRaw = pickString(r, ["score_detail"]) ?? "";
    return {
      conversationId: extractConversationId(r) ?? "",
      phoneInquiryId: extractPhoneInquiryId(r),
      humanResult: extractHumanResult(r),
      humanScoreItems: parseScoreDetail(scoreDetailRaw),
      scoreDetailRaw,
      memoDetail: pickString(r, ["memo_detail", "memo"]) ?? "",
      yearMonth: extractYearMonth(r),
      raw: r,
    };
  });

  const missing = list.filter((x) => !x.conversationId).length;
  if (missing === list.length && list.length > 0) {
    const cols = Object.keys(list[0].raw).join(", ");
    throw new Error(
      `레퍼런스 뷰에서 conversation id를 찾지 못했습니다. case_content.genesys_conversation_id 또는 case_result JSON을 확인하세요. 컬럼: ${cols}`,
    );
  }
  return list.filter((x) => x.conversationId);
}

/** conversation별 최신 QA 결과. promptVersionId 지정 시 해당 평가표로 돌린 최신만. */
export async function listLatestQaResults(opts?: {
  promptVersionId?: string | null;
}): Promise<Map<string, QaEvalRow>> {
  const m = await listLatestQaEvalResults(opts);
  const out = new Map<string, QaEvalRow>();
  for (const [id, row] of m) out.set(id, evalRowToQa(row));
  return out;
}

/** QA 결과에 실제로 등장한 prompt_version_id + 건수 */
export async function listUsedQaPromptVersions(): Promise<
  Array<{ versionId: string; resultCount: number }>
> {
  return listUsedVersionsFromStore();
}

export async function getLatestQaResult(conversationId: string): Promise<QaEvalRow | null> {
  const row = await getLatestEvalResult({
    conversationId,
    purpose: "qa_eval",
    org: "growth",
  });
  return row ? evalRowToQa(row) : null;
}

export async function saveQaEvalResult(input: {
  conversationId: string;
  phoneInquiryId?: string | null;
  humanResult: string;
  result: EvaluationResult;
  parseConfig: ResultParseConfig;
  promptVersionId?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  llmCallId?: string | null;
  audioKept: boolean;
  audioPath?: string | null;
  analyzedBy?: string | null;
}): Promise<QaEvalRow> {
  const saved = await saveEvalResult({
    purpose: "qa_eval",
    org: "growth",
    conversationId: input.conversationId,
    phoneInquiryId: input.phoneInquiryId,
    analyzedBy: input.analyzedBy,
    result: input.result,
    promptVersionId: input.promptVersionId ?? null,
    promptVersion: input.promptVersion ?? null,
    model: input.model ?? null,
    llmCallId: input.llmCallId ?? null,
    humanResult: input.humanResult,
    audioKept: input.audioKept,
    audioPath: input.audioPath ?? null,
    parseConfig: input.parseConfig,
  });
  return evalRowToQa(saved);
}

export async function buildConfusionMatrix(opts?: {
  promptVersionId?: string | null;
}): Promise<ConfusionMatrix> {
  const latest = await listLatestQaResults({ promptVersionId: opts?.promptVersionId });
  const reviewsByConv = await listEvalReviewsByConversationIds([...latest.keys()]).catch(
    () => new Map<string, EvalReviewAnnotation[]>(),
  );
  const labels = [REVIEW_NEEDED_LABEL, REVIEW_NOT_NEEDED_LABEL];
  const idx = (v: string) => {
    const n = canonicalizeReviewNeededLabel(v);
    const i = labels.indexOf(n);
    return i >= 0 ? i : -1;
  };
  const counts = labels.map(() => labels.map(() => 0));
  let total = 0;
  let correct = 0;
  for (const row of latest.values()) {
    if (row.error) continue;
    const reviews = reviewsByConv.get(row.conversationId) ?? [];
    const hasExplicit = reviews.some((r) => typeof r.reviewNeeded === "boolean");
    const human = hasExplicit
      ? canonicalizeReviewNeededLabel(
          (deriveHumanReviewNeededIds(checklistFromEvalPayload(row), reviews).size
            ? REVIEW_NEEDED_LABEL
            : REVIEW_NOT_NEEDED_LABEL),
        )
      : canonicalizeReviewNeededLabel(row.humanResult);
    const ai = canonicalizeReviewNeededLabel(row.aiLabel);
    const hi = idx(human);
    const aiIdx = idx(ai);
    if (hi < 0 || aiIdx < 0) continue;
    counts[hi][aiIdx] += 1;
    total += 1;
    if (hi === aiIdx) correct += 1;
  }
  return {
    labels,
    counts,
    total,
    accuracy: total ? correct / total : 0,
  };
}

export interface CriterionAccuracyRow {
  id: number;
  label: string;
  category: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** 감지 관련 합 (TP+FP+FN). TN은 대부분이라 막대 분모에서 제외 */
  detected: number;
  /** (TP+TN) / (TP+TN+FP+FN) */
  accuracy: number;
  /** TP / (TP+FP) */
  precision: number;
  /** TP / (TP+FN) */
  recall: number;
  /** 2·P·R / (P+R) */
  f1: number;
  /** FP+FN */
  diffCount: number;
}

/** 콜별 최신 QA + 수기 score_detail → 항목별 TP/FP/FN 집계 */
export async function buildCriterionAccuracy(
  labelById?: Map<number, string>,
  opts?: { promptVersionId?: string | null },
): Promise<CriterionAccuracyRow[]> {
  const [latest, refs] = await Promise.all([
    listLatestQaResults({ promptVersionId: opts?.promptVersionId }),
    listQaReferenceSamples(2000),
  ]);
  const reviewsByConv = await listEvalReviewsByConversationIds([...latest.keys()]).catch(
    () => new Map<string, EvalReviewAnnotation[]>(),
  );
  const refById = new Map(refs.map((r) => [r.conversationId, r]));
  const catById = new Map(CS_CHECKLIST.map((c) => [c.id, c.category]));

  const agg = new Map<number, { tp: number; fp: number; fn: number; tn: number; label: string }>();

  for (const row of latest.values()) {
    if (row.error) continue;
    let checklist: Array<{ id: number; violated: boolean; reason?: string; label?: string }> = [];
    try {
      checklist = JSON.parse(row.checklistJson) as typeof checklist;
    } catch {
      checklist = [];
    }
    const ref = refById.get(row.conversationId);
    const reviews = reviewsByConv.get(row.conversationId) ?? [];
    const hasExplicit = reviews.some((r) => typeof r.reviewNeeded === "boolean");
    const humanItems = hasExplicit
      ? [...deriveHumanReviewNeededIds(checklistFromEvalPayload(row), reviews)].map((id) => ({
          id,
          label: labelById?.get(id) || String(id),
          raw: String(id),
        }))
      : (ref?.humanScoreItems ?? []);
    if (!checklist.length && !humanItems.length) continue;

    const { rows } = compareCriterionScores({
      humanItems,
      aiChecklist: checklist,
      labelById,
    });

    for (const r of rows) {
      const cur = agg.get(r.id) ?? { tp: 0, fp: 0, fn: 0, tn: 0, label: r.label };
      if (r.status === "tp") cur.tp += 1;
      else if (r.status === "fp" || r.status === "ai_only") cur.fp += 1;
      else if (r.status === "fn" || r.status === "human_only") cur.fn += 1;
      else if (r.status === "tn") cur.tn += 1;
      else continue;
      if (r.label && r.label !== String(r.id)) cur.label = r.label;
      agg.set(r.id, cur);
    }
  }

  const out: CriterionAccuracyRow[] = [];
  for (const [id, v] of agg) {
    const detected = v.tp + v.fp + v.fn;
    if (!detected) continue;
    const total = detected + v.tn;
    const precision = v.tp + v.fp ? v.tp / (v.tp + v.fp) : 0;
    const recall = v.tp + v.fn ? v.tp / (v.tp + v.fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const label = labelById?.get(id) || v.label || String(id);
    out.push({
      id,
      label,
      category: catById.get(id) ?? "",
      tp: v.tp,
      fp: v.fp,
      fn: v.fn,
      tn: v.tn,
      detected,
      accuracy: total ? (v.tp + v.tn) / total : 0,
      precision,
      recall,
      f1,
      diffCount: v.fp + v.fn,
    });
  }

  out.sort((a, b) => b.diffCount - a.diffCount || b.detected - a.detected);
  return out;
}

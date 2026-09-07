import { CS_CHECKLIST } from "./csChecklist";
import type { CallQualityOrg } from "./callQualityOrg";
import { resolveCriterionLabelMap } from "./criterionStore";
import { listCaseMetaByConversationIds } from "./evaluationSamples";
import { checklistFromEvalPayload, deriveHumanReviewNeededIds, deriveHumanViolatedIds } from "./humanResultDerive";
import { listReviewedCallEvalResults, type EvalResultRow } from "./evalResultStore";
import { listEvalReviewsByConversationIds, type EvalReviewAnnotation } from "./evalReviewStore";
import { getProductionPrompt, listPromptVersions } from "./promptStore";
import { canonicalizeReviewNeededLabel } from "./resultParse";
import { REVIEW_NEEDED_LABEL, REVIEW_NOT_NEEDED_LABEL } from "./promptTypes";
import { compareCriterionScores } from "./scoreDetailParse";
import { splitOverUnderTops } from "./criterionTops";

export { currentYearMonthKst, dateRangeToIso, monthRangeToIso } from "./reviewStatusPeriod";
export { splitOverUnderTops } from "./criterionTops";

export type ReviewStatusMatrix = {
  labels: string[];
  counts: number[][];
  total: number;
  accuracy: number;
};

export type ReviewStatusCriterionRow = {
  id: number;
  label: string;
  category: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  detected: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  diffCount: number;
};

export type ReviewStatusCaseRow = {
  conversationId: string;
  phoneInquiryId: string | null;
  adminName: string;
  callDate: string;
  aiLabel: string;
  humanResult: string;
  humanFinalLabel: string;
  match: boolean | null;
  reviewCompletedAt: string | null;
  reviewCompletedBy: string | null;
  promptVersionId: string | null;
  promptVersion: string | null;
  /** call-level: fp | fn | match | other */
  callKind: "fp" | "fn" | "match" | "other";
  humanReviewNeededCount: number;
  aiReviewNeededCount: number;
  /** AI − 수기 검토필요. +면 과검출, −면 미검출 */
  reviewNeededDiff: number;
  /** @deprecated reviewNeededDiff */
  humanColdCount: number;
  aiColdCount: number;
  coldDiff: number;
};

export type ReviewStatusDashboard = {
  matrix: ReviewStatusMatrix;
  byCriterion: ReviewStatusCriterionRow[];
  overDetect: ReviewStatusCriterionRow[];
  underDetect: ReviewStatusCriterionRow[];
  cases: ReviewStatusCaseRow[];
};

export type ReviewStatusEvalSetShare = {
  versionId: string;
  versionLabel: string;
  status: string | null;
  isProduction: boolean;
  caseCount: number;
  share: number;
  accuracy: number;
  precision: number;
  recall: number;
};

const TEMPLATE_KEY = "call_eval_growth" as const;

function callKind(human: string, ai: string): ReviewStatusCaseRow["callKind"] {
  const h = canonicalizeReviewNeededLabel(human);
  const a = canonicalizeReviewNeededLabel(ai);
  if (h !== REVIEW_NEEDED_LABEL && h !== REVIEW_NOT_NEEDED_LABEL) return "other";
  if (a !== REVIEW_NEEDED_LABEL && a !== REVIEW_NOT_NEEDED_LABEL) return "other";
  if (h === a) return "match";
  if (h === REVIEW_NOT_NEEDED_LABEL && a === REVIEW_NEEDED_LABEL) return "fp";
  if (h === REVIEW_NEEDED_LABEL && a === REVIEW_NOT_NEEDED_LABEL) return "fn";
  return "other";
}

function buildMatrix(rows: EvalResultRow[]): ReviewStatusMatrix {
  const labels = [REVIEW_NEEDED_LABEL, REVIEW_NOT_NEEDED_LABEL];
  const idx = (v: string) => {
    const n = canonicalizeReviewNeededLabel(v);
    const i = labels.indexOf(n);
    return i >= 0 ? i : -1;
  };
  const counts = labels.map(() => labels.map(() => 0));
  let total = 0;
  let correct = 0;
  for (const row of rows) {
    if (row.error) continue;
    const hi = idx(row.humanResult);
    const ai = idx(row.aiLabel);
    if (hi < 0 || ai < 0) continue;
    counts[hi][ai] += 1;
    total += 1;
    if (hi === ai) correct += 1;
  }
  return {
    labels,
    counts,
    total,
    accuracy: total ? correct / total : 0,
  };
}

async function buildCriterionRows(
  rows: EvalResultRow[],
  labelById: Map<number, string>,
  reviewsByConv: Map<string, EvalReviewAnnotation[]>,
): Promise<ReviewStatusCriterionRow[]> {
  const catById = new Map(CS_CHECKLIST.map((c) => [c.id, c.category]));
  const agg = new Map<number, { tp: number; fp: number; fn: number; tn: number; label: string }>();

  for (const row of rows) {
    if (row.error) continue;
    const checklist = checklistFromEvalPayload(row);
    const reviews = reviewsByConv.get(row.conversationId) ?? [];
    const humanIds = deriveHumanReviewNeededIds(checklist, reviews);
    const humanItems = [...humanIds].map((id) => ({
      id,
      label: labelById.get(id) || String(id),
      raw: String(id),
    }));
    if (!checklist.length && !humanItems.length) continue;

    const { rows: compared } = compareCriterionScores({
      humanItems,
      aiChecklist: checklist,
      labelById,
    });

    for (const r of compared) {
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

  const out: ReviewStatusCriterionRow[] = [];
  for (const [id, v] of agg) {
    const detected = v.tp + v.fp + v.fn;
    if (!detected) continue;
    const total = detected + v.tn;
    const precision = v.tp + v.fp ? v.tp / (v.tp + v.fp) : 0;
    const recall = v.tp + v.fn ? v.tp / (v.tp + v.fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    out.push({
      id,
      label: labelById.get(id) || v.label || String(id),
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

async function buildEvalSetShares(rows: EvalResultRow[]): Promise<ReviewStatusEvalSetShare[]> {
  const [versions, production] = await Promise.all([
    listPromptVersions(TEMPLATE_KEY, { ensure: false }).catch(() => []),
    getProductionPrompt(TEMPLATE_KEY, { ensure: false }).catch(() => null),
  ]);
  const meta = new Map(versions.map((v) => [v.versionId, v]));
  const prodId = production?.version.versionId ?? null;
  const rowsByVersion = new Map<string, EvalResultRow[]>();
  for (const row of rows) {
    const id = (row.promptVersionId || "").trim() || "(없음)";
    const versionRows = rowsByVersion.get(id) ?? [];
    versionRows.push(row);
    rowsByVersion.set(id, versionRows);
  }
  const total = rows.length || 1;
  return [...rowsByVersion.entries()]
    .map(([versionId, versionRows]) => {
      const v = meta.get(versionId);
      const matrix = buildMatrix(versionRows);
      const neededIndex = matrix.labels.indexOf(REVIEW_NEEDED_LABEL);
      const notIndex = matrix.labels.indexOf(REVIEW_NOT_NEEDED_LABEL);
      const tp = neededIndex >= 0 ? matrix.counts[neededIndex]?.[neededIndex] ?? 0 : 0;
      const fn = neededIndex >= 0 && notIndex >= 0 ? matrix.counts[neededIndex]?.[notIndex] ?? 0 : 0;
      const fp = notIndex >= 0 && neededIndex >= 0 ? matrix.counts[notIndex]?.[neededIndex] ?? 0 : 0;
      const tn = notIndex >= 0 ? matrix.counts[notIndex]?.[notIndex] ?? 0 : 0;
      const validCount = tp + tn + fp + fn;
      return {
        versionId,
        versionLabel: v?.versionLabel || (versionId === "(없음)" ? "평가셋 없음" : versionId.slice(0, 8)),
        status: v?.status ?? null,
        isProduction: Boolean(prodId && versionId === prodId),
        caseCount: versionRows.length,
        share: versionRows.length / total,
        accuracy: validCount ? (tp + tn) / validCount : 0,
        precision: tp + fp ? tp / (tp + fp) : 0,
        recall: tp + fn ? tp / (tp + fn) : 0,
      };
    })
    .sort((a, b) => b.caseCount - a.caseCount);
}

async function buildDashboard(
  rows: EvalResultRow[],
  labelById: Map<number, string>,
  reviewsByConv: Map<string, EvalReviewAnnotation[]>,
  caseMeta: Awaited<ReturnType<typeof listCaseMetaByConversationIds>>,
): Promise<ReviewStatusDashboard> {
  const [matrix, byCriterion] = await Promise.all([
    Promise.resolve(buildMatrix(rows)),
    buildCriterionRows(rows, labelById, reviewsByConv),
  ]);
  const { overDetect, underDetect } = splitOverUnderTops(byCriterion);
  const cases: ReviewStatusCaseRow[] = rows.map((r) => {
    const checklist = checklistFromEvalPayload(r);
    const reviews = reviewsByConv.get(r.conversationId) ?? [];
    const aiReviewNeededCount = checklist.filter((c) => c.violated).length;
    const humanReviewNeededCount = deriveHumanReviewNeededIds(checklist, reviews).size;
    const humanFinalColdCount = deriveHumanViolatedIds(checklist, reviews).size;
    const meta = caseMeta.get(r.conversationId);
    return {
      conversationId: r.conversationId,
      phoneInquiryId: r.phoneInquiryId,
      adminName: meta?.adminName ?? "",
      callDate: meta?.callDate ?? "",
      aiLabel: r.aiLabel,
      humanResult: r.humanResult,
      humanFinalLabel: r.humanFinalLabel || (humanFinalColdCount ? "cold" : "hot"),
      match: r.match,
      reviewCompletedAt: r.reviewCompletedAt,
      reviewCompletedBy: r.reviewCompletedBy,
      promptVersionId: r.promptVersionId,
      promptVersion: r.promptVersion,
      callKind: callKind(r.humanResult, r.aiLabel),
      humanReviewNeededCount,
      aiReviewNeededCount,
      reviewNeededDiff: aiReviewNeededCount - humanReviewNeededCount,
      humanColdCount: humanReviewNeededCount,
      aiColdCount: aiReviewNeededCount,
      coldDiff: aiReviewNeededCount - humanReviewNeededCount,
    };
  });
  return { matrix, byCriterion, overDetect, underDetect, cases };
}

export async function buildReviewStatusReport(opts: {
  org?: CallQualityOrg | null;
  startIso: string;
  endIso: string;
}): Promise<{
  matrix: ReviewStatusDashboard["matrix"];
  byCriterion: ReviewStatusDashboard["byCriterion"];
  overDetect: ReviewStatusDashboard["overDetect"];
  underDetect: ReviewStatusDashboard["underDetect"];
  evalSets: ReviewStatusEvalSetShare[];
  evalSetReports: Record<string, Omit<ReviewStatusDashboard, "cases">>;
  cases: ReviewStatusDashboard["cases"];
  period: { startIso: string; endIso: string };
}> {
  const rows = await listReviewedCallEvalResults({
    org: opts.org ?? "growth",
    startIso: opts.startIso,
    endIso: opts.endIso,
  });
  const labelById = await resolveCriterionLabelMap();
  const convIds = rows.map((r) => r.conversationId);
  const [reviewsByConv, caseMeta] = await Promise.all([
    listEvalReviewsByConversationIds(convIds),
    listCaseMetaByConversationIds(convIds),
  ]);
  const rowsByEvalSet = new Map<string, EvalResultRow[]>();
  for (const row of rows) {
    const id = (row.promptVersionId || "").trim() || "(없음)";
    const evalSetRows = rowsByEvalSet.get(id) ?? [];
    evalSetRows.push(row);
    rowsByEvalSet.set(id, evalSetRows);
  }
  const [dashboard, evalSets, evalSetReports] = await Promise.all([
    buildDashboard(rows, labelById, reviewsByConv, caseMeta),
    buildEvalSetShares(rows),
    Promise.all(
      [...rowsByEvalSet.entries()].map(async ([id, evalSetRows]) => {
        const { cases: _cases, ...metrics } = await buildDashboard(
          evalSetRows,
          labelById,
          reviewsByConv,
          caseMeta,
        );
        return [id, metrics] as const;
      }),
    ).then((entries) => Object.fromEntries(entries) as Record<string, Omit<ReviewStatusDashboard, "cases">>),
  ]);
  return {
    ...dashboard,
    evalSets,
    evalSetReports,
    period: { startIso: opts.startIso, endIso: opts.endIso },
  };
}

import {
  annotationFinalCold,
  annotationReviewNeeded,
  type EvalReviewAnnotation,
} from "./evalReviewTypes";
import { DEFAULT_RESULT_PARSE_CONFIG, FINAL_COLD_LABEL, FINAL_HOT_LABEL } from "./promptTypes";
import { canonicalizeReviewNeededLabel, deriveEvalLabel, labelsMatch } from "./resultParse";
import type { ChecklistResult } from "./types";

/** 결과 행(또는 동등 payload)에서 AI 체크리스트 추출 */
export function checklistFromEvalPayload(input: {
  checklistJson?: string | null;
  resultJson?: string | null;
}): ChecklistResult[] {
  const fromField = (raw: string | null | undefined): ChecklistResult[] => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v as ChecklistResult[]) : [];
    } catch {
      return [];
    }
  };
  const checklist = fromField(input.checklistJson);
  if (checklist.length) return checklist;
  if (!input.resultJson) return [];
  try {
    const result = JSON.parse(input.resultJson) as { evaluation?: { csChecklist?: ChecklistResult[] } };
    const list = result.evaluation?.csChecklist;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 같은 criterion 에 검수가 여러 건이면 updatedAt 최신만 사용 */
function latestReviewsByCriterion(reviews: EvalReviewAnnotation[]): EvalReviewAnnotation[] {
  const latest = new Map<number, EvalReviewAnnotation>();
  for (const r of reviews) {
    if (r.judgment === "best") continue;
    const id = Number(r.criterionId) || 0;
    if (id <= 0) continue;
    const prev = latest.get(id);
    if (!prev || (r.updatedAt || "") >= (prev.updatedAt || "")) {
      latest.set(id, r);
    }
  }
  return [...latest.values()];
}

/**
 * 수기 검토필요 criterion id.
 * 미터치 AI violated → 검토필요(시드). 과검출(reviewNeeded=false)이면 제거. + 수기는 항상 추가.
 */
export function deriveHumanReviewNeededIds(
  checklist: ChecklistResult[],
  reviews: EvalReviewAnnotation[],
): Set<number> {
  const human = new Set<number>();
  for (const c of checklist) {
    if (c.violated) human.add(c.id);
  }
  for (const r of latestReviewsByCriterion(reviews)) {
    if (annotationReviewNeeded(r)) human.add(r.criterionId);
    else human.delete(r.criterionId);
  }
  return human;
}

/** 검토필요 1개 이상이면 review_needed, 없으면 review_not_needed */
export function deriveHumanReviewNeededLabel(
  checklist: ChecklistResult[],
  reviews: EvalReviewAnnotation[],
): string {
  const ids = deriveHumanReviewNeededIds(checklist, reviews);
  return ids.size
    ? DEFAULT_RESULT_PARSE_CONFIG.trueLabel
    : DEFAULT_RESULT_PARSE_CONFIG.falseLabel;
}

/**
 * 수기 최종 Cold(감안 불가) criterion id.
 * 미터치 AI violated → Cold. 과검출·감안 Hot이면 제거. + 수기는 judgment 따름.
 */
export function deriveHumanViolatedIds(
  checklist: ChecklistResult[],
  reviews: EvalReviewAnnotation[],
): Set<number> {
  const human = new Set<number>();
  for (const c of checklist) {
    if (c.violated) human.add(c.id);
  }
  for (const r of latestReviewsByCriterion(reviews)) {
    if (annotationFinalCold(r)) human.add(r.criterionId);
    else human.delete(r.criterionId);
  }
  return human;
}

/** 최종 부적합 1개 이상이면 cold, 없으면 hot */
export function deriveHumanResultLabel(
  checklist: ChecklistResult[],
  reviews: EvalReviewAnnotation[],
): string {
  const humanIds = deriveHumanViolatedIds(checklist, reviews);
  return humanIds.size ? FINAL_COLD_LABEL : FINAL_HOT_LABEL;
}

type LiveHumanRow = {
  purpose?: string | null;
  reviewCompletedAt?: string | null;
  humanResult: string;
  aiLabel: string;
  match: boolean | null;
  checklistJson?: string | null;
  resultJson?: string | null;
  /** 수기 최종 Cold/Hot. 조회 시 파생. */
  humanFinalLabel?: string;
};

/**
 * call_eval 수기 라벨은 저장 스냅샷이 아니라 현재 검수로 파생.
 * humanResult = 검토필요, humanFinalLabel = 최종 Cold/Hot.
 * qa_eval(Train 골드)은 저장된 human_result 를 유지하되 라벨만 검토필요 축으로 정규화.
 * 검수 미완료면 라벨을 비움.
 */
export function overlayLiveHumanResult<T extends LiveHumanRow>(
  row: T,
  reviews: EvalReviewAnnotation[],
): T & { humanFinalLabel: string } {
  if (row.purpose === "qa_eval") {
    const aiLabel = canonicalizeReviewNeededLabel(row.aiLabel) || row.aiLabel;
    const humanResult = canonicalizeReviewNeededLabel(row.humanResult) || row.humanResult;
    const storedFinal =
      row.humanFinalLabel ||
      (row.humanResult === FINAL_COLD_LABEL || row.humanResult === FINAL_HOT_LABEL ? row.humanResult : "");
    return {
      ...row,
      aiLabel,
      humanResult,
      humanFinalLabel: storedFinal,
      match: humanResult && aiLabel ? labelsMatch(humanResult, aiLabel) : row.match,
    };
  }
  if (!row.reviewCompletedAt) {
    return { ...row, humanResult: "", humanFinalLabel: "", match: null };
  }
  const checklist = checklistFromEvalPayload(row);
  const humanResult = deriveHumanReviewNeededLabel(checklist, reviews);
  const humanFinalLabel = deriveHumanResultLabel(checklist, reviews);
  const aiLabel = canonicalizeReviewNeededLabel(row.aiLabel || deriveEvalLabel({ csChecklist: checklist }));
  return {
    ...row,
    humanResult,
    humanFinalLabel,
    aiLabel,
    match: labelsMatch(humanResult, aiLabel),
  };
}

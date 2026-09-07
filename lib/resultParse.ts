import type { ChecklistResult } from "./types";
import type { ResultParseConfig } from "./promptTypes";
import {
  DEFAULT_RESULT_PARSE_CONFIG,
  REVIEW_NEEDED_LABEL,
  REVIEW_NOT_NEEDED_LABEL,
} from "./promptTypes";

export {
  REVIEW_NEEDED_LABEL,
  REVIEW_NOT_NEEDED_LABEL,
  FINAL_COLD_LABEL,
  FINAL_HOT_LABEL,
} from "./promptTypes";

/** Gemini/평가 결과에서 검토필요 라벨 파생. violated=true 1개 이상 → review_needed. */
export function deriveEvalLabel(
  input: { csChecklist?: ChecklistResult[] | null },
  config: ResultParseConfig = DEFAULT_RESULT_PARSE_CONFIG,
): string {
  if (config.kind === "any_checklist_violated") {
    const list = input.csChecklist ?? [];
    const anyViolated = list.some((c) => c.violated === true);
    return anyViolated ? config.trueLabel : config.falseLabel;
  }
  return config.falseLabel;
}

export function normalizeHumanResult(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * 저장된 cold/hot(8월)과 review_needed/review_not_needed(9월)를 같은 축으로 맞춘다.
 * 매칭·매트릭스 비교용. 최종 Cold/Hot 판정에는 쓰지 않는다.
 */
export function canonicalizeReviewNeededLabel(raw: unknown): string {
  const n = normalizeHumanResult(raw);
  if (n === "cold" || n === REVIEW_NEEDED_LABEL) return REVIEW_NEEDED_LABEL;
  if (n === "hot" || n === REVIEW_NOT_NEEDED_LABEL) return REVIEW_NOT_NEEDED_LABEL;
  return n;
}

export function isReviewNeededLabel(raw: unknown): boolean {
  return canonicalizeReviewNeededLabel(raw) === REVIEW_NEEDED_LABEL;
}

export function labelsMatch(human: string, ai: string): boolean {
  const h = canonicalizeReviewNeededLabel(human);
  const a = canonicalizeReviewNeededLabel(ai);
  if (h === REVIEW_NEEDED_LABEL || h === REVIEW_NOT_NEEDED_LABEL) {
    return h === a;
  }
  return normalizeHumanResult(human) === normalizeHumanResult(ai);
}

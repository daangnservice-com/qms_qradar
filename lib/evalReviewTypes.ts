import type { CriterionReviewScope } from "./promptTypes";

export type HumanJudgment = "cold" | "hot" | "best";

/** Best 마크 카테고리 — 수기 Best 선택 시 평가 항목 대신 사용 */
export const BEST_MARK_CATEGORIES = [
  { id: "empathy", label: "공감" },
  { id: "listening", label: "경청" },
  { id: "resolve_will", label: "해결의지" },
  { id: "tone_manner", label: "톤앤매너" },
  { id: "accurate_counsel", label: "정확한 상담" },
  { id: "fast_speed", label: "빠른 속도" },
] as const;

export type BestMarkCategoryId = (typeof BEST_MARK_CATEGORIES)[number]["id"];

const BEST_IDS = new Set<string>(BEST_MARK_CATEGORIES.map((c) => c.id));

export function isBestMarkCategoryId(v: unknown): v is BestMarkCategoryId {
  return typeof v === "string" && BEST_IDS.has(v);
}

export function bestMarkLabel(id: string | null | undefined): string {
  if (!id) return "Best";
  return BEST_MARK_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function normalizeJudgment(v: unknown): HumanJudgment {
  if (v === "hot" || v === "best" || v === "cold") return v;
  return "cold";
}

/** 명시 필드만. 없으면 레거시(8월) 검수로 간주. */
export function normalizeReviewNeeded(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/** 8월 레거시: 코멘트에 감안이 있으면 검토필요는 맞되 최종 Hot. */
export function commentHasGaman(comment: string | null | undefined): boolean {
  return (comment ?? "").includes("감안");
}

/**
 * reviewNeeded 필드가 없는 레거시 수기 → 명시 boolean.
 * Hot+감안=필요, Hot만=과검출(불필요), Cold=필요. Best는 채우지 않음.
 */
export function inferLegacyReviewNeeded(r: {
  judgment: HumanJudgment;
  comment?: string | null;
}): boolean | null {
  if (r.judgment === "best") return null;
  if (r.judgment === "cold") return true;
  return commentHasGaman(r.comment);
}

/** 필드가 비어 있고 Best가 아니면 백필 대상. */
export function needsLegacyReviewNeededBackfill(r: {
  judgment: HumanJudgment;
  reviewNeeded?: boolean | null;
}): boolean {
  if (r.judgment === "best") return false;
  return typeof r.reviewNeeded !== "boolean";
}

/**
 * 수기 검토필요. 9월 필드가 있으면 그대로.
 * 없으면 8월 백필 규칙: Cold=필요, Hot+코멘트 감안=필요, Hot만=불필요.
 * Best는 검토필요 집계에서 제외.
 */
export function annotationReviewNeeded(r: {
  judgment: HumanJudgment;
  reviewNeeded?: boolean | null;
  comment?: string | null;
}): boolean {
  if (r.judgment === "best") return false;
  if (typeof r.reviewNeeded === "boolean") return r.reviewNeeded;
  return inferLegacyReviewNeeded(r) === true;
}

/** 수기 최종 Cold. 검토 불필요(과검출)이거나 감안 Hot이면 false. */
export function annotationFinalCold(r: {
  judgment: HumanJudgment;
  reviewNeeded?: boolean | null;
}): boolean {
  if (r.judgment === "best") return false;
  if (typeof r.reviewNeeded === "boolean" && r.reviewNeeded === false) return false;
  return r.judgment === "cold";
}

export type EvalReviewAnnotation = {
  annotationId: string;
  conversationId: string;
  /** ai = AI 뱃지 검수, human = STT에서 수기 추가 */
  source: "ai" | "human";
  atSec: number;
  segmentIndex: number | null;
  /** cold/hot: CS 체크리스트 id. best: 0 */
  criterionId: number;
  judgment: HumanJudgment;
  /**
   * 검토 필요 여부. Best는 null.
   * 필요 = AI 검토필요가 맞음(+ 미검출 포함). 불필요 = AI 과검출.
   * 8월 검수는 백필(Hot+코멘트 감안=필요, Hot만=불필요, Cold=필요). 필드 없으면 동일 규칙으로 파생.
   */
  reviewNeeded?: boolean | null;
  /** judgment === "best" 일 때 카테고리 id */
  bestCategory: BestMarkCategoryId | null;
  /** 항목 설정에 따른 수기 적용 범위. 기존 리뷰는 occurrence로 간주. */
  scope?: CriterionReviewScope;
  comment: string;
  aiCriterionId: number | null;
  aiViolated: boolean | null;
  aiQuote: string | null;
  aiReason: string | null;
  quote: string | null;
  updatedAt: string;
  updatedBy: string;
};

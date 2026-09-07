/** 프롬프트 개선 프레임워크 — 수기≠AI 불일치 백데이터 + LLM 초안 생성 */

export type PromptImproveSet = "train" | "test";

/**
 * train: QA 레퍼런스(AI 비교·개선) score_detail vs qa_eval checklist
 * test: 평가 진행 수기 리뷰(AI 정정 / 수기 추가)
 */
export type PromptImproveKind =
  | "fp" // AI만 검토필요(오탐)
  | "fn" // 수기만 검토필요(미탐)
  | "ai_corrected_fp" // 테스트: AI 검토필요를 수기가 불필요(과검출)로 정정
  | "ai_corrected_fn" // 테스트: AI 검토불필요를 수기가 필요로 정정
  | "human_added" // 테스트: AI가 안 잡은 구간을 수기 추가
  | "considered_hot"; // 테스트: 검토필요는 맞으나 최종 감안 Hot

export const PROMPT_IMPROVE_KIND_LABEL: Record<PromptImproveKind, string> = {
  fp: "FP · AI만 검토필요",
  fn: "FN · 수기만 검토필요",
  ai_corrected_fp: "AI 정정 · 과검출(검토 불필요)",
  ai_corrected_fn: "AI 정정 · 미검출(검토 필요)",
  human_added: "수기 추가 · AI 미감지",
  considered_hot: "감안 Hot · 검토필요는 맞음",
};

export type PromptImproveExample = {
  id: string;
  set: PromptImproveSet;
  kind: PromptImproveKind;
  criterionId: number;
  criterionLabel: string;
  category: string;
  conversationId: string;
  /** 수기/정정 근거 */
  humanNote: string;
  /** AI reason / quote */
  aiNote: string;
  quote: string | null;
  atSec: number | null;
  updatedAt: string | null;
};

export type PromptImproveCriterionGroup = {
  criterionId: number;
  label: string;
  category: string;
  counts: Partial<Record<PromptImproveKind, number>>;
  examples: PromptImproveExample[];
};

export type PromptImproveGenerateResult = {
  fields: Record<string, string>;
  rationale: string;
  model: string;
  llmCallId: string | null;
};

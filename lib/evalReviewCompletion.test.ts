import { describe, expect, it } from "vitest";
import { deriveHumanResultLabel, overlayLiveHumanResult } from "./humanResultDerive";
import type { EvalReviewAnnotation } from "./evalReviewTypes";
import type { ChecklistResult } from "./types";

/** 완료 테이블 분리 후: 결과 행에 review_completed 없어도 overlay 메타로 라벨 파생 */
describe("completion-table live human overlay", () => {
  const checklist: ChecklistResult[] = [
    { id: 1, violated: false, evidence: [], reason: "" },
  ];
  const coldReview: EvalReviewAnnotation = {
    annotationId: "a1",
    conversationId: "c1",
    source: "human",
    atSec: 10,
    segmentIndex: null,
    criterionId: 1,
    judgment: "cold",
    reviewNeeded: true,
    bestCategory: null,
    comment: "",
    aiCriterionId: null,
    aiViolated: null,
    aiQuote: null,
    aiReason: null,
    quote: null,
    updatedAt: "",
    updatedBy: "",
  };

  it("derives cold from human review when completion meta is present", () => {
    expect(deriveHumanResultLabel(checklist, [coldReview])).toBe("cold");
    const row = overlayLiveHumanResult(
      {
        purpose: "call_eval",
        reviewCompletedAt: "2026-08-26T00:00:00Z",
        humanResult: "",
        aiLabel: "hot",
        match: null,
        checklistJson: JSON.stringify(checklist),
      },
      [coldReview],
    );
    expect(row.humanResult).toBe("review_needed");
    expect(row.humanFinalLabel).toBe("cold");
    expect(row.match).toBe(false);
  });

  it("hides human label when not completed", () => {
    const row = overlayLiveHumanResult(
      {
        purpose: "call_eval",
        reviewCompletedAt: null,
        humanResult: "hot",
        aiLabel: "hot",
        match: true,
        checklistJson: JSON.stringify(checklist),
      },
      [coldReview],
    );
    expect(row.humanResult).toBe("");
    expect(row.match).toBeNull();
  });
});

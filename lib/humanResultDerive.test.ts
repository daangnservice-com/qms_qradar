import { describe, expect, it } from "vitest";
import type { EvalReviewAnnotation } from "./evalReviewTypes";
import {
  deriveHumanResultLabel,
  deriveHumanReviewNeededIds,
  deriveHumanReviewNeededLabel,
  deriveHumanViolatedIds,
  overlayLiveHumanResult,
} from "./humanResultDerive";
import { REVIEW_NEEDED_LABEL, REVIEW_NOT_NEEDED_LABEL } from "./promptTypes";
import type { ChecklistResult } from "./types";

const checklist = (...items: Array<[number, boolean]>): ChecklistResult[] =>
  items.map(([id, violated]) => ({ id, violated, evidence: [], reason: "" }));

const review = (
  partial: Partial<EvalReviewAnnotation> & Pick<EvalReviewAnnotation, "criterionId" | "judgment" | "source">,
): EvalReviewAnnotation => ({
  annotationId: partial.annotationId ?? "a",
  conversationId: partial.conversationId ?? "c",
  source: partial.source,
  atSec: partial.atSec ?? 0,
  segmentIndex: partial.segmentIndex ?? null,
  criterionId: partial.criterionId,
  judgment: partial.judgment,
  reviewNeeded: partial.reviewNeeded,
  bestCategory: partial.bestCategory ?? null,
  comment: partial.comment ?? "",
  aiCriterionId: partial.aiCriterionId ?? null,
  aiViolated: partial.aiViolated ?? null,
  aiQuote: partial.aiQuote ?? null,
  aiReason: partial.aiReason ?? null,
  quote: partial.quote ?? null,
  updatedAt: partial.updatedAt ?? "",
  updatedBy: partial.updatedBy ?? "",
});

describe("deriveHumanReviewNeededIds / deriveHumanReviewNeededLabel", () => {
  it("inherits AI violations as review-needed when there are no reviews", () => {
    const ids = deriveHumanReviewNeededIds(checklist([1, true], [2, false]), []);
    expect([...ids]).toEqual([1]);
    expect(deriveHumanReviewNeededLabel(checklist([1, true]), [])).toBe(REVIEW_NEEDED_LABEL);
    expect(deriveHumanReviewNeededLabel(checklist([1, false]), [])).toBe(REVIEW_NOT_NEEDED_LABEL);
  });

  it("drops review-needed when the AI badge is marked over-detected", () => {
    const ids = deriveHumanReviewNeededIds(checklist([1, true]), [
      review({ source: "ai", criterionId: 1, judgment: "hot", reviewNeeded: false }),
    ]);
    expect(ids.size).toBe(0);
    expect(
      deriveHumanReviewNeededLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot", reviewNeeded: false }),
      ]),
    ).toBe(REVIEW_NOT_NEEDED_LABEL);
  });

  it("keeps review-needed when confirmed then considered Hot", () => {
    expect(
      deriveHumanReviewNeededLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot", reviewNeeded: true }),
      ]),
    ).toBe(REVIEW_NEEDED_LABEL);
  });

  it("adds a human + mark as review-needed even when AI did not violate", () => {
    expect(
      deriveHumanReviewNeededLabel(checklist([1, false]), [
        review({ source: "human", criterionId: 1, judgment: "cold", reviewNeeded: true }),
      ]),
    ).toBe(REVIEW_NEEDED_LABEL);
    expect(
      deriveHumanReviewNeededLabel(checklist([1, false]), [
        review({ source: "human", criterionId: 1, judgment: "hot", reviewNeeded: true }),
      ]),
    ).toBe(REVIEW_NEEDED_LABEL);
  });
});

describe("deriveHumanViolatedIds / deriveHumanResultLabel (final Cold/Hot)", () => {
  it("inherits AI violations when there are no reviews", () => {
    const ids = deriveHumanViolatedIds(checklist([1, true], [2, false]), []);
    expect([...ids]).toEqual([1]);
    expect(deriveHumanResultLabel(checklist([1, true]), [])).toBe("cold");
    expect(deriveHumanResultLabel(checklist([1, false]), [])).toBe("hot");
  });

  it("drops final Cold when the AI badge is marked over-detected", () => {
    const ids = deriveHumanViolatedIds(checklist([1, true]), [
      review({ source: "ai", criterionId: 1, judgment: "hot", reviewNeeded: false }),
    ]);
    expect(ids.size).toBe(0);
    expect(
      deriveHumanResultLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot", reviewNeeded: false }),
      ]),
    ).toBe("hot");
  });

  it("drops final Cold when review is needed but considered Hot", () => {
    expect(
      deriveHumanResultLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot", reviewNeeded: true }),
      ]),
    ).toBe("hot");
  });

  it("adds a human cold mark even when AI did not violate", () => {
    expect(
      deriveHumanResultLabel(checklist([1, false]), [
        review({ source: "human", criterionId: 1, judgment: "cold", reviewNeeded: true }),
      ]),
    ).toBe("cold");
  });

  it("does not make final Cold when human + is considered Hot", () => {
    expect(
      deriveHumanResultLabel(checklist([1, false]), [
        review({ source: "human", criterionId: 1, judgment: "hot", reviewNeeded: true }),
      ]),
    ).toBe("hot");
  });

  it("ignores best marks", () => {
    expect(
      deriveHumanResultLabel(checklist([1, false]), [
        review({ source: "human", criterionId: 0, judgment: "best", bestCategory: "empathy" }),
      ]),
    ).toBe("hot");
  });

  it("uses only the latest review per criterion when duplicates exist", () => {
    expect(
      deriveHumanResultLabel(checklist([415, true]), [
        review({
          annotationId: "old",
          source: "ai",
          criterionId: 415,
          judgment: "hot",
          reviewNeeded: false,
          updatedAt: "2026-08-25T09:09:22.368Z",
        }),
        review({
          annotationId: "new",
          source: "ai",
          criterionId: 415,
          judgment: "cold",
          reviewNeeded: true,
          updatedAt: "2026-08-26T05:26:59.833Z",
        }),
      ]),
    ).toBe("cold");

    expect(
      deriveHumanResultLabel(checklist([415, true]), [
        review({
          annotationId: "new",
          source: "ai",
          criterionId: 415,
          judgment: "cold",
          reviewNeeded: true,
          updatedAt: "2026-08-26T05:26:59.833Z",
        }),
        review({
          annotationId: "old",
          source: "ai",
          criterionId: 415,
          judgment: "hot",
          reviewNeeded: false,
          updatedAt: "2026-08-25T09:09:22.368Z",
        }),
      ]),
    ).toBe("cold");
  });

  it("falls back to over-detected when legacy Hot has no 감안 comment", () => {
    expect(
      deriveHumanReviewNeededLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot" }),
      ]),
    ).toBe(REVIEW_NOT_NEEDED_LABEL);
    expect(
      deriveHumanResultLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot" }),
      ]),
    ).toBe("hot");
  });

  it("treats legacy Hot + 감안 comment as review-needed, still final Hot", () => {
    expect(
      deriveHumanReviewNeededLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot", comment: "경미해서 감안" }),
      ]),
    ).toBe(REVIEW_NEEDED_LABEL);
    expect(
      deriveHumanResultLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "hot", comment: "경미해서 감안" }),
      ]),
    ).toBe("hot");
  });

  it("treats legacy Cold as review-needed + final Cold", () => {
    expect(
      deriveHumanReviewNeededLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "cold" }),
      ]),
    ).toBe(REVIEW_NEEDED_LABEL);
    expect(
      deriveHumanResultLabel(checklist([1, true]), [
        review({ source: "ai", criterionId: 1, judgment: "cold" }),
      ]),
    ).toBe("cold");
  });
});

describe("overlayLiveHumanResult", () => {
  it("keeps qa_eval stored gold labels, canonicalized to review-needed", () => {
    const row = overlayLiveHumanResult(
      {
        purpose: "qa_eval",
        reviewCompletedAt: "2026-08-01T00:00:00Z",
        humanResult: "cold",
        aiLabel: "hot",
        match: false,
        checklistJson: JSON.stringify(checklist([1, false])),
      },
      [review({ source: "human", criterionId: 1, judgment: "cold", reviewNeeded: true })],
    );
    expect(row.humanResult).toBe(REVIEW_NEEDED_LABEL);
    expect(row.aiLabel).toBe(REVIEW_NOT_NEEDED_LABEL);
    expect(row.humanFinalLabel).toBe("cold");
    expect(row.match).toBe(false);
  });

  it("clears the label before review is completed", () => {
    const row = overlayLiveHumanResult(
      {
        purpose: "call_eval",
        reviewCompletedAt: null,
        humanResult: "hot",
        aiLabel: "cold",
        match: false,
        checklistJson: JSON.stringify(checklist([1, true])),
      },
      [],
    );
    expect(row.humanResult).toBe("");
    expect(row.humanFinalLabel).toBe("");
    expect(row.match).toBeNull();
  });

  it("recomputes call_eval review-needed from current reviews, not the stored snapshot", () => {
    const row = overlayLiveHumanResult(
      {
        purpose: "call_eval",
        reviewCompletedAt: "2026-08-01T00:00:00Z",
        humanResult: "hot",
        aiLabel: "hot",
        match: true,
        checklistJson: JSON.stringify(checklist([1, false])),
      },
      [review({ source: "human", criterionId: 1, judgment: "cold", reviewNeeded: true })],
    );
    expect(row.humanResult).toBe(REVIEW_NEEDED_LABEL);
    expect(row.humanFinalLabel).toBe("cold");
    expect(row.match).toBe(false);
  });

  it("treats considered Hot as review-needed TP against AI violated", () => {
    const row = overlayLiveHumanResult(
      {
        purpose: "call_eval",
        reviewCompletedAt: "2026-09-01T00:00:00Z",
        humanResult: "",
        aiLabel: "cold",
        match: null,
        checklistJson: JSON.stringify(checklist([1, true])),
      },
      [review({ source: "ai", criterionId: 1, judgment: "hot", reviewNeeded: true })],
    );
    expect(row.humanResult).toBe(REVIEW_NEEDED_LABEL);
    expect(row.humanFinalLabel).toBe("hot");
    expect(row.aiLabel).toBe(REVIEW_NEEDED_LABEL);
    expect(row.match).toBe(true);
  });
});

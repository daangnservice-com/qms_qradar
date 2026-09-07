import { describe, expect, it } from "vitest";
import {
  annotationFinalCold,
  annotationReviewNeeded,
  inferLegacyReviewNeeded,
  needsLegacyReviewNeededBackfill,
} from "./evalReviewTypes";

describe("inferLegacyReviewNeeded", () => {
  it("fills Cold as review-needed", () => {
    expect(inferLegacyReviewNeeded({ judgment: "cold", comment: "" })).toBe(true);
    expect(inferLegacyReviewNeeded({ judgment: "cold", comment: "감안 불가" })).toBe(true);
  });

  it("fills Hot + 감안 as review-needed", () => {
    expect(inferLegacyReviewNeeded({ judgment: "hot", comment: "단발이라 감안" })).toBe(true);
    expect(inferLegacyReviewNeeded({ judgment: "hot", comment: "감안함" })).toBe(true);
  });

  it("fills Hot without 감안 as over-detected", () => {
    expect(inferLegacyReviewNeeded({ judgment: "hot", comment: "" })).toBe(false);
    expect(inferLegacyReviewNeeded({ judgment: "hot", comment: "과검출" })).toBe(false);
  });

  it("does not fill Best", () => {
    expect(inferLegacyReviewNeeded({ judgment: "best", comment: "감안" })).toBeNull();
  });
});

describe("needsLegacyReviewNeededBackfill / annotationReviewNeeded", () => {
  it("skips rows that already have the field", () => {
    expect(needsLegacyReviewNeededBackfill({ judgment: "hot", reviewNeeded: false })).toBe(false);
    expect(
      annotationReviewNeeded({ judgment: "hot", reviewNeeded: false, comment: "감안" }),
    ).toBe(false);
    expect(
      annotationReviewNeeded({ judgment: "hot", reviewNeeded: true, comment: "" }),
    ).toBe(true);
  });

  it("skips Best", () => {
    expect(needsLegacyReviewNeededBackfill({ judgment: "best" })).toBe(false);
    expect(annotationReviewNeeded({ judgment: "best", comment: "감안" })).toBe(false);
  });

  it("uses the 감안 comment fallback when the field is missing", () => {
    expect(needsLegacyReviewNeededBackfill({ judgment: "hot" })).toBe(true);
    expect(annotationReviewNeeded({ judgment: "hot", comment: "감안" })).toBe(true);
    expect(annotationReviewNeeded({ judgment: "hot", comment: "" })).toBe(false);
    expect(annotationReviewNeeded({ judgment: "cold" })).toBe(true);
  });
});

describe("annotationFinalCold", () => {
  it("keeps Hot as not final Cold even when review is needed", () => {
    expect(annotationFinalCold({ judgment: "hot", reviewNeeded: true })).toBe(false);
    expect(annotationFinalCold({ judgment: "hot" })).toBe(false);
  });

  it("keeps Cold as final Cold", () => {
    expect(annotationFinalCold({ judgment: "cold" })).toBe(true);
    expect(annotationFinalCold({ judgment: "cold", reviewNeeded: true })).toBe(true);
  });
});

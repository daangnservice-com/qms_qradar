import { describe, it, expect } from "vitest";
import {
  buildCriterionMetaMap,
  resolveCriterionLabel,
  resolveCriterionOptions,
} from "./criterionLabel";
import { CS_CHECKLIST } from "./csChecklist";

describe("criterionLabel", () => {
  it("falls back to CS_CHECKLIST for known ids", () => {
    expect(resolveCriterionLabel(407)).toBe("인사 누락");
    expect(resolveCriterionLabel(99999)).toBe("항목 99999");
  });

  it("uses prompt criteria snapshot over hardcoded (e.g. Best 340)", () => {
    const criteria = [
      { id: 340, label: "Best 후보", category: "우수상담 후보군" },
      { id: 407, label: "인사 누락 (평가셋)", category: "예절" },
    ];
    expect(resolveCriterionLabel(340, criteria)).toBe("Best 후보");
    expect(resolveCriterionLabel(407, criteria)).toBe("인사 누락 (평가셋)");
    expect(buildCriterionMetaMap(criteria).get(340)?.category).toBe("우수상담 후보군");
  });

  it("resolveCriterionOptions prefers snapshot when present", () => {
    const opts = resolveCriterionOptions([{ id: 340, label: "Best 후보", category: "우수상담 후보군" }]);
    expect(opts).toHaveLength(1);
    expect(opts[0].id).toBe(340);
    expect(resolveCriterionOptions(null)).toHaveLength(CS_CHECKLIST.length);
  });
});

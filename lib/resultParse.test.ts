import { describe, expect, it } from "vitest";
import { deriveEvalLabel, labelsMatch, normalizeHumanResult } from "./resultParse";
import { DEFAULT_RESULT_PARSE_CONFIG } from "./promptTypes";

describe("resultParse", () => {
  it("marks review_needed when any violated", () => {
    expect(
      deriveEvalLabel(
        { csChecklist: [{ id: 1, violated: false, evidence: [], reason: "" }] },
        DEFAULT_RESULT_PARSE_CONFIG,
      ),
    ).toBe("review_not_needed");
    expect(
      deriveEvalLabel(
        {
          csChecklist: [
            { id: 1, violated: false, evidence: [], reason: "" },
            { id: 2, violated: true, evidence: [], reason: "x" },
          ],
        },
        DEFAULT_RESULT_PARSE_CONFIG,
      ),
    ).toBe("review_needed");
  });

  it("normalizes and matches labels including cold/hot aliases", () => {
    expect(normalizeHumanResult(" Cold ")).toBe("cold");
    expect(labelsMatch("COLD", "cold")).toBe(true);
    expect(labelsMatch("cold", "review_needed")).toBe(true);
    expect(labelsMatch("hot", "review_not_needed")).toBe(true);
    expect(labelsMatch("hot", "cold")).toBe(false);
  });
});

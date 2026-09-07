import { describe, expect, it } from "vitest";
import { formatPromptFieldText, formatPromptFields } from "./promptFieldFormat";

describe("formatPromptFieldText", () => {
  it("inserts newlines after sentence endings when wall of text", () => {
    const raw =
      "상담 시작 인사를 누락하면 위반이다. 재확인 시에도 재인사가 필요합니다. 예) 안녕하세요 당근입니다.";
    const out = formatPromptFieldText(raw);
    expect(out).toContain("\n");
    expect(out.split("\n").length).toBeGreaterThan(1);
  });

  it("keeps existing newlines and trims", () => {
    expect(formatPromptFieldText("첫 줄.\n\n\n둘째 줄.")).toBe("첫 줄.\n\n둘째 줄.");
  });

  it("formats field map", () => {
    const out = formatPromptFields({ definition: "A다. B요.", good: "" });
    expect(out.definition).toContain("\n");
    expect(out.good).toBe("");
  });
});

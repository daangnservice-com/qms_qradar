import { describe, it, expect } from "vitest";
import { renderTemplate, buildChecklistBlock, parseCriteriaJson, parseSchemaJson } from "./promptRender";
import { DEFAULT_CHECKLIST_TEMPLATE } from "./promptDefaults";

describe("promptRender", () => {
  it("replaces {{vars}} and blanks missing keys", () => {
    expect(renderTemplate("A={{a}} B={{b}}", { a: "1" })).toBe("A=1 B=");
  });

  it("builds checklist block from template + criteria", () => {
    const block = buildChecklistBlock(DEFAULT_CHECKLIST_TEMPLATE, [
      {
        id: 407,
        category: "예절과 화법",
        label: "인사 누락",
        hint: "h",
        fields: { definition: "정의문", good: "좋음", bad: "", exception: "" },
      },
    ]);
    expect(block).toContain("아래 1개 항목");
    expect(block).toContain("[407]");
    expect(block).toContain("인사 누락");
    expect(block).toContain("정의:");
    expect(block).toContain("정의문");
  });

  it("parses criteria and schema JSON", () => {
    expect(parseCriteriaJson('[{"id":1,"category":"c","label":"l","hint":"h"}]')).toEqual([
      { id: 1, category: "c", label: "l", hint: "h", fields: { definition: "h" } },
    ]);
    expect(parseSchemaJson('{"type":"object"}')).toEqual({ type: "object" });
    expect(() => parseSchemaJson("[]")).toThrow();
  });

  it("previews final prompt with checklist", async () => {
    const { previewFinalPrompt } = await import("./promptRender");
    const text = previewFinalPrompt({
      basePrompt: "BASE{{checklist_block}}",
      checklistTemplate: "CL {{criteria_count}}\n{{criteria_list}}",
      criteria: [
        {
          id: 1,
          category: "c",
          label: "l",
          hint: "",
          fields: { definition: "정의" },
        },
      ],
      useChecklist: true,
    });
    expect(text).toContain("BASE");
    expect(text).toContain("CL 1");
    expect(text).toContain("[1]");
    expect(text).toContain("정의");
  });

  it("injects score_items and overall_fields into preview", async () => {
    const { previewFinalPrompt } = await import("./promptRender");
    const text = previewFinalPrompt({
      basePrompt: "SCORES\n{{score_items}}\nFIELDS\n{{overall_fields}}",
      checklistTemplate: "",
      criteria: [],
      useChecklist: false,
      outputSchemaConfig: {
        includeScores: true,
        includeOverallSummary: true,
        includeSilenceComments: false,
        includeAgentSpeakerTag: false,
        includeCsChecklist: false,
        checklistFields: { id: true, violated: true, reason: true, evidence: true },
        scoreFields: [{ key: "empathy", label: "공감", sortOrder: 1 }],
        overallSummaryFields: [{ key: "strengths", label: "강점", sortOrder: 1 }],
      },
    });
    expect(text).toContain("공감 (empathy)");
    expect(text).toContain("강점 (strengths)");
  });
});

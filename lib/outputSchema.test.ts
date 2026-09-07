import { describe, it, expect } from "vitest";
import {
  buildResponseSchemaFromConfig,
  parseOutputSchemaConfig,
  formatScoreItemsPrompt,
  formatOverallFieldsPrompt,
  flattenOverallSummary,
  snapshotOutputSchema,
} from "./outputSchema";
import { DEFAULT_OUTPUT_SCHEMA_CONFIG, DEFAULT_SCORE_FIELDS } from "./promptTypes";

describe("parseOutputSchemaConfig", () => {
  it("fills default 3 score fields and empty overall fields for legacy JSON", () => {
    const cfg = parseOutputSchemaConfig({
      includeScores: true,
      includeOverallSummary: true,
    });
    expect(cfg.scoreFields.map((f) => f.key)).toEqual(["attitude", "resolution", "flow"]);
    expect(cfg.overallSummaryFields).toEqual([]);
    expect(cfg.includeScores).toBe(true);
  });

  it("keeps custom score and overall fields", () => {
    const cfg = parseOutputSchemaConfig({
      scoreFields: [
        { key: "empathy", label: "공감", sortOrder: 2 },
        { key: "resolution", label: "해결", sortOrder: 1 },
        { key: "1bad", label: "무효", sortOrder: 3 },
      ],
      overallSummaryFields: [{ key: "strengths", label: "강점", sortOrder: 1 }],
    });
    expect(cfg.scoreFields.map((f) => f.key)).toEqual(["empathy", "resolution"]);
    expect(cfg.overallSummaryFields).toEqual([{ key: "strengths", label: "강점", sortOrder: 1 }]);
  });
});

describe("buildResponseSchemaFromConfig", () => {
  it("keeps legacy string overallSummary when fields are empty", () => {
    const schema = buildResponseSchemaFromConfig(DEFAULT_OUTPUT_SCHEMA_CONFIG) as {
      properties: Record<string, { type?: string; properties?: Record<string, unknown>; required?: string[] }>;
      required: string[];
    };
    expect(schema.properties.scores?.required).toEqual(["attitude", "resolution", "flow"]);
    expect(schema.properties.overallSummary).toEqual({ type: "string" });
  });

  it("builds custom score keys and object overallSummary", () => {
    const schema = buildResponseSchemaFromConfig({
      ...DEFAULT_OUTPUT_SCHEMA_CONFIG,
      includeSilenceComments: false,
      includeCsChecklist: false,
      includeAgentSpeakerTag: false,
      scoreFields: [
        { key: "empathy", label: "공감", sortOrder: 1 },
        { key: "clarity", label: "명확성", sortOrder: 2 },
      ],
      overallSummaryFields: [
        { key: "strengths", label: "강점", sortOrder: 1 },
        { key: "improvements", label: "개선", sortOrder: 2 },
      ],
    }) as {
      properties: {
        scores: { properties: Record<string, unknown>; required: string[] };
        overallSummary: { type: string; properties: Record<string, unknown>; required: string[] };
      };
    };
    expect(schema.properties.scores.required).toEqual(["empathy", "clarity"]);
    expect(schema.properties.overallSummary.type).toBe("object");
    expect(schema.properties.overallSummary.required).toEqual(["strengths", "improvements"]);
    expect(schema.properties.overallSummary.properties.strengths).toEqual({ type: "string" });
  });
});

describe("prompt vars and flatten", () => {
  it("formats score/overall prompt lists", () => {
    expect(formatScoreItemsPrompt({ scoreFields: DEFAULT_SCORE_FIELDS })).toContain("attitude");
    expect(formatOverallFieldsPrompt({ overallSummaryFields: [] })).toContain("문자열");
    expect(
      formatOverallFieldsPrompt({
        overallSummaryFields: [{ key: "strengths", label: "강점", sortOrder: 1 }],
      }),
    ).toContain("강점 (strengths)");
  });

  it("flattens overall summary for BQ", () => {
    expect(flattenOverallSummary("한 줄")).toBe("한 줄");
    expect(flattenOverallSummary({ a: "강점", b: "개선" })).toBe("강점\n개선");
    expect(flattenOverallSummary({})).toBe("");
  });

  it("snapshots enabled fields only", () => {
    const snap = snapshotOutputSchema({
      ...DEFAULT_OUTPUT_SCHEMA_CONFIG,
      includeScores: false,
      overallSummaryFields: [{ key: "strengths", label: "강점", sortOrder: 1 }],
    });
    expect(snap.scoreFields).toEqual([]);
    expect(snap.overallSummaryFields[0].key).toBe("strengths");
  });
});

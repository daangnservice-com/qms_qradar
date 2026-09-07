import { describe, it, expect } from "vitest";
import {
  computeAgentSpeakRatioPercent,
  computeOverlapRatioPercent,
  buildSignalMetrics,
} from "./callMetrics";
import { matchMetricHighRiskFlags, type HighRiskFlagRule } from "./highRiskFlags";
import { buildResponseSchemaFromConfig, formatScoreItemsPrompt } from "./outputSchema";
import { DEFAULT_OUTPUT_SCHEMA_CONFIG, RECOMMENDED_METRIC_FIELDS } from "./promptTypes";

describe("callMetrics", () => {
  it("computes agent speak ratio from STT", () => {
    const ratio = computeAgentSpeakRatioPercent(
      [
        { atSec: 0, endSec: 4, speakerTag: 1 },
        { atSec: 4, endSec: 6, speakerTag: 2 },
      ],
      1,
    );
    expect(ratio).toBe(66.7);
  });

  it("computes overlap ratio", () => {
    expect(computeOverlapRatioPercent([{ durationSec: 10 }], 100)).toBe(10);
    expect(computeOverlapRatioPercent([], 0)).toBeNull();
  });

  it("builds signal metrics for recommended fields", () => {
    const m = buildSignalMetrics({
      fields: RECOMMENDED_METRIC_FIELDS,
      agentSpeakRatioPercent: 55,
      overlapRatioPercent: 3.2,
    });
    expect(m.agentSpeakRatio.value).toBe(55);
    expect(m.overlapRatio.value).toBe(3.2);
    expect(m.agitated).toBeUndefined();
  });
});

describe("highRiskFlags", () => {
  const rules: HighRiskFlagRule[] = [
    {
      ruleId: "1",
      key: "agent_speak_high",
      label: "발화과다",
      enabled: true,
      kind: "agent_speak_ratio",
      params: { minPercent: 70, metricKey: "agentSpeakRatio" },
      sortOrder: 1,
      updatedAt: "",
      updatedBy: "",
    },
    {
      ruleId: "2",
      key: "agitated",
      label: "격앙",
      enabled: true,
      kind: "sentiment_agitated",
      params: { metricKey: "agitated" },
      sortOrder: 2,
      updatedAt: "",
      updatedBy: "",
    },
  ];

  it("matches speak ratio and agitation", () => {
    const hits = matchMetricHighRiskFlags(rules, {
      agentSpeakRatio: { valueType: "percent", value: 80, source: "signal" },
      agitated: { valueType: "bool", value: true, comment: "고성", source: "llm" },
    });
    expect(hits.map((h) => h.key)).toEqual(["agent_speak_high", "agitated"]);
  });
});

describe("typed output schema", () => {
  it("puts llm bool under metrics and skips signal fields", () => {
    const schema = buildResponseSchemaFromConfig({
      ...DEFAULT_OUTPUT_SCHEMA_CONFIG,
      includeSilenceComments: false,
      includeCsChecklist: false,
      includeAgentSpeakerTag: false,
      includeOverallSummary: false,
      scoreFields: RECOMMENDED_METRIC_FIELDS.map((f) => ({ ...f })),
    }) as {
      properties: { scores?: unknown; metrics?: { required: string[] } };
      required: string[];
    };
    expect(schema.properties.scores).toBeUndefined();
    expect(schema.properties.metrics?.required).toEqual(["agitated"]);
    expect(schema.required).toContain("metrics");
    expect(schema.required).not.toContain("scores");
  });

  it("formats definitions and signal note in prompt", () => {
    const text = formatScoreItemsPrompt({ scoreFields: RECOMMENDED_METRIC_FIELDS });
    expect(text).toContain("격앙 감지 (agitated)");
    expect(text).toContain("정의:");
    expect(text).toContain("시스템 계산 메트릭");
    expect(text).toContain("agentSpeakRatio");
  });
});

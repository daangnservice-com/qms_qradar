import { describe, expect, it } from "vitest";
import { parseScoreDetail, compareCriterionScores, classifyMatchGrade } from "./scoreDetailParse";

describe("parseScoreDetail", () => {
  it("parses trailing (id) labels", () => {
    const text = [
      "(문의 이해 실패) 동문서답하는 경우(423)",
      "(문의 이해 실패) 고객으로부터 니즈 확인이 정정된 경우(424)",
      "재진술이 누락된 경우(429)",
    ].join("\n");
    expect(parseScoreDetail(text)).toEqual([
      { id: 423, label: "(문의 이해 실패) 동문서답하는 경우", raw: "(문의 이해 실패) 동문서답하는 경우(423)" },
      {
        id: 424,
        label: "(문의 이해 실패) 고객으로부터 니즈 확인이 정정된 경우",
        raw: "(문의 이해 실패) 고객으로부터 니즈 확인이 정정된 경우(424)",
      },
      { id: 429, label: "재진술이 누락된 경우", raw: "재진술이 누락된 경우(429)" },
    ]);
  });

  it("handles parentheses inside label before final id", () => {
    const items = parseScoreDetail("상황에 맞는 필수 멘트 미사용 (배려, 화답, 사과, 쿠션어 등)(408)");
    expect(items).toEqual([
      {
        id: 408,
        label: "상황에 맞는 필수 멘트 미사용 (배려, 화답, 사과, 쿠션어 등)",
        raw: "상황에 맞는 필수 멘트 미사용 (배려, 화답, 사과, 쿠션어 등)(408)",
      },
    ]);
  });

  it("returns empty for blank", () => {
    expect(parseScoreDetail("")).toEqual([]);
    expect(parseScoreDetail(null)).toEqual([]);
  });
});

describe("compareCriterionScores", () => {
  it("computes tp/fp/fn", () => {
    const { summary, rows } = compareCriterionScores({
      humanItems: [
        { id: 408, label: "a", raw: "a(408)" },
        { id: 416, label: "b", raw: "b(416)" },
      ],
      aiChecklist: [
        { id: 408, violated: true, reason: "x" },
        { id: 416, violated: false },
        { id: 415, violated: true },
      ],
    });
    expect(summary).toEqual({ tp: 1, fp: 1, fn: 1, tn: 0 });
    expect(rows.find((r) => r.id === 408)?.status).toBe("tp");
    expect(rows.find((r) => r.id === 416)?.status).toBe("fn");
    expect(rows.find((r) => r.id === 415)?.status).toBe("fp");
  });

  it("falls back to labelById when human/ai labels missing", () => {
    const { rows } = compareCriterionScores({
      humanItems: [],
      aiChecklist: [{ id: 415, violated: true }],
      labelById: { 415: "상황에 맞는 공감 누락 및 미흡" },
    });
    expect(rows.find((r) => r.id === 415)?.label).toBe("상황에 맞는 공감 누락 및 미흡");
  });
});

describe("classifyMatchGrade", () => {
  it("unevaluated when no AI label", () => {
    expect(
      classifyMatchGrade({
        humanResult: "cold",
        aiLabel: null,
        humanItemIds: [1],
        aiViolatedIds: [],
        hasAiResult: false,
      }),
    ).toBe("unevaluated");
  });

  it("result_mismatch", () => {
    expect(
      classifyMatchGrade({
        humanResult: "cold",
        aiLabel: "hot",
        humanItemIds: [1],
        aiViolatedIds: [1],
        hasAiResult: true,
      }),
    ).toBe("result_mismatch");
  });

  it("full when labels and item sets match (incl. empty)", () => {
    expect(
      classifyMatchGrade({
        humanResult: "cold",
        aiLabel: "cold",
        humanItemIds: [408, 416],
        aiViolatedIds: [416, 408],
        hasAiResult: true,
      }),
    ).toBe("full");
    expect(
      classifyMatchGrade({
        humanResult: "hot",
        aiLabel: "hot",
        humanItemIds: [],
        aiViolatedIds: [],
        hasAiResult: true,
      }),
    ).toBe("full");
  });

  it("partial_items when overlap and diff", () => {
    expect(
      classifyMatchGrade({
        humanResult: "cold",
        aiLabel: "cold",
        humanItemIds: [408, 416],
        aiViolatedIds: [408, 415],
        hasAiResult: true,
      }),
    ).toBe("partial_items");
  });

  it("result_only when label match but zero overlap", () => {
    expect(
      classifyMatchGrade({
        humanResult: "cold",
        aiLabel: "cold",
        humanItemIds: [408],
        aiViolatedIds: [415],
        hasAiResult: true,
      }),
    ).toBe("result_only");
  });
});

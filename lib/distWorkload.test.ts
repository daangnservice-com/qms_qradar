import { describe, expect, it } from "vitest";
import { fmtMin, formatMetricKo, parseEvalItems } from "./distWorkload";

describe("parseEvalItems", () => {
  it("returns empty for blank values", () => {
    expect(parseEvalItems("")).toEqual([]);
    expect(parseEvalItems(null)).toEqual([]);
    expect(parseEvalItems(undefined)).toEqual([]);
  });

  it("splits comma-separated channels", () => {
    expect(parseEvalItems("문의,전화")).toEqual(["문의", "전화"]);
    expect(parseEvalItems("문의, 채팅")).toEqual(["문의", "채팅"]);
  });

  it("passes through arrays without inventing extra channels", () => {
    expect(parseEvalItems(["사업심사"])).toEqual(["사업심사"]);
    expect(parseEvalItems(["문의", "채팅"])).toEqual(["문의", "채팅"]);
  });

  it("parses JSON array strings", () => {
    expect(parseEvalItems('["문의","전화"]')).toEqual(["문의", "전화"]);
  });
});

describe("fmtMin", () => {
  it("keeps minutes under an hour", () => {
    expect(fmtMin(12.7)).toBe("12.7분");
  });

  it("switches to hours at 60", () => {
    expect(fmtMin(90)).toBe("1.5h");
  });
});

describe("formatMetricKo", () => {
  it("renders hours and counts for graph captions", () => {
    expect(formatMetricKo(180, "time")).toBe("3시간");
    expect(formatMetricKo(240, "time")).toBe("4시간");
    expect(formatMetricKo(12, "count")).toBe("12건");
  });
});

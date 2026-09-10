import { describe, it, expect } from "vitest";
import { DSAT_FLAG_KEY, resolveDsatRule, type HighRiskFlagRule } from "./highRiskFlags";
import { isDsatRate } from "./csat";

function rule(over: Partial<HighRiskFlagRule>): HighRiskFlagRule {
  return {
    ruleId: "r1",
    key: "dsat",
    label: "DSAT",
    enabled: true,
    kind: "csat_dsat",
    params: { maxRate: 2 },
    sortOrder: 4,
    updatedAt: "",
    updatedBy: "",
    ...over,
  };
}

describe("resolveDsatRule", () => {
  it("규칙 행이 없으면 기본값으로 켜진 것으로 본다", () => {
    // 규칙 테이블이 이미 시드된 배포에는 csat_dsat 행이 없다.
    expect(resolveDsatRule([])).toEqual({ enabled: true, maxRate: 2, key: DSAT_FLAG_KEY });
    expect(resolveDsatRule(null)).toEqual({ enabled: true, maxRate: 2, key: DSAT_FLAG_KEY });
  });

  it("저장된 규칙이 있으면 그쪽이 이긴다", () => {
    expect(resolveDsatRule([rule({ enabled: false })])).toEqual({
      enabled: false,
      maxRate: 2,
      key: "dsat",
    });
    expect(resolveDsatRule([rule({ key: "csat_low", params: { maxRate: 3 } })])).toEqual({
      enabled: true,
      maxRate: 3,
      key: "csat_low",
    });
  });

  it("maxRate가 비어 있으면 기본값으로 떨어진다", () => {
    expect(resolveDsatRule([rule({ params: { maxRate: null } })]).maxRate).toBe(2);
  });

  it("다른 종류의 규칙은 무시한다", () => {
    const longCall = rule({ kind: "long_call_percentile", key: "long_call", params: { percentile: 10 } });
    expect(resolveDsatRule([longCall])).toEqual({ enabled: true, maxRate: 2, key: DSAT_FLAG_KEY });
  });
});

describe("isDsatRate", () => {
  it("기준 이하 점수만 DSAT", () => {
    expect(isDsatRate(1, 2)).toBe(true);
    expect(isDsatRate(2, 2)).toBe(true);
    expect(isDsatRate(3, 2)).toBe(false);
    expect(isDsatRate(5, 2)).toBe(false);
  });

  it("설문 미참여(점수 없음)는 DSAT이 아니다", () => {
    expect(isDsatRate(null, 2)).toBe(false);
    expect(isDsatRate(undefined, 2)).toBe(false);
    expect(isDsatRate(Number.NaN, 2)).toBe(false);
  });
});

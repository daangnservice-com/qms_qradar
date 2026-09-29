import { describe, expect, it } from "vitest";
import { buildServingListQuery, rowToServingSample } from "./callServingStore";

describe("buildServingListQuery", () => {
  it("날짜 필터는 call_date_kst DATE 비교다", () => {
    const plan = buildServingListQuery({
      filters: { callDateStart: "2026-07-28", callDateEnd: "2026-07-28" },
      limit: 100,
    });
    expect(plan.empty).toBe(false);
    if (plan.empty) return;
    expect(plan.text).toContain("listed.call_date_kst >= $1::date");
    expect(plan.text).toContain("listed.call_date_kst <= $2::date");
    expect(plan.text).not.toContain("case_content");
    expect(plan.values).toEqual(["2026-07-28", "2026-07-28", 100]);
  });

  it("날짜 필터가 없으면 날짜 조건을 붙이지 않는다", () => {
    const plan = buildServingListQuery({ filters: {}, limit: 100 });
    expect(plan.empty).toBe(false);
    if (plan.empty) return;
    expect(plan.text).not.toContain("call_date_kst >=");
    expect(plan.values).toEqual([100]);
  });

  it("검수 요청 풀이 비어 있으면 쿼리를 만들지 않는다", () => {
    expect(
      buildServingListQuery({ filters: { reviewRequestedOnly: true }, limit: 50, reviewRequestIds: [] }).empty,
    ).toBe(true);
  });
});

describe("rowToServingSample", () => {
  it("목록 표시용 날짜·길이·플래그를 인덱스 행에서 읽는다", () => {
    const s = rowToServingSample({
      conversation_id: "c1",
      phone_inquiry_id: "p1",
      call_date_kst: "2026-07-29",
      call_start_kst: "2026-07-29 08:30:00",
      duration_sec: 300,
      analyzed: true,
      csat_rate: 1,
      high_risk_flag_keys: ["dsat"],
      has_stt: false,
    });
    expect(s.callDate).toBe("2026-07-29");
    expect(s.callStartKst).toBe("2026-07-29 08:30:00");
    expect(s.callDurationSec).toBe(300);
    expect(s.analyzed).toBe(true);
    expect(s.csatRate).toBe(1);
    expect(s.highRiskFlagKeys).toEqual(["dsat"]);
  });
});

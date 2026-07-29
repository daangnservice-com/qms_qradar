import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("./bigquery", () => ({ getBQ: () => ({ query }) }));

import { listEvaluationSamples } from "./evaluationSamples";

const lastQuery = () => String(query.mock.calls.at(-1)?.[0]?.query ?? "");

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue([[]]);
});

describe("listEvaluationSamples — 콜 날짜는 KST 기준", () => {
  it("날짜 필터를 Asia/Seoul로 변환해 비교한다(UTC 앞 10자 비교 금지)", async () => {
    await listEvaluationSamples({ callDateStart: "2026-07-28", callDateEnd: "2026-07-28" });
    const q = lastQuery();
    expect(q).toContain("'Asia/Seoul'");
    // call_start는 UTC라, 앞 10자를 그대로 쓰면 KST 09시 이전 통화가 전날로 밀린다.
    expect(q).not.toContain("substr(json_value(case_content, '$.call_start'), 1, 10)");
    expect(query.mock.calls.at(-1)?.[0]?.params).toMatchObject({
      callDateStart: "2026-07-28",
      callDateEnd: "2026-07-28",
    });
  });

  it("날짜 필터가 없으면 날짜 조건을 붙이지 않는다", async () => {
    await listEvaluationSamples({});
    expect(query.mock.calls.at(-1)?.[0]?.params).not.toHaveProperty("callDateStart");
  });

  it("표시용 콜 날짜도 KST 컬럼(call_date_kst)에서 가져온다", async () => {
    query.mockResolvedValue([
      [
        {
          conversation_id: "c1",
          call_start: "2026-07-28T23:30:00.000000Z", // UTC 07-28 = KST 07-29
          call_date_kst: "2026-07-29",
          call_end: "2026-07-28T23:35:00.000000Z",
          minutes_taken: "5",
        },
      ],
    ]);
    const [s] = await listEvaluationSamples({});
    expect(s.callDate).toBe("2026-07-29");
    expect(s.callDurationSec).toBe(300); // 길이 계산은 절대시각 기준이라 변환과 무관
  });
});

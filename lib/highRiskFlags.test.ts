import { describe, expect, it } from "vitest";
import {
  feedbackHighRiskCountPredicates,
  matchFeedbackHighRiskFlags,
  parseHighRiskFlagRule,
  resolveHighRiskFlagChannel,
  type HighRiskFlagRule,
} from "./highRiskFlags";

function countRule(over: Partial<HighRiskFlagRule> = {}): HighRiskFlagRule {
  return {
    ruleId: "r1",
    key: "many_replies",
    label: "답변 과다",
    enabled: true,
    channel: "feedback",
    kind: "feedback_message_count",
    params: { countTarget: "reply", minCount: 3 },
    sortOrder: 1,
    updatedAt: "",
    updatedBy: "",
    ...over,
  };
}

describe("matchFeedbackHighRiskFlags", () => {
  it("문의·답변·합계 기준을 각각 판정한다", () => {
    const counts = { feedbackCount: 2, replyCount: 4 };
    expect(
      matchFeedbackHighRiskFlags([countRule({ params: { countTarget: "feedback", minCount: 3 } })], counts),
    ).toEqual([]);
    expect(
      matchFeedbackHighRiskFlags([countRule({ params: { countTarget: "reply", minCount: 3 } })], counts).map(
        (h) => h.key,
      ),
    ).toEqual(["many_replies"]);
    expect(
      matchFeedbackHighRiskFlags(
        [countRule({ key: "busy", params: { countTarget: "total", minCount: 6 } })],
        counts,
      ).map((h) => h.key),
    ).toEqual(["busy"]);
  });

  it("콜 규칙은 건너뛴다", () => {
    expect(
      matchFeedbackHighRiskFlags(
        [countRule({ channel: "phone", kind: "csat_dsat", params: { maxRate: 2 } })],
        { feedbackCount: 10, replyCount: 10 },
      ),
    ).toEqual([]);
  });

  it("채널이 콜로 저장된 건수 규칙도 판정한다", () => {
    expect(
      matchFeedbackHighRiskFlags([countRule({ channel: "phone" })], { feedbackCount: 1, replyCount: 9 }).map(
        (h) => h.key,
      ),
    ).toEqual(["many_replies"]);
  });

  it("꺼진 규칙과 기준 미달은 히트하지 않는다", () => {
    expect(
      matchFeedbackHighRiskFlags([countRule({ enabled: false })], { feedbackCount: 1, replyCount: 9 }),
    ).toEqual([]);
    expect(
      matchFeedbackHighRiskFlags([countRule({ params: { countTarget: "reply", minCount: 10 } })], {
        feedbackCount: 1,
        replyCount: 9,
      }),
    ).toEqual([]);
  });
});

describe("feedbackHighRiskCountPredicates", () => {
  it("고른 키만 남기고 기준이 없는 규칙은 뺀다", () => {
    expect(
      feedbackHighRiskCountPredicates(
        [
          countRule(),
          countRule({ key: "busy", params: { countTarget: "total", minCount: 6 } }),
          countRule({ key: "broken", params: { countTarget: "reply", minCount: null } }),
        ],
        ["busy"],
      ),
    ).toEqual([{ key: "busy", label: "답변 과다", countTarget: "total", minCount: 6 }]);
  });
});

describe("parseHighRiskFlagRule", () => {
  it("채널이 비어 있으면 콜 규칙으로 읽는다", () => {
    const parsed = parseHighRiskFlagRule({
      ruleId: "1",
      key: "long_call",
      kind: "long_call_percentile",
      params: { percentile: 10 },
    });
    expect(parsed?.channel).toBe("phone");
  });

  it("문의 건수 규칙은 채널이 비어 있거나 콜로 저장돼 있어도 문의로 읽는다", () => {
    expect(
      parseHighRiskFlagRule({
        ruleId: "2",
        key: "many_total",
        kind: "feedback_message_count",
        params: { countTarget: "total", minCount: 5 },
      })?.channel,
    ).toBe("feedback");
    expect(
      parseHighRiskFlagRule({
        ruleId: "3",
        key: "many_total",
        channel: "phone",
        kind: "feedback_message_count",
        params: { countTarget: "total", minCount: 5 },
      })?.channel,
    ).toBe("feedback");
  });

  it("문의 건수 규칙 파라미터를 보존한다", () => {
    const parsed = parseHighRiskFlagRule({
      ruleId: "2",
      key: "many_total",
      channel: "feedback",
      kind: "feedback_message_count",
      params: { countTarget: "total", minCount: 5 },
    });
    expect(parsed).toMatchObject({
      channel: "feedback",
      kind: "feedback_message_count",
      params: { countTarget: "total", minCount: 5 },
    });
  });
});

describe("resolveHighRiskFlagChannel", () => {
  it("종류가 허용되지 않는 채널이면 종류 쪽으로 되돌린다", () => {
    expect(resolveHighRiskFlagChannel("feedback_message_count", "phone")).toBe("feedback");
    expect(resolveHighRiskFlagChannel("long_call_percentile", "feedback")).toBe("phone");
    expect(resolveHighRiskFlagChannel("csat_dsat", "phone")).toBe("phone");
  });
});

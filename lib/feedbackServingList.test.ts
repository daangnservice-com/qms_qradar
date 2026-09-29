import { describe, expect, it } from "vitest";
import { buildFeedbackListQuery } from "./feedbackServingStore";

describe("buildFeedbackListQuery", () => {
  it("looks up thread ids and ignores the other filters", () => {
    const plan = buildFeedbackListQuery(
      { sourceIds: [" 1416980 "], teams: ["페이팀"], dateStart: "2026-09-01" },
      20,
    );
    expect(plan.text).toContain("thread_id = any($1::text[])");
    expect(plan.text).not.toContain("feedback_date_kst");
    expect(plan.values).toEqual([["1416980"], 20]);
  });

  it("filters dates, counts, and high-risk thresholds in one query", () => {
    const plan = buildFeedbackListQuery(
      {
        dateStart: "2026-09-01",
        dateEnd: "2026-09-26",
        replyCountMin: 3,
        highRiskCountAny: [
          { countTarget: "reply", minCount: 3 },
          { countTarget: "total", minCount: 6 },
        ],
      },
      100,
    );
    expect(plan.text).toContain("n_reply_rows >= $1");
    expect(plan.text).toContain(
      "(coalesce(n_reply_rows, 0) >= $2 or (coalesce(n_feedback_rows, 0) + coalesce(n_reply_rows, 0)) >= $3)",
    );
    expect(plan.text).toContain("feedback_date_kst >= $4::date");
    expect(plan.text).toContain("feedback_date_kst <= $5::date");
    expect(plan.values).toEqual([3, 3, 6, "2026-09-01", "2026-09-26", 100]);
  });

  it("matches an admin by assigned name or participating names", () => {
    const plan = buildFeedbackListQuery({ adminNames: ["Maren"] }, 10);
    expect(plan.text).toContain("any_admin_name = any($1::text[]) or admin_names && $1::text[]");
    expect(plan.values).toEqual([["Maren"], 10]);
  });
});

import { describe, expect, it } from "vitest";
import { replyPolishFetchLimit, snapshotReplyPolishRow, clampReplyPolishTarget, normalizeReplyPolishCsatFilter } from "./replyPolishSelect";

describe("replyPolishSelect helpers", () => {
  it("caps oversample fetch size", () => {
    expect(replyPolishFetchLimit(100)).toBe(800);
    expect(replyPolishFetchLimit(300)).toBe(2000);
    expect(replyPolishFetchLimit(1)).toBe(8);
  });

  it("clamps sample target to 1..200", () => {
    expect(clampReplyPolishTarget(0)).toBe(1);
    expect(clampReplyPolishTarget(999)).toBe(200);
    expect(clampReplyPolishTarget(undefined)).toBe(100);
  });

  it("keeps CSAT scores 1-5 and the 미참여 flag", () => {
    expect(normalizeReplyPolishCsatFilter({ csatRates: [1, 5, 5, 0, 9, "2"], csatIncludeNone: true })).toEqual({
      csatRates: [1, 2, 5],
      csatIncludeNone: true,
    });
    expect(normalizeReplyPolishCsatFilter({})).toEqual({ csatRates: [], csatIncludeNone: false });
  });

  it("snapshots 당근이-only contents into inquiry/answer text", () => {
    const sample = snapshotReplyPolishRow({
      feedback_thread_id: 1416980,
      display_full_category_name: "거래 사기",
      work_group_team: "중고거래팀",
      first_feedback_at_kst: "2026-08-01 09:00:00",
      csat_rate: 2,
      contents_concat: `[FEEDBACK] 2026-08-01 09:00:00 | feedback_id=10 | feedback_user_id=20
사기당한 것 같아요.

-----

[REPLY] 2026-08-01 09:03:12 | reply_id=11 | reply_admin_id=10588()
<p>안녕하세요, 확인 도와드릴게요.</p>`,
    });
    expect(sample).toMatchObject({
      id: "1416980",
      threadId: "1416980",
      category: "거래 사기",
      team: "중고거래팀",
      inquiry: "사기당한 것 같아요.",
      answer: "안녕하세요, 확인 도와드릴게요.",
      csatRate: 2,
    });
  });

  it("drops rows without a 당근이 answer", () => {
    expect(
      snapshotReplyPolishRow({
        feedback_thread_id: "1",
        contents_concat: `[FEEDBACK] 2026-08-01 09:00:00 | feedback_id=10 | feedback_user_id=20
문의만.`,
      }),
    ).toBeNull();
  });
});

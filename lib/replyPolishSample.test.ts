import { describe, expect, it } from "vitest";
import { parseFeedbackContents } from "./feedbackSamples";
import {
  categoryCounts,
  categoryKey,
  extractReplyPolishTexts,
  pickRoundRobinByCategory,
  sampleSnippet,
} from "./replyPolishSample";

describe("extractReplyPolishTexts", () => {
  it("keeps only customer inquiry and 당근이 replies", () => {
    const turns = parseFeedbackContents(`[FEEDBACK] 2026-08-01 09:00:00 | feedback_id=10 | feedback_user_id=20
첫 문의입니다.

-----

[REPLY] 2026-08-01 09:03:12 | reply_id=11 | reply_admin_id=10588()
<p>안녕하세요, 확인해 드릴게요.</p>

-----

[FEEDBACK] 2026-08-01 09:10:00 | feedback_id=12 | feedback_user_id=20
추가 문의입니다.

-----

[REPLY] 2026-08-01 09:12:00 | reply_id=13 | reply_admin_id=30(Jane)
사람이 끼어든 답변.

-----

[REPLY] 2026-08-01 09:13:00 | reply_id=14 | reply_admin_id=10588(당근이)
이어서 안내드립니다.`);

    expect(extractReplyPolishTexts(turns)).toEqual({
      inquiry: "첫 문의입니다.\n\n추가 문의입니다.",
      answer: "안녕하세요, 확인해 드릴게요.\n\n이어서 안내드립니다.",
    });
  });

  it("returns null when inquiry or 당근이 answer is missing", () => {
    expect(extractReplyPolishTexts(parseFeedbackContents(`[FEEDBACK] 2026-08-01 09:00:00 | feedback_id=10 | feedback_user_id=20
문의만 있습니다.`))).toBeNull();
    expect(
      extractReplyPolishTexts(
        parseFeedbackContents(`[REPLY] 2026-08-01 09:03:12 | reply_id=11 | reply_admin_id=10588()
답변만 있습니다.`),
      ),
    ).toBeNull();
  });
});

describe("pickRoundRobinByCategory", () => {
  it("does not let one category dominate", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, category: "거래 사기" })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, category: "환불" })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `c${i}`, category: "계정" })),
    ];
    const picked = pickRoundRobinByCategory(rows, 9);
    const counts = categoryCounts(picked);
    expect(picked).toHaveLength(9);
    expect(counts.find((c) => c.category === "거래 사기")?.count).toBe(4);
    expect(counts.find((c) => c.category === "환불")?.count).toBe(3);
    expect(counts.find((c) => c.category === "계정")?.count).toBe(2);
  });

  it("returns all rows when target is larger than the pool", () => {
    const rows = [
      { id: "1", category: "A" },
      { id: "2", category: "B" },
    ];
    expect(pickRoundRobinByCategory(rows, 10)).toEqual(rows);
  });

  it("treats blank category as (없음)", () => {
    expect(categoryKey("  ")).toBe("(없음)");
    const picked = pickRoundRobinByCategory(
      [
        { id: "1", category: "" },
        { id: "2", category: "환불" },
      ],
      2,
    );
    expect(categoryCounts(picked).map((c) => c.category).sort()).toEqual(["(없음)", "환불"]);
  });
});

describe("sampleSnippet", () => {
  it("collapses whitespace and truncates", () => {
    expect(sampleSnippet({ inquiry: "안녕  하세요" }, 80)).toBe("안녕 하세요");
    expect(sampleSnippet({ inquiry: "가".repeat(10) }, 4)).toBe("가가가가…");
  });
});

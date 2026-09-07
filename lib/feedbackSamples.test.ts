import { describe, expect, it } from "vitest";
import { parseFeedbackContents, parseParticipatingAdmins, stripFeedbackHtml } from "./feedbackSamples";

describe("feedback thread normalization", () => {
  it("parses customer feedback and agent replies into ordered turns", () => {
    const turns = parseFeedbackContents(`[FEEDBACK] 2026-08-01 09:00:00 | feedback_id=10 | feedback_user_id=20
문의 내용입니다.

-----

[REPLY] 2026-08-01 09:03:12 | reply_id=11 | reply_admin_id=30(Jane)
<p>안녕하세요, <b>문의자</b>님<br/>확인해 드릴게요.</p>`);

    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.speaker)).toEqual(["customer", "agent"]);
    expect(turns[0]).toMatchObject({
      turnId: "10",
      speakerLabel: "문의자",
      atSec: 0,
      sourceId: "10",
    });
    expect(turns[1]).toMatchObject({
      turnId: "11",
      speakerLabel: "상담사",
      atSec: 192,
      text: "안녕하세요, 문의자님\n확인해 드릴게요.",
    });
  });

  it("removes reply markup and decodes common entities", () => {
    expect(stripFeedbackHtml("<p>A &amp; B</p><ul><li>첫째</li></ul>")).toBe("A & B\n• 첫째");
  });

  it("ignores malformed blocks instead of inventing a turn", () => {
    expect(parseFeedbackContents("not a feedback block")).toEqual([]);
  });

  it("parses all participating admins from the aggregated value", () => {
    expect(parseParticipatingAdmins("jim(1), Eddy(2),jim(1), malformed")).toEqual([
      { name: "jim", id: "1" },
      { name: "Eddy", id: "2" },
    ]);
  });
});

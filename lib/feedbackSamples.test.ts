import { describe, expect, it } from "vitest";
import {
  isFeedbackThreadLookup,
  parseFeedbackContents,
  parseParticipatingAdmins,
  parseReplyAdmin,
  replyAdminNamesForDisplay,
  rowToFeedbackSample,
  stripFeedbackHtml,
} from "./feedbackSamples";

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
      speakerLabel: "Jane",
      atSec: 192,
      sourceId: "11",
      text: "안녕하세요, 문의자님\n확인해 드릴게요.",
    });
  });

  it("labels 당근이 replies as 당근이 instead of the assigned admin", () => {
    const contents = `[REPLY] 2026-08-01 09:03:12 | reply_id=11 | reply_admin_id=10588()
답변입니다.`;
    expect(parseFeedbackContents(contents, "Maren")[0].speakerLabel).toBe("당근이");
    expect(parseFeedbackContents(contents)[0].speakerLabel).toBe("당근이");
  });

  it("falls back to the thread admin name when a human reply header has no name", () => {
    const contents = `[REPLY] 2026-08-01 09:03:12 | reply_id=11 | reply_admin_id=30()
답변입니다.`;
    expect(parseFeedbackContents(contents, "Hwi")[0].speakerLabel).toBe("Hwi");
    expect(parseFeedbackContents(contents)[0].speakerLabel).toBe("상담사");
  });

  it("removes reply markup and decodes common entities", () => {
    expect(stripFeedbackHtml("<p>A &amp; B</p><ul><li>첫째</li></ul>")).toBe("A & B\n• 첫째");
  });

  it("ignores malformed blocks instead of inventing a turn", () => {
    expect(parseFeedbackContents("not a feedback block")).toEqual([]);
  });

  it("reads the reply admin id and name, tolerating an empty name lookup", () => {
    expect(parseReplyAdmin("30(Jane)")).toEqual({ id: "30", name: "Jane" });
    expect(parseReplyAdmin("10588()")).toEqual({ id: "10588", name: null });
    expect(parseReplyAdmin("")).toEqual({ id: null, name: null });
  });

  it("parses all participating admins from the aggregated value", () => {
    expect(parseParticipatingAdmins("jim(1), Eddy(2),jim(1), malformed")).toEqual([
      { name: "jim", id: "1" },
      { name: "Eddy", id: "2" },
    ]);
  });

  it("treats sourceIds as an explicit thread lookup", () => {
    expect(isFeedbackThreadLookup({ sourceIds: ["1416980"] })).toBe(true);
    expect(isFeedbackThreadLookup({ sourceIds: ["  "] })).toBe(false);
    expect(isFeedbackThreadLookup({ humanCountMin: 1 })).toBe(false);
  });

  it("lists human reply admins with the last replier first, and shows 당근이 when only the bot replied", () => {
    expect(
      replyAdminNamesForDisplay({
        participatingAdmins: [
          { id: "10588", name: "Unknown" },
          { id: "1", name: "Maren" },
          { id: "2", name: "Eddy" },
        ],
        lastReplyAdminId: "2",
        lastReplyAdminName: "Eddy",
      }),
    ).toEqual(["Eddy", "Maren"]);
    expect(
      replyAdminNamesForDisplay({
        participatingAdmins: [{ id: "10588", name: "Unknown" }],
        lastReplyAdminId: "10588",
        lastReplyAdminName: null,
      }),
    ).toEqual(["당근이"]);
  });
});

describe("rowToFeedbackSample counts", () => {
  it("unwraps BigQuery integer objects so 고위험 건수 매칭이 0으로 죽지 않는다", () => {
    const sample = rowToFeedbackSample({
      feedback_thread_id: "1416980",
      n_feedback_rows: { value: "2" },
      n_reply_rows: { value: "4" },
    });
    expect(sample?.feedbackCount).toBe(2);
    expect(sample?.replyCount).toBe(4);
  });
});

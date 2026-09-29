import { describe, expect, it } from "vitest";
import {
  formatSttIssueTranscript,
  isSttIssueTypeId,
  issueReportEnqueueTargets,
  STT_ISSUE_TYPES,
  sttIssueTypeLabel,
} from "./sttIssueTypes";

describe("sttIssueTypes", () => {
  it("accepts known issue types", () => {
    expect(isSttIssueTypeId("missing_speech")).toBe(true);
    expect(isSttIssueTypeId("nope")).toBe(false);
    expect(STT_ISSUE_TYPES.map((t) => t.id)).toContain("silent_channel");
    expect(sttIssueTypeLabel("garbled")).toBe("인식 오류가 심함");
  });

  it("formats transcript for report storage", () => {
    expect(
      formatSttIssueTranscript([
        { atSec: 65, speaker: "상담원", text: "안녕하세요" },
        { atSec: 70, speaker: "고객", text: "  " },
        { atSec: 71.4, speaker: "고객", text: "네" },
      ]),
    ).toBe("[01:05] 상담원: 안녕하세요\n[01:11] 고객: 네");
  });

  it("queues each local issue call once and skips gcp-only reports", () => {
    const targets = issueReportEnqueueTargets([
      { conversationId: "c1", sttSource: "local", agentName: "김", callDate: "2026-09-01", org: "A" },
      { conversationId: "c1", sttSource: "local", agentName: "김", callDate: "2026-09-01", org: "A" },
      { conversationId: "c2", sttSource: "gcp", agentName: "이", callDate: "2026-09-02", org: "B" },
      { conversationId: "c3", sttSource: "gcp", agentName: "박", callDate: "2026-09-03", org: "C" },
      { conversationId: "c3", sttSource: "local", agentName: "박", callDate: "2026-09-03", org: "C" },
    ]);
    expect(targets.map((t) => t.conversationId)).toEqual(["c1", "c3"]);
    expect(targets[0]).toMatchObject({ agentName: "김", team: "A", callDate: "2026-09-01" });
  });
});

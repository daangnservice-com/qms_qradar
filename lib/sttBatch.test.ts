import { describe, expect, it } from "vitest";
import { addDaysYmd, isRecurrenceDue, isScheduleDue, kstClock } from "./sttBatchKst";
import { pickNPerAgent } from "./sttBatchSelect";
import { inFlightSttJobs, pendingHarvestJobs, queuedConversationIds, summarizeAgents, summarizeScheduleStats } from "./sttBatchStore";
import { isInFlightSttStatus, localSttQueueLabel, ONDEMAND_STT_PRIORITY, type SttBatchJob } from "./sttBatchTypes";

describe("sttBatchSelect pickNPerAgent", () => {
  const rows = [
    { conversationId: "a1", agentName: "김" },
    { conversationId: "a2", agentName: "김" },
    { conversationId: "a3", agentName: "김" },
    { conversationId: "b1", agentName: "이" },
    { conversationId: "b2", agentName: "이" },
    { conversationId: "", agentName: "박" },
  ];

  it("takes n per agent and respects maxTotal", () => {
    expect(pickNPerAgent(rows, 2, new Set(), 10).map((r) => r.conversationId)).toEqual([
      "a1",
      "a2",
      "b1",
      "b2",
    ]);
    expect(pickNPerAgent(rows, 2, new Set(), 3).map((r) => r.conversationId)).toEqual(["a1", "a2", "b1"]);
  });

  it("skips already queued conversations and fills from the next", () => {
    expect(pickNPerAgent(rows, 2, new Set(["a1"]), 10).map((r) => r.conversationId)).toEqual([
      "a2",
      "a3",
      "b1",
      "b2",
    ]);
  });
});

describe("sttBatchKst", () => {
  it("adds days across month bounds in KST", () => {
    expect(addDaysYmd("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDaysYmd("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("is due after the scheduled time once per KST day", () => {
    const now = new Date("2026-08-31T03:00:00+09:00");
    expect(
      isScheduleDue({ enabled: true, hour: 2, minute: 0, lastRunDateKst: null, now }),
    ).toBe(true);
    expect(
      isScheduleDue({ enabled: true, hour: 2, minute: 0, lastRunDateKst: kstClock(now).date, now }),
    ).toBe(false);
    expect(
      isScheduleDue({ enabled: false, hour: 2, minute: 0, lastRunDateKst: null, now }),
    ).toBe(false);
    expect(
      isScheduleDue({
        enabled: true,
        hour: 4,
        minute: 0,
        lastRunDateKst: null,
        now,
      }),
    ).toBe(false);
  });

  it("isRecurrenceDue respects weekday and last run date", () => {
    const monday = new Date("2026-09-14T10:00:00+09:00"); // 월
    expect(
      isRecurrenceDue({
        enabled: true,
        hour: 9,
        minute: 0,
        recurrence: { kind: "weekly", weekday: 1 },
        lastRunDateKst: null,
        now: monday,
      }),
    ).toBe(true);
    expect(
      isRecurrenceDue({
        enabled: true,
        hour: 9,
        minute: 0,
        recurrence: { kind: "weekly", weekday: 2 },
        lastRunDateKst: null,
        now: monday,
      }),
    ).toBe(false);
    expect(
      isRecurrenceDue({
        enabled: true,
        hour: 9,
        minute: 0,
        recurrence: { kind: "once" },
        lastRunDateKst: "2026-09-01",
        now: monday,
      }),
    ).toBe(false);
  });
});

describe("sttBatchStore helpers", () => {
  it("queuedConversationIds ignores failed/skipped", () => {
    const jobs = [
      { conversationId: "c1", callDate: "2026-08-30", status: "queued" },
      { conversationId: "c2", callDate: "2026-08-30", status: "failed" },
      { conversationId: "c3", callDate: "2026-08-29", status: "queued" },
    ] as SttBatchJob[];
    expect([...queuedConversationIds(jobs, "2026-08-30")]).toEqual(["c1"]);
  });

  it("pendingHarvestJobs needs remote id and in-flight status", () => {
    const jobs = [
      { status: "queued", remoteJobId: "a" },
      { status: "running", remoteJobId: "b" },
      { status: "queued", remoteJobId: null },
      { status: "done", remoteJobId: "c" },
    ] as SttBatchJob[];
    expect(pendingHarvestJobs(jobs).map((j) => j.remoteJobId)).toEqual(["a", "b"]);
  });

  it("summarizeAgents counts queue vs fail", () => {
    const jobs = [
      { agentName: "김", team: "A", status: "queued" },
      { agentName: "김", team: "A", status: "running" },
      { agentName: "김", team: "A", status: "failed" },
      { agentName: "이", team: "B", status: "done" },
    ] as SttBatchJob[];
    const stats = summarizeAgents(jobs, 3);
    expect(stats).toEqual([
      { agentName: "김", team: "A", target: 3, selected: 3, queued: 2, done: 0, failed: 1, skipped: 0 },
      { agentName: "이", team: "B", target: 3, selected: 1, queued: 1, done: 1, failed: 0, skipped: 0 },
    ]);
  });

  it("summarizeScheduleStats aggregates cumulative and by callDate", () => {
    const jobs = [
      { scheduleId: "s1", callDate: "2026-09-01", status: "done" },
      { scheduleId: "s1", callDate: "2026-09-01", status: "failed" },
      { scheduleId: "s1", callDate: "2026-09-02", status: "queued" },
      { scheduleId: "s1", callDate: "2026-09-02", status: "pending_upload" },
      { scheduleId: "s1", callDate: "2026-09-02", status: "done" },
      { scheduleId: "s2", callDate: "2026-09-01", status: "done" },
    ] as SttBatchJob[];
    expect(summarizeScheduleStats(jobs, "s1")).toEqual({
      totals: { selected: 5, done: 2, failed: 1, inProgress: 2, skipped: 0 },
      daily: [
        { callDate: "2026-09-02", selected: 3, done: 1, failed: 0, inProgress: 2, skipped: 0 },
        { callDate: "2026-09-01", selected: 2, done: 1, failed: 1, inProgress: 0, skipped: 0 },
      ],
    });
  });

  it("inFlightSttJobs keeps queued/running/upload", () => {
    const jobs = [
      { status: "queued" },
      { status: "running" },
      { status: "pending_upload" },
      { status: "done" },
      { status: "failed" },
    ] as SttBatchJob[];
    expect(inFlightSttJobs(jobs).map((j) => j.status)).toEqual(["queued", "running", "pending_upload"]);
    expect(isInFlightSttStatus("queued")).toBe(true);
    expect(isInFlightSttStatus("done")).toBe(false);
    expect(localSttQueueLabel("queued")).toContain("대기열");
    expect(ONDEMAND_STT_PRIORITY).toBeGreaterThan(0);
  });
});

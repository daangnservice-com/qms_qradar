import { describe, expect, it } from "vitest";
import { matchesSttRequirement, minutesToSec } from "./evalBatchSelect";
import { evalBatchStatusLabel, isInFlightEvalStatus } from "./evalBatchTypes";
import { reservoirConversationIds } from "./reviewAssignTypes";

describe("evalBatchSelect", () => {
  it("converts minutes to seconds", () => {
    expect(minutesToSec(3)).toBe(180);
    expect(minutesToSec(null)).toBeNull();
  });

  it("filters by STT requirement", () => {
    expect(matchesSttRequirement(true, "done")).toBe(true);
    expect(matchesSttRequirement(false, "done")).toBe(false);
    expect(matchesSttRequirement(false, "pending")).toBe(true);
    expect(matchesSttRequirement(true, "pending")).toBe(false);
    expect(matchesSttRequirement(false, "any")).toBe(true);
    expect(matchesSttRequirement(true, "any")).toBe(true);
  });
});

describe("evalBatchTypes", () => {
  it("treats STT wait and eval queue as in-flight", () => {
    expect(isInFlightEvalStatus("waiting_stt")).toBe(true);
    expect(isInFlightEvalStatus("queued_eval")).toBe(true);
    expect(isInFlightEvalStatus("completed")).toBe(false);
    expect(evalBatchStatusLabel("waiting_stt")).toBe("STT 대기");
  });
});

describe("reviewAssign reservoir ids", () => {
  it("dedupes newest-first", () => {
    expect(
      reservoirConversationIds([
        {
          id: "1",
          ruleId: "r",
          runId: "a",
          conversationId: "c1",
          agentName: "김",
          team: "A",
          callDate: "2026-09-01",
          durationSec: 60,
          assignedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "2",
          ruleId: "r",
          runId: "b",
          conversationId: "c2",
          agentName: "이",
          team: "A",
          callDate: "2026-09-02",
          durationSec: 60,
          assignedAt: "2026-09-02T00:00:00.000Z",
        },
        {
          id: "3",
          ruleId: "r",
          runId: "c",
          conversationId: "c1",
          agentName: "김",
          team: "A",
          callDate: "2026-09-03",
          durationSec: 60,
          assignedAt: "2026-09-03T00:00:00.000Z",
        },
      ]),
    ).toEqual(["c1", "c2"]);
  });
});

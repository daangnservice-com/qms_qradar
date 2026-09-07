import { describe, expect, it } from "vitest";
import {
  assignLanes,
  completionState,
  splitPerPersonCounts,
  teamColor,
  todoBorderColor,
} from "@/lib/evalOpsSchedule";
import { groupAssignUnitsToBoardItems } from "@/lib/evalOpsScheduleStore";

describe("splitPerPersonCounts", () => {
  it("disables when n <= 1", () => {
    expect(splitPerPersonCounts(1)).toBeNull();
    expect(splitPerPersonCounts(0)).toBeNull();
  });
  it("splits even and odd with remainder to first", () => {
    expect(splitPerPersonCounts(4)).toEqual({ first: 2, second: 2 });
    expect(splitPerPersonCounts(5)).toEqual({ first: 3, second: 2 });
  });
});

describe("assignLanes", () => {
  it("puts non-overlapping on same lane and overlapping on next", () => {
    const map = assignLanes([
      { id: "a", start: "2026-03-01", end: "2026-03-03" },
      { id: "b", start: "2026-03-04", end: "2026-03-05" },
      { id: "c", start: "2026-03-02", end: "2026-03-04" },
    ]);
    expect(map.a).toBe(0);
    expect(map.b).toBe(0);
    expect(map.c).toBe(1);
  });
});

describe("completion / colors", () => {
  it("derives state priority", () => {
    expect(completionState({ selfDone: true, evalDone: true, startDate: "x" })).toBe("selfDone");
    expect(completionState({ leaderDone: true, evalDone: true })).toBe("leaderDone");
    expect(completionState({ evalDone: true })).toBe("evalDone");
    expect(completionState({ startDate: "2026-01-01" })).toBe("scheduled");
    expect(completionState({})).toBe("unscheduled");
  });
  it("todo border uses team color when scheduled", () => {
    const teams = ["A", "B"];
    expect(todoBorderColor({ teamName: "A", startDate: "2026-01-01" }, teams)).toBe(teamColor("A", teams));
  });
});

describe("groupAssignUnitsToBoardItems", () => {
  it("groups by team+type+channel and starts at 1회차", () => {
    const items = groupAssignUnitsToBoardItems({
      month: "2026-03",
      evaluatorEmail: "a@test.com",
      historyId: "h1",
      units: [
        {
          id: "1",
          evalMonth: "2026-03",
          historyId: "h1",
          evaluatorName: "Ellie",
          evaluatorEmail: "a@test.com",
          teamName: "페이팀",
          channel: "문의",
          cs: 4,
          job: 0,
          kind: "cs",
          unitType: "구성원",
          memberId: "1",
          memberName: "A",
          isRepeat: false,
          isPhone: false,
          _unit: {
            teamName: "페이팀",
            ch: "문의",
            isPhone: false,
            ppl: 1,
            cs: 4,
            job: 0,
            aqt: 0,
            type: "member",
            kind: "cs",
            memberId: "1",
            memberName: "A",
          },
        },
        {
          id: "2",
          evalMonth: "2026-03",
          historyId: "h1",
          evaluatorName: "Ellie",
          evaluatorEmail: "a@test.com",
          teamName: "페이팀",
          channel: "문의",
          cs: 4,
          job: 0,
          kind: "cs",
          unitType: "구성원",
          memberId: "2",
          memberName: "B",
          isRepeat: false,
          isPhone: false,
          _unit: {
            teamName: "페이팀",
            ch: "문의",
            isPhone: false,
            ppl: 1,
            cs: 4,
            job: 0,
            aqt: 0,
            type: "member",
            kind: "cs",
            memberId: "2",
            memberName: "B",
          },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].roundLabel).toBe("1회차");
    expect(items[0].memberCount).toBe(2);
    expect(items[0].perPersonCount).toBe(4);
    expect(items[0].totalCount).toBe(8);
    expect(items[0].members).toHaveLength(2);
  });
});

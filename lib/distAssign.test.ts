import { describe, expect, it } from "vitest";
import {
  gpMetricShares,
  latestHistoryForMonth,
  moveByDrag,
  mulberry32,
  recomputeAssignStats,
  runAssign,
  runFromHistory,
} from "./distAssign";
import type { DistGp, DistHistoryRow, DistRosterPerson, DistTeam } from "./distTypes";

function person(id: string, team: string, items: string[]): DistRosterPerson {
  return {
    employeeId: id,
    nameEn: id,
    teamName: team,
    part: "",
    level: "L3",
    employmentType: "",
    status: "재직",
    hireDate: "2024-01-01",
    convertDate: "",
    exitDate: "",
    autoJudge: "대상",
    manualJudge: "",
    finalJudge: "대상",
    judgeKind: "target",
    autoNote: "",
    memo: "",
    evalItems: items,
    editedBy: "",
    editedAt: "",
  };
}

describe("runAssign", () => {
  const teams: DistTeam[] = [
    {
      id: "T01",
      on: true,
      name: "페이팀",
      gp: "A",
      ppl: 2,
      csMode: "normal",
      difficulty: 1,
      cold: 10,
      channels: [{ ch: "문의", on: true, aqt: 8, jobBe: 0, csBe: 5, note: "" }],
    },
    {
      id: "T02",
      on: true,
      name: "중고팀",
      gp: "B",
      ppl: 2,
      csMode: "normal",
      difficulty: 1,
      cold: 5,
      channels: [{ ch: "문의", on: true, aqt: 8, jobBe: 0, csBe: 5, note: "" }],
    },
  ];
  const gps: DistGp[] = [
    { name: "A", avail: 4, buffer: 10, cs: true, ratio: 50, locked: false },
    { name: "B", avail: 4, buffer: 10, cs: true, ratio: 50, locked: false },
  ];
  const roster = [
    person("1", "페이팀", ["문의"]),
    person("2", "페이팀", ["문의"]),
    person("3", "중고팀", ["문의"]),
    person("4", "중고팀", ["문의"]),
  ];

  it("rejects ratios that are not 100", () => {
    const r = runAssign({
      month: "2026-08",
      teams,
      gps: gps.map((g, i) => ({ ...g, ratio: i === 0 ? 40 : 50 })),
      roster,
      aqtBase: { 문의: 8 },
      history: [],
      rng: mulberry32(1),
    });
    expect(r.ok).toBe(false);
  });

  it("assigns CS units to both evaluators", () => {
    const r = runAssign({
      month: "2026-08",
      teams,
      gps,
      roster,
      aqtBase: { 문의: 8 },
      history: [],
      rng: mulberry32(7),
      attempts: 80,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.run.result).sort()).toEqual(["A", "B"]);
    expect(r.run.tCS).toBeGreaterThan(0);
  });
});

describe("confirmed history restore", () => {
  const gps: DistGp[] = [
    { name: "Ellie", avail: 4, buffer: 0, cs: true, ratio: 50, locked: false },
    { name: "Amir", avail: 4, buffer: 0, cs: true, ratio: 50, locked: false },
  ];

  function hist(id: string, extra?: Partial<DistHistoryRow>): DistHistoryRow {
    return {
      historyId: id,
      evalMonth: "2026-08",
      confirmedBy: "haro",
      confirmedAt: "2026-08-10",
      totalCs: 99,
      repeats: 0,
      withinPm5: true,
      result: {
        Ellie: [{ teamName: "페이팀", ch: "문의", isPhone: false, ppl: 1, cs: 10, job: 0, aqt: 8, type: "team", kind: "cs" }],
      },
      ratios: [{ name: "Ellie", ratio: 50 }],
      metric: "count",
      scope: "cs",
      planSnapshot: null,
      ...extra,
    };
  }

  it("picks the latest history id for the month", () => {
    const latest = latestHistoryForMonth(
      [hist("2026-08-07_ver2"), hist("2026-08-10_ver1"), hist("2026-08-10_ver3")],
      "2026-08",
    );
    expect(latest?.historyId).toBe("2026-08-10_ver3");
  });

  it("rebuilds a confirmed, read-only run", () => {
    const run = runFromHistory(hist("2026-08-10_ver3"), gps);
    expect(run.confirmed).toBe(true);
    expect(run.month).toBe("2026-08");
    expect(run.tCS).toBe(10);
    expect(run.result.Ellie[0].teamName).toBe("페이팀");
  });
});

describe("manual drag", () => {
  const unit = (over: Partial<import("./distTypes").DistAssignUnit>): import("./distTypes").DistAssignUnit => ({
    teamName: "페이팀",
    ch: "문의",
    isPhone: false,
    ppl: 1,
    cs: 4,
    job: 0,
    aqt: 10,
    type: "member",
    kind: "cs",
    memberId: "1",
    memberName: "A",
    ...over,
  });

  it("moves a member and recomputes CS totals and shares", () => {
    const result = {
      Ellie: [
        unit({ memberId: "1", memberName: "A", cs: 4 }),
        unit({ memberId: "2", memberName: "B", kind: "job", job: 6, cs: 0 }),
      ],
      Amir: [unit({ memberId: "3", memberName: "C", teamName: "중고팀", cs: 5 })],
    };
    const moved = moveByDrag(
      result,
      { fromGp: "Ellie", level: "member", kind: "cs", teamName: "페이팀", ch: "문의", memberId: "1" },
      "Amir",
    );
    expect(moved.Ellie.map((u) => u.memberId)).toEqual(["2"]);
    expect(moved.Amir.map((u) => u.memberId).sort()).toEqual(["1", "3"]);

    const run = recomputeAssignStats({
      result: moved,
      cgps: [
        { name: "Ellie", avail: 4, buffer: 0, cs: true, ratio: 50, locked: false },
        { name: "Amir", avail: 4, buffer: 0, cs: true, ratio: 50, locked: false },
      ],
      tCS: 0,
      month: "2026-08_ver1",
      runAt: "",
      withinRange: true,
      splitTeams: {},
      maxSplitTeams: 2,
      repeats: 0,
      prevMonth: null,
      confirmed: false,
      metric: "count",
      scope: "cs",
      manual: true,
      pool: 0,
      loads: {},
    });
    expect(run.tCS).toBe(9);
    expect(run.loads.Amir).toBe(9);
    expect(run.loads.Ellie).toBe(0);

    const { byGp, grand } = gpMetricShares(moved, "count");
    expect(grand).toBe(15);
    expect(byGp.Ellie.jobW).toBe(6);
    expect(byGp.Amir.csW).toBe(9);
  });

  it("moves a whole team including job units", () => {
    const result = {
      Ellie: [
        unit({ kind: "job", job: 3, cs: 0, memberId: "1" }),
        unit({ kind: "cs", cs: 2, memberId: "1" }),
      ],
      Amir: [],
    };
    const moved = moveByDrag(result, { fromGp: "Ellie", level: "team", teamName: "페이팀" }, "Amir");
    expect(moved.Ellie).toEqual([]);
    expect(moved.Amir).toHaveLength(2);
  });
});

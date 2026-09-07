import { describe, expect, it } from "vitest";
import { finalJudge, isExcludedTeam, judgeTarget, levelNum } from "./evalTargetJudge";

describe("evalTargetJudge", () => {
  it("parses L-level", () => {
    expect(levelNum("L3")).toBe(3);
    expect(levelNum("CX L4")).toBe(4);
    expect(levelNum("스태프")).toBeNull();
  });

  it("excludes people/growth/X teams from roster", () => {
    expect(isExcludedTeam("성장문화팀")).toBe(true);
    expect(isExcludedTeam("페이팀")).toBe(false);
  });

  it("excludes L5+", () => {
    const r = judgeTarget({ evalMonth: "2026-08", level: "L5" });
    expect(r.kind).toBe("excluded");
    expect(r.notes).toContain("L5 이상");
  });

  it("applies hire grace: April hire starts from June", () => {
    const may = judgeTarget({
      evalMonth: "2026-05",
      level: "L3",
      hireDate: "2026-04-10",
    });
    const jun = judgeTarget({
      evalMonth: "2026-06",
      level: "L3",
      hireDate: "2026-04-10",
    });
    expect(may.kind).toBe("excluded");
    expect(jun.kind).toBe("target");
  });

  it("prefers manual override", () => {
    expect(finalJudge("excluded", "대상")).toBe("target");
    expect(finalJudge("target", "❌ 제외")).toBe("excluded");
    expect(finalJudge("target", "")).toBe("target");
  });

  it("accepts versioned set ids as eval month", () => {
    const r = judgeTarget({ evalMonth: "2026-08_ver2", level: "L5" });
    expect(r.kind).toBe("excluded");
  });
});

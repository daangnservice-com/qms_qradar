import { describe, expect, it } from "vitest";
import {
  applySnapshotEvalItems,
  parseConfirmInfo,
  parseRosterRow,
  parseSnapshotEvalItems,
} from "./evalOpsStore";
import type { DistRosterPerson } from "./distTypes";

function person(id: string, items: string[]): DistRosterPerson {
  return {
    employeeId: id,
    nameEn: id,
    teamName: "페이팀",
    part: "",
    level: "L3",
    employmentType: "",
    status: "재직",
    hireDate: "",
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

describe("parseSnapshotEvalItems", () => {
  it("reads eval_items when present", () => {
    expect(parseSnapshotEvalItems({ eval_items: "문의,전화", edited_by: "a@x.com" })).toEqual(["문의", "전화"]);
  });

  it("treats shifted edited_by as channels when it is not an email", () => {
    expect(
      parseSnapshotEvalItems({
        edited_by: "문의,채팅",
        edited_at: "jade.jang@daangnservice.com",
      }),
    ).toEqual(["문의", "채팅"]);
  });

  it("does not treat a real editor email as channels", () => {
    expect(parseSnapshotEvalItems({ edited_by: "bella@daangnservice.com" })).toEqual([]);
  });
});

describe("applySnapshotEvalItems", () => {
  it("fills empty roster items from the snapshot, per person", () => {
    const roster = [person("1", []), person("2", []), person("3", ["티켓"])];
    const next = applySnapshotEvalItems(roster, [
      { employee_id: "1", edited_by: "문의" },
      { employee_id: "2", edited_by: "사업심사" },
      { employee_id: "3", edited_by: "문의,전화" },
    ]);
    expect(next[0].evalItems).toEqual(["문의"]);
    expect(next[1].evalItems).toEqual(["사업심사"]);
    expect(next[2].evalItems).toEqual(["티켓"]);
  });

  it("fills empty manual and final judge from the snapshot", () => {
    const roster = [{ ...person("1", []), finalJudge: "", judgeKind: "unknown" as const }];
    const next = applySnapshotEvalItems(roster, [
      { employee_id: "1", edited_by: "문의", manual_judge: "제외", final_judge: "제외" },
    ]);
    expect(next[0].manualJudge).toBe("제외");
    expect(next[0].finalJudge).toBe("제외");
    expect(next[0].judgeKind).toBe("excluded");
    expect(next[0].evalItems).toEqual(["문의"]);
  });
});

describe("parseConfirmInfo", () => {
  it("swaps shifted date/email columns", () => {
    expect(
      parseConfirmInfo({
        confirmed_by: "2026. 8. 6",
        confirmed_at: "bella@daangnservice.com",
      }),
    ).toEqual({ by: "bella@daangnservice.com", at: "2026. 8. 6" });
  });
});

describe("parseRosterRow", () => {
  it("does not invent eval items when the column is missing", () => {
    const p = parseRosterRow({
      employee_id: "KS1",
      name_en: "Jay",
      team_name: "로컬비즈니스팀",
      final_judge: "대상",
    });
    expect(p.evalItems).toEqual([]);
  });

  it("reads shifted edited_by as eval items when it is not an email", () => {
    const p = parseRosterRow({
      employee_id: "KS1",
      edited_by: "문의,전화",
      final_judge: "대상",
    });
    expect(p.evalItems).toEqual(["문의", "전화"]);
    expect(p.editedBy).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { buildMonthlyReportDraft } from "./monthlyReportDraft";
import {
  buildMonthsFromCases,
  collectViolationItems,
  getTeamSplitStats,
  integratedStatus,
  itemCategory,
  normalizeChannel,
  parseTemp,
  primaryCounts,
  scopeMonthToTeam,
} from "./monthlyReportLogic";
import { extractPrevActionText, monthlyReportDraftKey } from "./monthlyReportPersist";
import type { MonthlyCaseRow } from "./monthlyReportTypes";

function row(partial: Partial<MonthlyCaseRow> & Pick<MonthlyCaseRow, "month" | "memberKey" | "caseResult">): MonthlyCaseRow {
  return {
    team: "페이팀",
    memberLabel: partial.memberLabel ?? partial.memberKey,
    templateName: "전화평가",
    targetResult: "",
    scoreDetail: "",
    memoDetail: "",
    ...partial,
  };
}

describe("monthlyReportLogic", () => {
  it("normalizes channel names from template titles", () => {
    expect(normalizeChannel("심사평가")).toBe("심사");
    expect(normalizeChannel("채팅 품질평가")).toBe("채팅");
    expect(normalizeChannel("인앱문의")).toBe("문의");
    expect(normalizeChannel("전화 상담")).toBe("전화");
    expect(normalizeChannel("기타템플릿")).toBe("기타템플릿");
  });

  it("parses hot/cold/melt case results", () => {
    expect(parseTemp("HOT")).toBe("H");
    expect(parseTemp("cold")).toBe("C");
    expect(parseTemp("Melt")).toBe("M");
    expect(parseTemp("")).toBeNull();
  });

  it("marks a person Cold if any channel has Cold, and counts Melt separately", () => {
    const byYm = buildMonthsFromCases([
      row({ month: "2026-03", memberKey: "A", memberLabel: "김상담", templateName: "전화", caseResult: "hot" }),
      row({ month: "2026-03", memberKey: "A", memberLabel: "김상담", templateName: "채팅평가", caseResult: "cold" }),
      row({ month: "2026-03", memberKey: "A", memberLabel: "김상담", templateName: "문의", caseResult: "melt" }),
      row({ month: "2026-03", memberKey: "B", memberLabel: "이우수", templateName: "전화", caseResult: "hot" }),
    ]);
    const m = byYm["2026-03"];
    expect(integratedStatus(m.agents.A.channels)).toBe("C");
    expect(integratedStatus(m.agents.B.channels)).toBe("H");
    expect(m.integrated).toEqual({ hot: 1, cold: 1, melt: 1 });
    const pc = primaryCounts(m);
    expect(pc.basis).toBe("통합(인원 기준)");
    expect(pc.hot + pc.cold).toBe(2);
  });

  it("splits 심사 and 운영 when a team has audit channels", () => {
    const byYm = buildMonthsFromCases([
      row({
        month: "2026-03",
        memberKey: "A",
        memberLabel: "박심사",
        team: "광고팀",
        templateName: "심사평가",
        caseResult: "cold",
      }),
      row({
        month: "2026-03",
        memberKey: "A",
        memberLabel: "박심사",
        team: "광고팀",
        templateName: "전화",
        caseResult: "hot",
      }),
    ]);
    const m = byYm["2026-03"];
    const split = getTeamSplitStats(m, "광고팀", true);
    expect(split.map((s) => s.label).sort()).toEqual(["광고팀<심사>", "광고팀<운영>"]);
    const ops = split.find((s) => s.label.endsWith("<운영>"));
    const audit = split.find((s) => s.label.endsWith("<심사>"));
    expect(ops?.hot).toBe(1);
    expect(audit?.cold).toBe(1);
    const merged = getTeamSplitStats(m, "광고팀", false);
    expect(merged).toHaveLength(1);
    expect(merged[0].cold).toBe(1);
  });

  it("maps score_detail items onto HTML categories via criterion id and label fallback", () => {
    expect(itemCategory("인사 누락")).toBe("예절·화법");
    expect(itemCategory("상황에 맞는 공감 누락 및 미흡")).toBe("공감·경청");
    expect(
      itemCategory("(고객집착 결여) 응대 전반에서 고객 배려 의지가 없거나 기계적 응대가 반복되어 고객 경험에 큰 영향을 끼치는 경우"),
    ).toBe("고객집착 결여(Critical)");
    const items = collectViolationItems("인사 누락(407)\n상황에 맞는 공감 누락 및 미흡(415)", new Map([
      [407, { id: 407, category: "예절과 화법", label: "인사 누락" }],
      [415, { id: 415, category: "공감과 경청", label: "상황에 맞는 공감 누락 및 미흡" }],
    ]));
    expect(items["인사 누락"]).toBe(1);
    expect(itemCategory("인사 누락", new Map([[407, { id: 407, category: "예절과 화법", label: "인사 누락" }]]))).toBe(
      "예절·화법",
    );
  });

  it("scopes a month to one team without leaking other agents", () => {
    const byYm = buildMonthsFromCases([
      row({ month: "2026-03", memberKey: "A", team: "페이팀", caseResult: "cold" }),
      row({ month: "2026-03", memberKey: "B", team: "알바팀", caseResult: "hot" }),
    ]);
    const scoped = scopeMonthToTeam(byYm["2026-03"], "페이팀");
    expect(Object.keys(scoped?.agents ?? {})).toEqual(["A"]);
    expect(scoped?.integrated.cold).toBe(1);
    expect(scoped?.integrated.hot).toBe(0);
  });
});

describe("monthlyReportDraft", () => {
  it("builds a markdown draft with channel table and placeholder sections", () => {
    const byYm = buildMonthsFromCases([
      row({
        month: "2026-03",
        memberKey: "A",
        memberLabel: "김상담",
        templateName: "전화",
        caseResult: "cold",
        scoreDetail: "인사 누락(407)",
        memoDetail: "예절·화법 코칭 필요",
      }),
      row({ month: "2026-03", memberKey: "B", memberLabel: "이우수", templateName: "채팅평가", caseResult: "hot" }),
    ]);
    const m = byYm["2026-03"];
    const text = buildMonthlyReportDraft({
      selected: m,
      prev: null,
      monthsAsc: [m],
      teamFilter: "__all__",
      specialNotes: "평가 유예 없음",
    });
    expect(text).toContain("2026-03");
    expect(text).toContain("평가 유예 없음");
    expect(text).toContain("전화");
    expect(text).toContain("채팅");
    expect(text).toContain("Good/Bad Case");
    expect(text).toContain("| Hot");
  });

  it("returns a fallback message when there is no selected month", () => {
    expect(
      buildMonthlyReportDraft({
        selected: null,
        prev: null,
        monthsAsc: [],
        teamFilter: "",
        specialNotes: "",
      }),
    ).toMatch(/데이터가 없어요/);
  });
});

describe("monthlyReportPersist keys", () => {
  it("normalizes team empty and __all__ to the same draft key", () => {
    expect(monthlyReportDraftKey("2026-03", "")).toBe("2026-03|__all__");
    expect(monthlyReportDraftKey("2026-03", "__all__")).toBe("2026-03|__all__");
    expect(monthlyReportDraftKey("2026-03", "페이팀")).toBe("2026-03|페이팀");
  });

  it("extracts previous month action block from a saved draft", () => {
    const saved = `## 8. 액션\n\n### 이번 달\n\n○ 신규 Cold: 김상담 → 조기 개입 필요\n○ Hot 비중 하락\n\n`;
    expect(extractPrevActionText(saved)).toContain("신규 Cold");
    expect(extractPrevActionText("")).toBe("");
  });
});

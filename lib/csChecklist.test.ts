import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const query = vi.fn();
vi.mock("./bigquery", () => ({ getBQ: () => ({ query }) }));

import { CS_CHECKLIST, buildChecklistPromptBlock, type CsCriterion } from "./csChecklist";
import { clearCsChecklistCache, loadCsChecklist } from "./csChecklistLoad";

beforeEach(() => {
  query.mockReset();
  clearCsChecklistCache();
});

afterEach(() => clearCsChecklistCache());

describe("buildChecklistPromptBlock", () => {
  it("기본은 하드코딩 체크리스트 id를 포함한다", () => {
    const block = buildChecklistPromptBlock();
    expect(block).toContain("CS 영역 감점 체크리스트");
    expect(block).toContain("[416]");
    expect(block).toContain("[429]");
    expect(block).toContain(`아래 ${CS_CHECKLIST.length}개 항목`);
  });

  it("넘긴 criteria로 프롬프트 항목을 구성한다", () => {
    const custom: CsCriterion[] = [
      { id: 999, category: "테스트", label: "커스텀 항목", hint: "힌트A" },
    ];
    const block = buildChecklistPromptBlock(custom);
    expect(block).toContain("[999]");
    expect(block).toContain("커스텀 항목");
    expect(block).toContain("힌트A");
    expect(block).toContain("아래 1개 항목");
    expect(block).not.toContain("[416]");
  });
});

describe("loadCsChecklist", () => {
  it("BQ 조회 실패 시 하드코딩 폴백을 반환한다", async () => {
    query.mockRejectedValue(new Error("no access"));
    const list = await loadCsChecklist();
    expect(list).toBe(CS_CHECKLIST);
    expect(query).toHaveBeenCalled();
  });

  it("BQ 행이 있으면 그 기준으로 반환한다", async () => {
    query.mockResolvedValue([
      [{ id: 407, category: "예절과 화법", label: "인사 누락", hint: "h" }],
    ]);
    const list = await loadCsChecklist();
    expect(list).toEqual([{ id: 407, category: "예절과 화법", label: "인사 누락", hint: "h" }]);
  });
});

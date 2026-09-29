import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sessionCanAccessEvalProgress,
  sessionCanAccessMonthlyReport,
  sessionCanAccessQualityEval,
} from "./sessionAccess";
import {
  ensureSessionCanAccessEvalProgress,
  ensureSessionCanAccessMonthlyReport,
  ensureSessionCanAccessQualityEval,
} from "./sessionAccessServer";
import { MONTHLY_REPORT_GROUP_EMAILS } from "./adminEmails";
import { clearGoogleGroupsCache } from "./googleGroups";

vi.mock("./googleGroups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./googleGroups")>();
  return {
    ...actual,
    isMemberOfAnyGroup: vi.fn(),
  };
});

import { isMemberOfAnyGroup } from "./googleGroups";

describe("sessionAccess", () => {
  it("평가 진행은 도메인 구성원이면 플래그 없이 열린다", () => {
    const session = { user: { email: "anyone@daangnservice.com" } };
    expect(sessionCanAccessEvalProgress(session)).toBe(true);
    expect(sessionCanAccessQualityEval(session)).toBe(false);
    expect(sessionCanAccessMonthlyReport(session)).toBe(false);
  });

  it("도메인 밖·세션 없음은 평가 진행 불가", () => {
    expect(sessionCanAccessEvalProgress({ user: { email: "a@gmail.com" } })).toBe(false);
    expect(sessionCanAccessEvalProgress(null)).toBe(false);
  });

  it("monthlyReport flag opens only the monthly report, not quality eval", () => {
    const session = {
      user: { email: "cx.lead@daangnservice.com" },
      access: { monthlyReport: true, qualityEval: false },
    };
    expect(sessionCanAccessMonthlyReport(session)).toBe(true);
    expect(sessionCanAccessQualityEval(session)).toBe(false);
  });

  it("qualityEval implies monthly report", () => {
    const session = {
      user: { email: "designer@daangnservice.com" },
      access: { qualityEval: true, monthlyReport: false },
    };
    expect(sessionCanAccessQualityEval(session)).toBe(true);
    expect(sessionCanAccessMonthlyReport(session)).toBe(true);
  });
});

describe("sessionAccessServer", () => {
  beforeEach(() => {
    clearGoogleGroupsCache();
    vi.mocked(isMemberOfAnyGroup).mockReset();
  });

  it("평가 진행은 Groups API를 부르지 않는다", async () => {
    await expect(
      ensureSessionCanAccessEvalProgress({ user: { email: "anyone@daangnservice.com" } }),
    ).resolves.toBe(true);
    expect(isMemberOfAnyGroup).not.toHaveBeenCalled();
  });

  it("short-circuits on JWT true without Groups API", async () => {
    const session = {
      user: { email: "cx.lead@daangnservice.com" },
      access: { monthlyReport: true, qualityEval: false },
    };
    await expect(ensureSessionCanAccessMonthlyReport(session)).resolves.toBe(true);
    expect(isMemberOfAnyGroup).not.toHaveBeenCalled();
  });

  it("L5 group member gets monthly report but not quality eval", async () => {
    vi.mocked(isMemberOfAnyGroup).mockImplementation(async (_email, groups) =>
      groups.some((g) => MONTHLY_REPORT_GROUP_EMAILS.includes(g)),
    );
    const session = {
      user: { email: "cx.lead@daangnservice.com" },
      access: { monthlyReport: false, qualityEval: false },
    };
    await expect(ensureSessionCanAccessMonthlyReport(session)).resolves.toBe(true);
    await expect(ensureSessionCanAccessQualityEval(session)).resolves.toBe(false);
  });

  it("denies non-members", async () => {
    vi.mocked(isMemberOfAnyGroup).mockResolvedValue(false);
    const session = {
      user: { email: "stranger@daangnservice.com" },
      access: { monthlyReport: false, qualityEval: false },
    };
    await expect(ensureSessionCanAccessMonthlyReport(session)).resolves.toBe(false);
  });
});

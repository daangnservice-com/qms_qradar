import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCanAccessMonthlyReport, resolveCanAccessQualityEval } from "./resolveAccess";
import { MONTHLY_REPORT_GROUP_EMAILS, QUALITY_EVAL_GROUP_EMAILS } from "./adminEmails";
import { clearGoogleGroupsCache } from "./googleGroups";

vi.mock("./googleGroups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./googleGroups")>();
  return {
    ...actual,
    isMemberOfAnyGroup: vi.fn(),
  };
});

import { isMemberOfAnyGroup } from "./googleGroups";

const memberOf = (list: string[]) =>
  vi.mocked(isMemberOfAnyGroup).mockImplementation(async (_email, groups) =>
    groups.some((g) => list.includes(g)),
  );

describe("resolveAccess", () => {
  beforeEach(() => {
    clearGoogleGroupsCache();
    vi.mocked(isMemberOfAnyGroup).mockReset();
  });
  afterEach(() => {
    clearGoogleGroupsCache();
  });

  it("admin whitelist skips the Groups API", async () => {
    await expect(resolveCanAccessQualityEval("amir@daangnservice.com")).resolves.toBe(true);
    await expect(resolveCanAccessMonthlyReport("amir@daangnservice.com")).resolves.toBe(true);
    expect(isMemberOfAnyGroup).not.toHaveBeenCalled();
  });

  it("growth group gets quality eval and the monthly report", async () => {
    memberOf(QUALITY_EVAL_GROUP_EMAILS);
    await expect(resolveCanAccessQualityEval("growth.member@daangnservice.com")).resolves.toBe(true);
    await expect(resolveCanAccessMonthlyReport("growth.member@daangnservice.com")).resolves.toBe(true);
  });

  it("L5 group gets the monthly report only", async () => {
    memberOf(MONTHLY_REPORT_GROUP_EMAILS);
    await expect(resolveCanAccessMonthlyReport("cx.lead@daangnservice.com")).resolves.toBe(true);
    await expect(resolveCanAccessQualityEval("cx.lead@daangnservice.com")).resolves.toBe(false);
  });

  it("L4 group is not part of the monthly report", () => {
    expect(MONTHLY_REPORT_GROUP_EMAILS).not.toContain("ds-sr-cx-professional-l4@daangnservice.com");
  });

  it("denies non-members", async () => {
    memberOf([]);
    await expect(resolveCanAccessQualityEval("stranger@daangnservice.com")).resolves.toBe(false);
    await expect(resolveCanAccessMonthlyReport("stranger@daangnservice.com")).resolves.toBe(false);
  });
});

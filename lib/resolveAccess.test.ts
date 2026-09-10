import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCanAccessCallQuality, resolveCanAccessCallQualityObserve } from "./resolveAccess";
import { clearGoogleGroupsCache } from "./googleGroups";

vi.mock("./googleGroups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./googleGroups")>();
  return {
    ...actual,
    isMemberOfAnyGroup: vi.fn(),
  };
});

import { isMemberOfAnyGroup } from "./googleGroups";

describe("resolveCanAccessCallQuality (Google Groups)", () => {
  beforeEach(() => {
    clearGoogleGroupsCache();
    vi.mocked(isMemberOfAnyGroup).mockReset();
  });
  afterEach(() => {
    clearGoogleGroupsCache();
  });

  it("allows whitelist without calling Directory API", async () => {
    await expect(resolveCanAccessCallQuality("karla@daangnservice.com")).resolves.toBe(true);
    expect(isMemberOfAnyGroup).not.toHaveBeenCalled();
  });

  it("allows group members via Directory API", async () => {
    vi.mocked(isMemberOfAnyGroup).mockResolvedValue(true);
    await expect(resolveCanAccessCallQuality("cx.lead@daangnservice.com")).resolves.toBe(true);
    expect(isMemberOfAnyGroup).toHaveBeenCalled();
    await expect(resolveCanAccessCallQualityObserve("cx.lead@daangnservice.com")).resolves.toBe(true);
  });

  it("denies non-members", async () => {
    vi.mocked(isMemberOfAnyGroup).mockResolvedValue(false);
    await expect(resolveCanAccessCallQuality("stranger@daangnservice.com")).resolves.toBe(false);
  });

  // observe는 더 이상 @daangnservice.com 도메인 전체가 아니다 — 화이트리스트 또는 그룹 멤버만.
  it("denies observe for a plain domain account that is in no group", async () => {
    vi.mocked(isMemberOfAnyGroup).mockResolvedValue(false);
    await expect(resolveCanAccessCallQualityObserve("anyone@daangnservice.com")).resolves.toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sessionCanAccessCallQuality,
  sessionCanAccessCallQualityObserve,
  sessionCanAccessAnyCallQuality,
  sessionCanAccessOrg,
} from "./sessionAccess";
import { ensureSessionCanAccessCallQuality } from "./sessionAccessServer";
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
  it("grants call quality from JWT flag for group members", () => {
    const session = {
      user: { email: "cx.lead@daangnservice.com" },
      access: { callQuality: true },
    };
    expect(sessionCanAccessCallQuality(session)).toBe(true);
    expect(sessionCanAccessCallQualityObserve(session)).toBe(true);
    expect(sessionCanAccessAnyCallQuality(session)).toBe(true);
    expect(sessionCanAccessOrg("growth", session)).toBe(true);
    expect(sessionCanAccessOrg("pay", session)).toBe(false);
  });

  it("falls back to personal whitelist when access flag missing", () => {
    const session = { user: { email: "karla@daangnservice.com" } };
    expect(sessionCanAccessCallQuality(session)).toBe(true);
  });

  it("denies when no flag and not on whitelist", () => {
    const session = {
      user: { email: "stranger@daangnservice.com" },
      access: { callQuality: false },
    };
    expect(sessionCanAccessCallQuality(session)).toBe(false);
    expect(sessionCanAccessCallQualityObserve(session)).toBe(false);
  });
});

describe("ensureSessionCanAccessCallQuality", () => {
  beforeEach(() => {
    clearGoogleGroupsCache();
    vi.mocked(isMemberOfAnyGroup).mockReset();
  });

  it("short-circuits on JWT true without Directory API", async () => {
    const session = {
      user: { email: "cx.lead@daangnservice.com" },
      access: { callQuality: true },
    };
    await expect(ensureSessionCanAccessCallQuality(session)).resolves.toBe(true);
    expect(isMemberOfAnyGroup).not.toHaveBeenCalled();
  });

  it("falls through to Directory API when JWT false", async () => {
    vi.mocked(isMemberOfAnyGroup).mockResolvedValue(true);
    const session = {
      user: { email: "cx.lead@daangnservice.com" },
      access: { callQuality: false },
    };
    await expect(ensureSessionCanAccessCallQuality(session)).resolves.toBe(true);
    expect(isMemberOfAnyGroup).toHaveBeenCalled();
  });
});

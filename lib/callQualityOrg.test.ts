import { describe, it, expect } from "vitest";
import {
  canAccessCallQualityObserve,
  canAccessCallQualityPlayback,
  canAccessOrg,
} from "./callQualityOrg";

describe("callQualityOrg observe access", () => {
  it("allows any @daangnservice.com user for observe", () => {
    expect(canAccessCallQualityObserve("anyone@daangnservice.com")).toBe(true);
    expect(canAccessCallQualityObserve("Anyone@DaangnService.com")).toBe(true);
  });

  it("denies other domains for observe-only access", () => {
    expect(canAccessCallQualityObserve("user@daangn.com")).toBe(false);
    expect(canAccessCallQualityObserve(null)).toBe(false);
  });

  it("still allows call quality whitelist for observe", () => {
    expect(canAccessCallQualityObserve("karla@daangnservice.com")).toBe(true);
  });

  it("extends playback API to observe domain users", () => {
    expect(canAccessCallQualityPlayback("growth", "member@daangnservice.com")).toBe(true);
    expect(canAccessOrg("growth", "member@daangnservice.com")).toBe(false);
  });
});

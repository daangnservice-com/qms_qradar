import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "./auth";

describe("isAllowedEmail", () => {
  it("allows exact domain match (case-insensitive)", () => {
    expect(isAllowedEmail("karla@daangnservice.com", "daangnservice.com")).toBe(true);
    expect(isAllowedEmail("Karla@Daangnservice.com", "daangnservice.com")).toBe(true);
  });

  it("rejects other domains, empty, and lookalikes", () => {
    expect(isAllowedEmail("a@gmail.com", "daangnservice.com")).toBe(false);
    expect(isAllowedEmail("", "daangnservice.com")).toBe(false);
    expect(isAllowedEmail(null, "daangnservice.com")).toBe(false);
    expect(isAllowedEmail(undefined, "daangnservice.com")).toBe(false);
    expect(isAllowedEmail("a@evil-daangnservice.com", "daangnservice.com")).toBe(false);
  });
});

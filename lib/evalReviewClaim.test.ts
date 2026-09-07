import { describe, it, expect } from "vitest";
import { handleOf, sameEmail } from "./evalReviewClaim";

describe("handleOf", () => {
  it("strips the domain", () => {
    expect(handleOf("karla@daangnservice.com")).toBe("karla");
  });
  it("returns the whole string when there is no @", () => {
    expect(handleOf("karla")).toBe("karla");
  });
});

describe("sameEmail", () => {
  it("matches case-insensitively", () => {
    expect(sameEmail("Karla@daangnservice.com", "karla@daangnservice.com")).toBe(true);
  });
  it("rejects empty", () => {
    expect(sameEmail("", "a@b.c")).toBe(false);
    expect(sameEmail("a@b.c", null)).toBe(false);
  });
});

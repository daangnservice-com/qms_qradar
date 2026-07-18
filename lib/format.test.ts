import { describe, it, expect } from "vitest";
import { formatClock } from "./format";

describe("formatClock", () => {
  it("formats seconds into mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(75)).toBe("01:15");
    expect(formatClock(135.2)).toBe("02:15");
    expect(formatClock(3599)).toBe("59:59");
  });
});

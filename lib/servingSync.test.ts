import { describe, expect, it } from "vitest";
import { lastNightlySlot } from "./servingSync";

describe("lastNightlySlot", () => {
  it("KST 03시 이후면 오늘 03시", () => {
    // 2026-09-29 10:00 KST
    const now = new Date("2026-09-29T01:00:00Z");
    expect(lastNightlySlot(now, 3).toISOString()).toBe("2026-09-28T18:00:00.000Z");
  });

  it("KST 03시 전이면 어제 03시", () => {
    // 2026-09-29 02:30 KST
    const now = new Date("2026-09-28T17:30:00Z");
    expect(lastNightlySlot(now, 3).toISOString()).toBe("2026-09-27T18:00:00.000Z");
  });

  it("정각은 그 슬롯에 포함", () => {
    const now = new Date("2026-09-28T18:00:00Z");
    expect(lastNightlySlot(now, 3).toISOString()).toBe("2026-09-28T18:00:00.000Z");
  });
});

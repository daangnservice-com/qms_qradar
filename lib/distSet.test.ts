import { describe, expect, it } from "vitest";
import {
  calendarMonthOf,
  compareDistSetIdDesc,
  nextDistSetId,
  parseDistSetId,
} from "./distSet";

describe("parseDistSetId", () => {
  it("parses legacy month and versioned sets", () => {
    expect(parseDistSetId("2026-08")).toEqual({ id: "2026-08", month: "2026-08", ver: 0 });
    expect(parseDistSetId("2026-08_ver3")).toEqual({ id: "2026-08_ver3", month: "2026-08", ver: 3 });
  });

  it("rejects junk", () => {
    expect(parseDistSetId("2026-13")).toBeNull();
    expect(parseDistSetId("ver1")).toBeNull();
  });
});

describe("nextDistSetId", () => {
  it("starts at _ver1 for a new month", () => {
    expect(nextDistSetId("2026-09", ["2026-08", "2026-08_ver1"])).toBe("2026-09_ver1");
  });

  it("bumps past legacy and existing versions of the same month", () => {
    expect(nextDistSetId("2026-08", ["2026-08", "2026-08_ver1", "2026-07_ver9"])).toBe("2026-08_ver2");
  });
});

describe("calendarMonthOf", () => {
  it("strips version suffix", () => {
    expect(calendarMonthOf("2026-08_ver2")).toBe("2026-08");
  });
});

describe("compareDistSetIdDesc", () => {
  it("orders by month then version", () => {
    const ids = ["2026-08", "2026-08_ver2", "2026-07_ver1", "2026-08_ver1"];
    expect([...ids].sort(compareDistSetIdDesc)).toEqual([
      "2026-08_ver2",
      "2026-08_ver1",
      "2026-08",
      "2026-07_ver1",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { currentYearMonthKst, dateRangeToIso, monthRangeToIso } from "./reviewStatusPeriod";
import { splitOverUnderTops } from "./criterionTops";

type Row = { id: number; fp: number; fn: number; diffCount: number };

function row(partial: Partial<Row> & { id: number; fp: number; fn: number }): Row {
  return {
    diffCount: partial.fp + partial.fn,
    ...partial,
  };
}

describe("reviewStatus period helpers", () => {
  it("currentYearMonthKst returns YYYY-MM", () => {
    expect(currentYearMonthKst(new Date("2026-08-24T12:00:00+09:00"))).toBe("2026-08");
  });

  it("monthRangeToIso uses KST month bounds", () => {
    const { startIso, endIso } = monthRangeToIso("2026-08");
    expect(startIso).toBe(new Date("2026-08-01T00:00:00+09:00").toISOString());
    expect(endIso).toBe(new Date("2026-09-01T00:00:00+09:00").toISOString());
  });

  it("dateRangeToIso includes end date", () => {
    const { startIso, endIso } = dateRangeToIso("2026-08-01", "2026-08-31");
    expect(startIso).toBe(new Date("2026-08-01T00:00:00+09:00").toISOString());
    expect(endIso).toBe(new Date("2026-09-01T00:00:00+09:00").toISOString());
  });
});

describe("splitOverUnderTops", () => {
  it("puts overlapping items only in overDetect", () => {
    const { overDetect, underDetect } = splitOverUnderTops(
      [
        row({ id: 1, fp: 10, fn: 8 }),
        row({ id: 2, fp: 0, fn: 5 }),
        row({ id: 3, fp: 3, fn: 0 }),
      ],
      12,
    );
    expect(overDetect.map((r) => r.id)).toEqual([1, 3]);
    expect(underDetect.map((r) => r.id)).toEqual([2]);
  });
});

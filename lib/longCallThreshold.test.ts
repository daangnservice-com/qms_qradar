import { describe, it, expect } from "vitest";
import {
  clampLongCallPercentile,
  isLongCallDuration,
  meanDailyThresholdMinutes,
  topPercentileQuantileOffset,
} from "./longCallThreshold";

describe("longCallThreshold helpers", () => {
  it("maps top percentile to quantile offset", () => {
    expect(topPercentileQuantileOffset(10)).toBe(90);
    expect(topPercentileQuantileOffset(5)).toBe(95);
    expect(topPercentileQuantileOffset(1)).toBe(99);
    expect(topPercentileQuantileOffset(50)).toBe(50);
  });

  it("clamps percentile", () => {
    expect(clampLongCallPercentile(0)).toBe(1);
    expect(clampLongCallPercentile(99)).toBe(50);
    expect(clampLongCallPercentile(NaN)).toBe(10);
  });

  it("averages daily thresholds skipping empty days", () => {
    expect(
      meanDailyThresholdMinutes([
        { thresholdMinutes: 10, sampleCount: 5 },
        { thresholdMinutes: 20, sampleCount: 0 },
        { thresholdMinutes: 30, sampleCount: 3 },
      ]),
    ).toBe(20);
    expect(meanDailyThresholdMinutes([])).toBeNull();
  });

  it("flags long calls by stored threshold minutes", () => {
    expect(isLongCallDuration(15 * 60, 12)).toBe(true);
    expect(isLongCallDuration(10 * 60, 12)).toBe(false);
    expect(isLongCallDuration(20 * 60, 12, 25)).toBe(false); // minMinutes AND
    expect(isLongCallDuration(30 * 60, 12, 25)).toBe(true);
    expect(isLongCallDuration(null, 12)).toBe(false);
    expect(isLongCallDuration(600, 0)).toBe(false);
  });
});

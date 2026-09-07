import { describe, it, expect } from "vitest";
import {
  isIntervalOverlay,
  isSeriesOverlay,
  overlapsToOverlays,
  parseAgitatedSpansFromComment,
  sentimentSeriesOverlay,
  sentimentSpansToOverlays,
  silencesToOverlays,
} from "./waveformOverlays";

describe("waveformOverlays mappers", () => {
  it("maps overlaps", () => {
    const o = overlapsToOverlays([
      { startSec: 1, endSec: 2.5, durationSec: 1.5 },
      { startSec: 5, endSec: 5, durationSec: 0 }, // skipped
    ]);
    expect(o).toHaveLength(1);
    expect(o[0].kind).toBe("overlap");
    expect(o[0].channel).toBe("both");
    expect(isIntervalOverlay(o[0])).toBe(true);
  });

  it("maps silences and sentiment spans", () => {
    const s = silencesToOverlays([{ startSec: 0, endSec: 3, durationSec: 3 }]);
    expect(s[0].kind).toBe("silence");
    const sent = sentimentSpansToOverlays([{ startSec: 10, endSec: 12, intensity: 0.8, label: "격앙" }]);
    expect(sent[0].kind).toBe("sentiment");
    expect(sent[0].intensity).toBe(0.8);
  });

  it("builds sentiment series", () => {
    const series = sentimentSeriesOverlay("s1", [
      { atSec: 0, value: 0 },
      { atSec: 1, value: -0.5 },
      { atSec: NaN, value: 1 },
    ]);
    expect(isSeriesOverlay(series)).toBe(true);
    expect(series.points).toHaveLength(2);
  });

  it("parses agitated comment spans", () => {
    expect(parseAgitatedSpansFromComment("196.0~210.5 고객 고성; 400~415 언성")).toEqual([
      { startSec: 196, endSec: 210.5, label: "고객 고성" },
      { startSec: 400, endSec: 415, label: "언성" },
    ]);
    expect(parseAgitatedSpansFromComment("격앙 없음")).toEqual([]);
    expect(parseAgitatedSpansFromComment("")).toEqual([]);
  });
});

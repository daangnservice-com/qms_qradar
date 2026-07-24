import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseInputDuration, parseSilenceEvents, summarizeSilences, computeSpeechGaps } from "./silence";

const stderr = readFileSync(path.resolve(__dirname, "../test/fixtures/silencedetect.stderr.txt"), "utf8");

describe("parseInputDuration", () => {
  it("parses Duration line into seconds", () => {
    expect(parseInputDuration(stderr)).toBeCloseTo(1234.56, 2);
  });
});

describe("parseSilenceEvents", () => {
  it("extracts start/end/duration triples", () => {
    const events = parseSilenceEvents(stderr);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ start: 135.2, end: 160.4, durationSec: 25.2 });
  });
});

describe("summarizeSilences", () => {
  it("filters by minSilenceSec and summarizes", () => {
    const events = parseSilenceEvents(stderr);
    const { silences, summary } = summarizeSilences(events, 3, 1234.56);
    // 1.9초짜리는 제외, 25.2초/4.5초만 남음
    expect(silences.map((s) => s.durationSec)).toEqual([25.2, 4.5]);
    expect(summary.count).toBe(2);
    expect(summary.totalSec).toBeCloseTo(29.7, 5);
    expect(summary.longestSec).toBe(25.2);
    expect(summary.silenceRatio).toBeCloseTo(29.7 / 1234.56, 5);
  });
});

describe("computeSpeechGaps", () => {
  it("finds gaps between merged speech spans (both channels quiet)", () => {
    // 채널 섞임: [0,5] 상담원, [3,8] 고객(겹침→합쳐서 [0,8]), 그 뒤 큰 공백, [70,75]
    const spans = [
      { atSec: 0, endSec: 5 },
      { atSec: 3, endSec: 8 },
      { atSec: 70, endSec: 75 },
    ];
    expect(computeSpeechGaps(spans)).toEqual([{ start: 8, end: 70, durationSec: 62 }]);
  });

  it("no gap when speech is continuous, [] for empty", () => {
    expect(computeSpeechGaps([{ atSec: 0, endSec: 10 }, { atSec: 9, endSec: 20 }])).toEqual([]);
    expect(computeSpeechGaps([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  isAffirmationLoop,
  prepareLocalSegments,
  seekSecForTranscript,
  type TimedSttSegment,
} from "./localSttQuality";

function seg(partial: Partial<TimedSttSegment> & Pick<TimedSttSegment, "text">): TimedSttSegment {
  return {
    atSec: 0,
    endSec: 1,
    avgLogprob: -0.2,
    compressionRatio: 1,
    words: [],
    ...partial,
  };
}

describe("seekSecForTranscript", () => {
  it("seeks to the first word instead of the segment start", () => {
    expect(seekSecForTranscript({ atSec: 14, wordAtSec: 32.1 })).toBe(32.1);
    expect(seekSecForTranscript({ atSec: 14 })).toBe(14);
  });
});

describe("prepareLocalSegments", () => {
  it("drops echo, affirmation loops, and high compression", () => {
    const kept = prepareLocalSegments([
      seg({ text: "네, 고객님" }),
      seg({ text: "네네네네네네", atSec: 1 }),
      seg({ text: "상담원과 고객의 통화 녹취입니다.", atSec: 2 }),
      seg({ text: "같은말".repeat(30), atSec: 3, compressionRatio: 3.5 }),
    ]);
    expect(kept.map((s) => s.text)).toEqual(["네, 고객님"]);
  });

  it("splits a long turn so the next line starts at its first word", () => {
    const words = Array.from({ length: 16 }, (_, i) => ({
      start: i,
      end: i + 0.4,
      word: i < 12 ? "가" : "나",
    }));
    const [first, second] = prepareLocalSegments([
      seg({ text: "가".repeat(16), atSec: 0, endSec: 15.4, words }),
    ]);
    expect(first.atSec).toBe(0);
    expect(second.atSec).toBeGreaterThanOrEqual(10);
    expect(second.atSec).toBe(second.words[0].start);
  });
});

describe("isAffirmationLoop", () => {
  it("keeps a short backchannel", () => {
    expect(isAffirmationLoop("네네")).toBe(false);
    expect(isAffirmationLoop("네, 고객님")).toBe(false);
  });
});

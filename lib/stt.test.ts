import { describe, it, expect } from "vitest";
import { resultsToSegments, mapSpeaker, type SttRawResult } from "./stt";

const rr = (transcript: string, startSec: number, endSec: number, speakerTag: number): SttRawResult => ({
  transcript,
  startSec,
  endSec,
  speakerTag,
});

describe("resultsToSegments", () => {
  it("uses each result's clean transcript + times, skips empty, sorts by time", () => {
    const results: SttRawResult[] = [
      rr("네 무엇을 도와드릴까요", 0.5, 2.0, 1), // 채널1
      rr("환불하고 싶어요", 4.0, 5.2, 2), // 채널2
      rr("   ", 3.0, 3.5, 1), // 빈 것 제외
      rr("안녕하세요", 2.5, 3.0, 2), // 시각순 정렬 확인
    ];
    expect(resultsToSegments(results)).toEqual([
      { atSec: 0.5, endSec: 2.0, speakerTag: 1, text: "네 무엇을 도와드릴까요" },
      { atSec: 2.5, endSec: 3.0, speakerTag: 2, text: "안녕하세요" },
      { atSec: 4.0, endSec: 5.2, speakerTag: 2, text: "환불하고 싶어요" },
    ]);
  });

  it("returns [] for none", () => {
    expect(resultsToSegments([])).toEqual([]);
  });
});

describe("mapSpeaker", () => {
  it("labels agent vs customer by the agent tag", () => {
    expect(mapSpeaker(1, 1)).toBe("상담원");
    expect(mapSpeaker(2, 1)).toBe("고객");
  });
  it("falls back to numbered speaker when agent tag is unknown", () => {
    expect(mapSpeaker(1, null)).toBe("화자 1");
    expect(mapSpeaker(2, null)).toBe("화자 2");
  });
});

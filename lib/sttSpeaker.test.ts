import { describe, it, expect } from "vitest";
import {
  isAgentSpeakerLabel,
  mapSpeaker,
  sttSegmentsToTranscript,
} from "./sttSpeaker";

describe("sttSpeaker", () => {
  it("labels agent vs customer by the agent tag", () => {
    expect(mapSpeaker(1, 1)).toBe("상담원");
    expect(mapSpeaker(2, 1)).toBe("고객");
  });

  it("falls back to numbered speaker when agent tag is unknown", () => {
    expect(mapSpeaker(1, null)).toBe("화자 1");
    expect(mapSpeaker(2, null)).toBe("화자 2");
  });

  it("labels dual-channel STT as 상담원/고객 (channel 1 = agent)", () => {
    expect(
      sttSegmentsToTranscript([
        { atSec: 0, endSec: 1, speakerTag: 1, text: "안녕하세요" },
        { atSec: 2, endSec: 3, speakerTag: 2, text: "문의드립니다" },
      ]),
    ).toEqual([
      { atSec: 0, speaker: "상담원", text: "안녕하세요" },
      { atSec: 2, speaker: "고객", text: "문의드립니다" },
    ]);
  });

  it("isAgentSpeakerLabel recognizes agent-side labels", () => {
    expect(isAgentSpeakerLabel("상담원")).toBe(true);
    expect(isAgentSpeakerLabel("화자 1")).toBe(true);
    expect(isAgentSpeakerLabel("고객")).toBe(false);
    expect(isAgentSpeakerLabel("화자 2")).toBe(false);
  });
});

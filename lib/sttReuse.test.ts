import { describe, it, expect } from "vitest";
import { parseTranscriptJson, speakerLabelToTag, transcriptToSttSegments } from "./sttReuse";

describe("sttReuse", () => {
  it("maps speaker labels to tags", () => {
    expect(speakerLabelToTag("상담원")).toBe(1);
    expect(speakerLabelToTag("고객")).toBe(2);
    expect(speakerLabelToTag("화자 3")).toBe(3);
    expect(speakerLabelToTag("")).toBe(1);
  });

  it("reconstructs endSec from next atSec", () => {
    const segs = transcriptToSttSegments(
      [
        { atSec: 0, speaker: "상담원", text: "안녕" },
        { atSec: 1.5, speaker: "고객", text: "네" },
      ],
      10,
    );
    expect(segs).toEqual([
      { atSec: 0, endSec: 1.5, speakerTag: 1, text: "안녕" },
      { atSec: 1.5, endSec: 10, speakerTag: 2, text: "네" },
    ]);
  });

  it("parses transcript_json", () => {
    expect(parseTranscriptJson('[{"atSec":1,"speaker":"상담원","text":"hi"}]')).toEqual([
      { atSec: 1, speaker: "상담원", text: "hi" },
    ]);
    expect(parseTranscriptJson("[]")).toEqual([]);
    expect(parseTranscriptJson("bad")).toEqual([]);
  });
});

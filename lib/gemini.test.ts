import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildEvaluationPrompt, parseEvaluation } from "./gemini";
import type { Silence, SilenceSummary } from "./types";
import type { SttSegment } from "./stt";

const silences: Silence[] = [{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }];
const summary: SilenceSummary = { count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.02 };
const stt: SttSegment[] = [
  { atSec: 0, endSec: 2, speakerTag: 1, text: "안녕하세요 무엇을 도와드릴까요" },
  { atSec: 3, endSec: 4, speakerTag: 2, text: "환불하고 싶어요" },
];

describe("buildEvaluationPrompt", () => {
  it("includes criteria, silence timestamps, STT script, and agent-tag instruction", () => {
    const p = buildEvaluationPrompt(silences, summary, stt);
    expect(p).toContain("응대 태도");
    expect(p).toContain("문제 해결력");
    expect(p).toContain("대화 흐름");
    expect(p).toContain("02:15"); // 135.2s
    expect(p).toContain("25.2");
    expect(p).toContain("agentSpeakerTag"); // 상담원 화자 판별 지시
    expect(p).toContain("환불하고 싶어요"); // STT 스크립트 포함
  });

  it("omits CS checklist by default, includes it only when checklist=true (growth)", () => {
    const off = buildEvaluationPrompt(silences, summary, stt);
    expect(off).not.toContain("CS 영역 감점 체크리스트");
    expect(off).not.toContain("[416]");

    const on = buildEvaluationPrompt(silences, summary, stt, true);
    expect(on).toContain("CS 영역 감점 체크리스트"); // 체크리스트 블록
    expect(on).toContain("[416]"); // 항목 id 포함
    expect(on).toContain("[429]");
  });
});

describe("parseEvaluation", () => {
  it("parses scores/summary/silenceComments (transcript now comes from STT)", () => {
    const raw = readFileSync(path.resolve(__dirname, "../test/fixtures/gemini-response.json"), "utf8");
    const ev = parseEvaluation(raw);
    expect(ev.scores.attitude.score).toBe(4);
    expect(ev.scores.flow.comment).toContain("흐름");
    expect(ev.overallSummary).toContain("개선");
    expect(ev.silenceComments[0].atSec).toBe(135.2);
    expect(ev.agentSpeakerTag).toBeNull(); // 픽스처엔 agentSpeakerTag 없음
    expect(ev.error).toBeNull();
  });

  it("parses agentSpeakerTag and tolerates code-fenced JSON", () => {
    const ev = parseEvaluation(
      '```json\n{"scores":{"attitude":{"score":5,"comment":"a"},"resolution":{"score":5,"comment":"b"},"flow":{"score":5,"comment":"c"}},"overallSummary":"s","silenceComments":[],"agentSpeakerTag":2}\n```',
    );
    expect(ev.scores.attitude.score).toBe(5);
    expect(ev.silenceComments).toEqual([]);
    expect(ev.csChecklist).toEqual([]); // 없으면 빈 배열
    expect(ev.agentSpeakerTag).toBe(2);
  });

  it("parses csChecklist with evidence", () => {
    const ev = parseEvaluation(
      JSON.stringify({
        scores: { attitude: { score: 3, comment: "a" }, resolution: { score: 3, comment: "b" }, flow: { score: 3, comment: "c" } },
        overallSummary: "s",
        silenceComments: [],
        csChecklist: [
          { id: 407, violated: true, evidence: [{ atSec: 1.2, quote: "네 말씀하세요" }], reason: "첫인사 없음" },
          { id: 416, violated: false, evidence: [], reason: "겹침 없음" },
        ],
        agentSpeakerTag: 1,
      }),
    );
    expect(ev.csChecklist).toHaveLength(2);
    expect(ev.csChecklist[0]).toEqual({ id: 407, violated: true, evidence: [{ atSec: 1.2, quote: "네 말씀하세요" }], reason: "첫인사 없음" });
    expect(ev.csChecklist[1].violated).toBe(false);
  });
});

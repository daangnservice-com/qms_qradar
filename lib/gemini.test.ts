import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildEvaluationPrompt, parseEvaluation } from "./gemini";
import type { Silence, SilenceSummary } from "./types";

const silences: Silence[] = [{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }];
const summary: SilenceSummary = { count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.02 };

describe("buildEvaluationPrompt", () => {
  it("includes criteria and silence timestamps in mm:ss", () => {
    const p = buildEvaluationPrompt(silences, summary);
    expect(p).toContain("응대 태도");
    expect(p).toContain("문제 해결력");
    expect(p).toContain("대화 흐름");
    expect(p).toContain("02:15"); // 135.2s
    expect(p).toContain("25.2");
  });
});

describe("parseEvaluation", () => {
  it("parses a well-formed Gemini JSON response", () => {
    const raw = readFileSync(path.resolve(__dirname, "../test/fixtures/gemini-response.json"), "utf8");
    const ev = parseEvaluation(raw);
    expect(ev.scores.attitude.score).toBe(4);
    expect(ev.scores.flow.comment).toContain("흐름");
    expect(ev.overallSummary).toContain("개선");
    expect(ev.silenceComments[0].atSec).toBe(135.2);
    expect(ev.error).toBeNull();
  });

  it("tolerates code-fenced JSON", () => {
    const ev = parseEvaluation('```json\n{"scores":{"attitude":{"score":5,"comment":"a"},"resolution":{"score":5,"comment":"b"},"flow":{"score":5,"comment":"c"}},"overallSummary":"s","silenceComments":[]}\n```');
    expect(ev.scores.attitude.score).toBe(5);
    expect(ev.silenceComments).toEqual([]);
  });
});

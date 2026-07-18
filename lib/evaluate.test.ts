import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./silence", () => ({
  runSilenceDetection: vi.fn(),
}));
vi.mock("./gemini", () => ({
  runGeminiEvaluation: vi.fn(),
}));

import { runSilenceDetection } from "./silence";
import { runGeminiEvaluation } from "./gemini";
import { evaluateFile } from "./evaluate";

const silencePayload = {
  durationSec: 1000,
  silences: [{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }],
  summary: { count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.025 },
};

beforeEach(() => vi.clearAllMocks());

describe("evaluateFile", () => {
  it("merges silence + gemini results", async () => {
    (runSilenceDetection as any).mockResolvedValue(silencePayload);
    (runGeminiEvaluation as any).mockResolvedValue({
      scores: { attitude: { score: 4, comment: "a" }, resolution: { score: 3, comment: "b" }, flow: { score: 2, comment: "c" } },
      overallSummary: "s", silenceComments: [], error: null,
    });
    const r = await evaluateFile("/tmp/x.m4a", { minSilenceSec: 3, noiseDb: -30 });
    expect(r.durationSec).toBe(1000);
    expect(r.silences).toHaveLength(1);
    expect(r.silenceSummary.count).toBe(1);
    expect(r.evaluation.scores.attitude.score).toBe(4);
    expect(r.threshold).toEqual({ minSilenceSec: 3, noiseDb: -30 });
  });

  it("keeps silence results when Gemini fails", async () => {
    (runSilenceDetection as any).mockResolvedValue(silencePayload);
    (runGeminiEvaluation as any).mockRejectedValue(new Error("rate limit"));
    const r = await evaluateFile("/tmp/x.m4a", { minSilenceSec: 3, noiseDb: -30 });
    expect(r.silences).toHaveLength(1);
    expect(r.evaluation.error).toContain("rate limit");
    expect(r.evaluation.scores.attitude.score).toBe(0);
  });
});

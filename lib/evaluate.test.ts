import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_AUDIO_PIPELINE_CONFIG, type AudioPipelineConfig } from "./audioPipeline";
import type { PromptConfig } from "./promptStore";

vi.mock("./silence", () => ({
  runSilenceDetection: vi.fn(),
  summarizeSilences: vi.fn((events: { start: number; end: number; durationSec: number }[], _min: number, _dur: number) => ({
    silences: events.map((e) => ({ startSec: e.start, endSec: e.end, durationSec: e.durationSec })),
    summary: {
      count: events.length,
      totalSec: events.reduce((a, e) => a + e.durationSec, 0),
      longestSec: events.reduce((a, e) => Math.max(a, e.durationSec), 0),
      silenceRatio: 0,
    },
  })),
  computeSpeechGaps: vi.fn(() => []),
  runOverlapDetection: vi.fn(),
  computeSpeechOverlaps: vi.fn(() => []),
}));
vi.mock("./gemini", () => ({
  runGeminiEvaluation: vi.fn(),
}));
vi.mock("./stt", () => ({
  STT_CHANNEL_COUNT: 2,
  STT_LANG: "ko-KR",
  STT_MODEL: "test-stt",
  transcribeCall: vi.fn(),
  mapSpeaker: vi.fn((tag: number) => `화자${tag}`),
}));
vi.mock("./sttCallLog", () => ({
  logSttCall: vi.fn(),
}));
vi.mock("./evalResultStore", () => ({
  getLatestStoredTranscript: vi.fn().mockResolvedValue(null),
}));
vi.mock("./sttBatchStore", () => ({
  getLatestBatchTranscript: vi.fn().mockResolvedValue(null),
}));
vi.mock("./highRiskFlagStore", () => ({
  listHighRiskFlagRules: vi.fn().mockResolvedValue([]),
}));
vi.mock("./promptStore", () => ({
  getProductionPrompt: vi.fn(async () => makePromptConfig()),
}));

import { runSilenceDetection, runOverlapDetection, computeSpeechOverlaps, computeSpeechGaps } from "./silence";
import { runGeminiEvaluation } from "./gemini";
import { transcribeCall } from "./stt";
import { getLatestStoredTranscript } from "./evalResultStore";
import { getLatestBatchTranscript } from "./sttBatchStore";
import { evaluateFile } from "./evaluate";

function makePromptConfig(audioPipelineConfig?: AudioPipelineConfig): PromptConfig {
  return {
    version: {
      versionId: "test-v",
      templateKey: "call_eval_growth",
      versionLabel: "v1",
      status: "production",
      basePrompt: "x",
      checklistTemplate: "",
      responseSchemaJson: "{}",
      criteriaJson: "[]",
      selectedCriterionIds: [],
      criterionBindings: [],
      resultParseConfig: {
        kind: "any_checklist_violated",
        trueLabel: "cold",
        falseLabel: "hot",
        sourcePath: "csChecklist",
      },
      outputSchemaConfig: {
        includeScores: true,
        includeOverallSummary: true,
        includeSilenceComments: true,
        includeAgentSpeakerTag: true,
        includeCsChecklist: true,
        checklistFields: { id: true, violated: true, reason: true, evidence: true },
        scoreFields: [
          { key: "attitude", label: "응대 태도", sortOrder: 1 },
          { key: "resolution", label: "문제 해결력", sortOrder: 2 },
          { key: "flow", label: "대화 흐름", sortOrder: 3 },
        ],
        overallSummaryFields: [],
      },
      useChecklist: true,
      changeNote: "",
      createdAt: "",
      createdBy: "test",
      audioPipelineConfig: audioPipelineConfig ?? structuredClone(DEFAULT_AUDIO_PIPELINE_CONFIG),
    },
    criteria: [],
    responseSchema: {},
  } as PromptConfig;
}

const silencePayload = {
  durationSec: 1000,
  silences: [{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }],
  summary: { count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.025 },
};

const geminiOk = {
  scores: {
    attitude: { score: 4, comment: "a" },
    resolution: { score: 3, comment: "b" },
    flow: { score: 2, comment: "c" },
  },
  metrics: {},
  overallSummary: "s",
  silenceComments: [],
  csChecklist: [
    { id: 407, violated: true, evidence: [{ atSec: 1, quote: "연락처 010-1234-5678" }], reason: "r" },
  ],
  agentSpeakerTag: null,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (getLatestStoredTranscript as any).mockResolvedValue(null);
  (getLatestBatchTranscript as any).mockResolvedValue(null);
  (runSilenceDetection as any).mockResolvedValue(silencePayload);
  (runOverlapDetection as any).mockResolvedValue({
    durationSec: 1000,
    overlaps: [{ startSec: 10, endSec: 11, durationSec: 1 }],
  });
  (computeSpeechOverlaps as any).mockReturnValue([{ start: 10, end: 11, durationSec: 1 }]);
  (computeSpeechGaps as any).mockReturnValue([{ start: 135.2, end: 160.4, durationSec: 25.2 }]);
  (transcribeCall as any).mockResolvedValue({
    segments: [{ atSec: 0, endSec: 1, speakerTag: 1, text: "안녕하세요" }],
    durationSec: 1000,
    model: "test-stt",
    language: "ko-KR",
    channelCount: 2,
  });
  (runGeminiEvaluation as any).mockResolvedValue(geminiOk);
});

describe("evaluateFile", () => {
  it("merges silence + gemini results", async () => {
    const r = await evaluateFile("/tmp/x.m4a", {
      minSilenceSec: 3,
      noiseDb: -30,
      promptConfig: makePromptConfig(),
    });
    expect(r.durationSec).toBe(1000);
    expect(r.silences).toHaveLength(1);
    expect(r.silenceSummary.count).toBe(1);
    expect(r.evaluation.scores.attitude.score).toBe(4);
    expect(r.evaluation.outputSchemaSnapshot?.scoreFields.map((f) => f.key)).toEqual([
      "attitude",
      "resolution",
      "flow",
    ]);
    expect(r.evaluation.csChecklist?.[0].id).toBe(407);
    expect(r.evaluation.csChecklist?.[0].evidence[0].quote).toBe("연락처 010-****-5678");
    expect(r.threshold).toEqual({ minSilenceSec: 3, noiseDb: -30 });
    expect(transcribeCall).toHaveBeenCalled();
    expect(r.sttSource).toBe("gcp");
    expect(runGeminiEvaluation).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      expect.any(Array),
      expect.objectContaining({ overlaps: expect.any(Array) }),
    );
  });

  it("keeps silence results when Gemini fails", async () => {
    (runGeminiEvaluation as any).mockRejectedValue(new Error("rate limit"));
    const r = await evaluateFile("/tmp/x.m4a", {
      minSilenceSec: 3,
      noiseDb: -30,
      promptConfig: makePromptConfig(),
    });
    expect(r.silences).toHaveLength(1);
    expect(r.evaluation.error).toContain("rate limit");
    expect(r.evaluation.scores).toEqual({});
  });

  it("skips STT when stt_script and overlaps are off and speech_gaps_stt is off", async () => {
    const cfg = structuredClone(DEFAULT_AUDIO_PIPELINE_CONFIG);
    const inject = cfg.steps.find((s) => s.id === "inject_prompt_vars")!;
    inject.vars = ["silences", "silence_summary"];
    const gaps = cfg.steps.find((s) => s.id === "speech_gaps_stt")!;
    gaps.enabled = false;
    const overlap = cfg.steps.find((s) => s.id === "overlap_ffmpeg")!;
    overlap.enabled = false;

    await evaluateFile("/tmp/x.m4a", {
      minSilenceSec: 3,
      noiseDb: -30,
      promptConfig: makePromptConfig(cfg),
    });

    expect(transcribeCall).not.toHaveBeenCalled();
    expect(runOverlapDetection).not.toHaveBeenCalled();
    expect(runSilenceDetection).toHaveBeenCalled();
  });

  it("skips silence ffmpeg when silence vars are unchecked", async () => {
    const cfg = structuredClone(DEFAULT_AUDIO_PIPELINE_CONFIG);
    const inject = cfg.steps.find((s) => s.id === "inject_prompt_vars")!;
    inject.vars = ["stt_script"];
    const gaps = cfg.steps.find((s) => s.id === "speech_gaps_stt")!;
    gaps.enabled = false;

    await evaluateFile("/tmp/x.m4a", {
      minSilenceSec: 3,
      noiseDb: -30,
      promptConfig: makePromptConfig(cfg),
    });

    // duration probe still calls runSilenceDetection once with high minSilenceSec
    expect(runSilenceDetection).toHaveBeenCalled();
    const silenceCalls = (runSilenceDetection as any).mock.calls;
    expect(silenceCalls.some((c: unknown[]) => (c[1] as { minSilenceSec: number }).minSilenceSec === 9999)).toBe(
      true,
    );
    expect(transcribeCall).toHaveBeenCalled();
    expect(runGeminiEvaluation).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ count: 0 }),
      expect.any(Array),
      expect.objectContaining({ overlaps: [] }),
    );
  });

  it("runs STT for overlaps when preferOverFfmpeg even without stt_script", async () => {
    const cfg = structuredClone(DEFAULT_AUDIO_PIPELINE_CONFIG);
    const inject = cfg.steps.find((s) => s.id === "inject_prompt_vars")!;
    inject.vars = ["overlaps"];
    const gaps = cfg.steps.find((s) => s.id === "speech_gaps_stt")!;
    gaps.enabled = false;

    await evaluateFile("/tmp/x.m4a", {
      minSilenceSec: 3,
      noiseDb: -30,
      promptConfig: makePromptConfig(cfg),
    });

    expect(transcribeCall).toHaveBeenCalled();
    expect(computeSpeechOverlaps).toHaveBeenCalled();
    expect(runOverlapDetection).not.toHaveBeenCalled();
  });

  it("reuses stored STT when conversation already has transcript", async () => {
    (getLatestStoredTranscript as any).mockResolvedValue({
      conversationId: "conv-reuse",
      analysisId: "aid-old",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      durationSec: 1000,
      transcript: [
        { atSec: 0, speaker: "상담원", text: "안녕하세요" },
        { atSec: 2, speaker: "고객", text: "문의요" },
      ],
    });

    const r = await evaluateFile("/tmp/x.m4a", {
      minSilenceSec: 3,
      noiseDb: -30,
      conversationId: "conv-reuse",
      promptConfig: makePromptConfig(),
    });

    expect(transcribeCall).not.toHaveBeenCalled();
    expect(r.sttReused).toBe(true);
    expect(r.sttSource).toBe("gcp");
    expect(runGeminiEvaluation).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({ text: "안녕하세요", speakerTag: 1 }),
        expect.objectContaining({ text: "문의요", speakerTag: 2 }),
      ]),
      expect.any(Object),
    );
  });

  it("reuses local batch STT when no stored transcript exists", async () => {
    (getLatestBatchTranscript as any).mockResolvedValue({
      conversationId: "conv-batch",
      analysisId: "stt-batch:abc",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      durationSec: 1000,
      transcript: [{ atSec: 0, speaker: "상담원", text: "로컬전사" }],
    });

    const r = await evaluateFile("/tmp/x.m4a", {
      minSilenceSec: 3,
      noiseDb: -30,
      conversationId: "conv-batch",
      promptConfig: makePromptConfig(),
    });

    expect(transcribeCall).not.toHaveBeenCalled();
    expect(r.sttReused).toBe(true);
    expect(r.sttSource).toBe("local");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatFetchError,
  localSttJobFormFields,
  localSttJobOptions,
  localSttLegacyJobOptions,
  parseLocalSttHealth,
  parseLocalSttJobView,
  parseLocalSttResult,
  speakerToLabel,
  speakerToTag,
} from "./localSttClient";
import { initialLastRunDateKst } from "./sttBatchKst";

describe("formatFetchError", () => {
  it("unwraps Node fetch failed cause", () => {
    const cause = Object.assign(new Error("connect ETIMEDOUT 172.17.15.85:8760"), { code: "ETIMEDOUT" });
    const err = new TypeError("fetch failed", { cause });
    expect(formatFetchError(err)).toContain("ETIMEDOUT");
    expect(formatFetchError(err)).toContain("172.17.15.85");
  });
});

describe("parseLocalSttHealth", () => {
  it("reads gate/queue/gpu from the documented /v1/health payload", () => {
    const health = parseLocalSttHealth(
      {
        status: "ok",
        gate: {
          accepting_work: false,
          reason: "outside off-peak window; next opens 2026-08-31 22:00",
          windows: ["Mon-Fri 22:00-08:00"],
          window_open: false,
          next_window_at: "2026-08-31T22:00:00",
          override_until: null,
          paused: false,
        },
        gpu: { utilization_pct: 5, memory_free_mb: 11897, memory_total_mb: 16311 },
        queue: { queued: 3 },
        current_job: null,
      },
      true,
    );
    expect(health.ok).toBe(true);
    expect(health.acceptingWork).toBe(false);
    expect(health.reason).toMatch(/off-peak/);
    expect(health.queueDepth).toBe(3);
    expect(health.gpuUtilPct).toBe(5);
    expect(health.busy).toBe(false);
  });
});

describe("parseLocalSttJobView", () => {
  it("allows running to go back to queued", () => {
    expect(parseLocalSttJobView({ status: "running", progress: 0.5, stage: "transcribing" }).status).toBe("running");
    expect(parseLocalSttJobView({ status: "queued", progress: 0 }).status).toBe("queued");
    expect(parseLocalSttJobView({ status: "canceled" }).status).toBe("canceled");
  });
});

describe("parseLocalSttResult", () => {
  it("maps documented segments to agent/customer labels", () => {
    const parsed = parseLocalSttResult({
      language: "ko",
      audio: { duration_sec: 14.572 },
      segments: [
        { channel: 0, speaker: "agent", start: 0.0, end: 5.62, text: "안녕하세요 고객님" },
        { channel: 1, speaker: "customer", start: 7.02, end: 13.9, text: "네 안녕하세요" },
        { channel: 1, speaker: "customer", start: 8, end: 9, text: "" },
      ],
    });
    expect(parsed.durationSec).toBe(14.572);
    expect(parsed.transcript).toEqual([
      { atSec: 0, wordAtSec: 0, speaker: "상담원", text: "안녕하세요 고객님" },
      { atSec: 7.02, wordAtSec: 7.02, speaker: "고객", text: "네 안녕하세요" },
    ]);
    expect(parsed.segments.map((s) => s.speakerTag)).toEqual([1, 2]);
  });

  it("seeks a long turn to its first word and drops a 네 loop", () => {
    const parsed = parseLocalSttResult({
      audio: { duration_sec: 40 },
      segments: [
        {
          channel: 1,
          speaker: "agent",
          start: 14,
          end: 40,
          text: "어떤 걸 설정하신다고요",
          avg_logprob: -0.4,
          words: [
            { start: 32.1, end: 32.4, word: "어떤" },
            { start: 32.4, end: 32.8, word: "걸" },
          ],
        },
        { channel: 1, speaker: "agent", start: 41, end: 42, text: "네네네네네네" },
      ],
    });
    expect(parsed.transcript).toEqual([
      { atSec: 32.1, wordAtSec: 32.1, speaker: "상담원", text: "어떤걸" },
    ]);
    expect(parsed.details[0]).toMatchObject({ atSec: 32.1, endSec: 32.8, avgLogprob: -0.4 });
  });
});

describe("speaker mapping", () => {
  it("uses channel position when speaker is missing", () => {
    expect(speakerToTag("", 0)).toBe(2);
    expect(speakerToTag("", 1)).toBe(1);
    expect(speakerToLabel("agent", 0)).toBe("상담원");
    expect(speakerToLabel("customer", 1)).toBe("고객");
  });
});

describe("initialLastRunDateKst", () => {
  it("does not skip today when created before the due time", () => {
    const before = new Date("2026-08-31T01:00:00+09:00");
    expect(initialLastRunDateKst(2, 0, before)).toBeNull();
  });
  it("skips today when created after the due time", () => {
    const after = new Date("2026-08-31T10:00:00+09:00");
    expect(initialLastRunDateKst(2, 0, after)).toBe("2026-08-31");
  });
});

describe("localSttJobOptions", () => {
  it("does not send a sentence initial_prompt that Whisper can echo", () => {
    expect(localSttJobOptions()).toEqual({
      language: "ko",
      channel_names: ["customer", "agent"],
      word_timestamps: true,
      hotwords: "당근 당근페이 비즈니스 비즈프로필",
      hallucination_silence_threshold: 2,
    });
    expect(localSttJobOptions()).not.toHaveProperty("initial_prompt");
  });

  it("keeps word timestamps when an old server rejects hotwords", () => {
    expect(localSttLegacyJobOptions()).toEqual({
      language: "ko",
      channel_names: ["customer", "agent"],
      word_timestamps: true,
    });
    expect(localSttLegacyJobOptions()).not.toHaveProperty("hotwords");
    expect(localSttLegacyJobOptions()).not.toHaveProperty("initial_prompt");
  });
});

describe("localSttJobFormFields", () => {
  it("keeps conversation id as client_ref and omits force for night batch", () => {
    expect(localSttJobFormFields({ conversationId: "c1", priority: 0 })).toEqual({
      client_ref: "c1",
      priority: "0",
    });
  });

  it("sends force=true with the same client_ref for reprocess", () => {
    expect(localSttJobFormFields({ conversationId: "c1", priority: 100, force: true })).toEqual({
      client_ref: "c1",
      priority: "100",
      force: "true",
    });
  });
});

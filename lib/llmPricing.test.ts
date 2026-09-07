import { describe, expect, it } from "vitest";
import {
  estimateTokenCost,
  formatKrw,
  formatUsd,
  resolveModelRates,
  tokensByModality,
} from "./llmPricing";
import { estimateSttCost } from "./sttPricing";

describe("llmPricing", () => {
  it("resolves flash rates including audio", () => {
    const r = resolveModelRates("gemini-2.5-flash");
    expect(r.matched).toBe(true);
    expect(r.rates.inputPerMTok).toBe(0.3);
    expect(r.rates.audioInputPerMTok).toBe(1.0);
    expect(r.rates.outputPerMTok).toBe(2.5);
  });

  it("estimates cost with audio billed higher than text", () => {
    const cost = estimateTokenCost({
      model: "gemini-2.5-flash",
      promptTokens: 1_000_000,
      audioPromptTokens: 400_000,
      candidatesTokens: 100_000,
      cachedTokens: 0,
    });
    // text 0.6M * 0.3 + audio 0.4M * 1.0 + out 0.1M * 2.5
    expect(cost.textInputUsd).toBeCloseTo(0.18, 6);
    expect(cost.audioInputUsd).toBeCloseTo(0.4, 6);
    expect(cost.outputUsd).toBeCloseTo(0.25, 6);
    expect(cost.totalUsd).toBeCloseTo(0.83, 6);
  });

  it("estimates cost with cached discount on text portion", () => {
    const cost = estimateTokenCost({
      model: "gemini-2.5-flash",
      promptTokens: 1_000_000,
      candidatesTokens: 1_000_000,
      cachedTokens: 500_000,
    });
    expect(cost.inputUsd).toBeCloseTo(0.15, 6);
    expect(cost.cachedUsd).toBeCloseTo(0.015, 6);
    expect(cost.outputUsd).toBeCloseTo(2.5, 6);
  });

  it("parses promptTokensDetails AUDIO", () => {
    const m = tokensByModality({
      promptTokensDetails: [
        { modality: "TEXT", tokenCount: 100 },
        { modality: "AUDIO", tokenCount: 2000 },
      ],
    });
    expect(m.text).toBe(100);
    expect(m.audio).toBe(2000);
  });

  it("formats currency", () => {
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatKrw(1380)).toMatch(/₩/);
  });
});

describe("sttPricing", () => {
  it("bills per channel-second at $0.016/min", () => {
    const c = estimateSttCost({ audioDurationSec: 60, channelCount: 2 });
    expect(c.billableSec).toBe(120);
    expect(c.billableMin).toBe(2);
    expect(c.usd).toBeCloseTo(0.032, 6);
  });
});

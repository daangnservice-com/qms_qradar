import { describe, expect, it } from "vitest";
import { estimateEvalMsFromHistory, formatEtaSec, formatProgressWithEta } from "./evalEta";

describe("evalEta", () => {
  it("formats seconds under a minute", () => {
    expect(formatEtaSec(42)).toBe("약 42초");
  });

  it("formats minutes", () => {
    expect(formatEtaSec(60)).toBe("약 1분");
    expect(formatEtaSec(95)).toBe("약 1분 35초");
  });

  it("appends eta to progress label", () => {
    expect(formatProgressWithEta("전사·채점 중", 23, 50)).toBe("전사·채점 중… 23초 · 예상 약 50초");
    expect(formatProgressWithEta("평가 중", 5, null)).toBe("평가 중… 5초");
  });

  it("falls back without history", () => {
    // 2분 통화 → 40s + 0.3*120 = 76s
    expect(estimateEvalMsFromHistory([], 120)).toBe(76_000);
  });

  it("scales from history by call duration", () => {
    const hist = [{ totalMs: 52_000, callDurationSec: 120 }];
    // 4분 통화 → 52s * (240/120) = 104s
    expect(estimateEvalMsFromHistory(hist, 240)).toBe(104_000);
  });
});

import { describe, it, expect } from "vitest";
import {
  coerceAtSec,
  isCustomerContextQuote,
  looksLikeMinuteDotSecond,
  matchAtSecFromStt,
  minuteDotSecondToSec,
  stripEvidenceSpeakerPrefix,
} from "./atSecNormalize";

describe("atSecNormalize", () => {
  it("detects MM.SS shaped numbers", () => {
    expect(looksLikeMinuteDotSecond(3.16)).toBe(true);
    expect(looksLikeMinuteDotSecond(12.05)).toBe(true);
    expect(looksLikeMinuteDotSecond(1.2)).toBe(false); // one decimal → real seconds
    expect(looksLikeMinuteDotSecond(135.2)).toBe(false);
    expect(looksLikeMinuteDotSecond(196)).toBe(false);
  });

  it("converts MM.SS to seconds (minutes>=1)", () => {
    expect(minuteDotSecondToSec(3.16)).toBe(3 * 60 + 16);
    expect(minuteDotSecondToSec(12.05)).toBe(12 * 60 + 5);
    expect(minuteDotSecondToSec(0.45)).toBe(0.45); // keep fractional seconds
    expect(minuteDotSecondToSec(1.2)).toBe(1.2);
    expect(minuteDotSecondToSec(196)).toBe(196);
  });

  it("matches quote to STT atSec", () => {
    const stt = [
      { atSec: 10, text: "안녕하세요" },
      { atSec: 196.4, text: "앱에서 확인 부탁드려도 될까요" },
    ];
    expect(matchAtSecFromStt("앱에서 확인 부탁드려도 될까요", stt)).toBe(196.4);
    expect(matchAtSecFromStt("확인 부탁", stt)).toBe(196.4);
  });

  it("coerce prefers STT match over MM.SS", () => {
    const stt = [{ atSec: 196.4, text: "지금 바로 앱 켜서 확인하셔야 해요" }];
    // model wrote 3.16 but quote matches STT @196.4s
    expect(coerceAtSec(3.16, { quote: "지금 바로 앱 켜서 확인하셔야 해요", stt })).toBe(196.4);
  });

  it("coerce falls back to MM.SS when no STT hit", () => {
    expect(coerceAtSec(3.16, { quote: "없는 인용", stt: [{ atSec: 10, text: "다른 말" }] })).toBe(196);
    expect(coerceAtSec(3.16)).toBe(196);
  });

  it("strips speaker prefixes and keeps counselor atSec on customer quotes", () => {
    expect(stripEvidenceSpeakerPrefix("상담원: 네 확인해 드릴게요")).toBe("네 확인해 드릴게요");
    expect(isCustomerContextQuote("고객: 이해력이 떨어져요")).toBe(true);
    expect(isCustomerContextQuote("상담원: 네네")).toBe(false);

    const stt = [
      { atSec: 668, text: "제가 이렇게 전문적으로 물어보시면 이해력이 떨어져요" },
      { atSec: 672.1, text: "네네 확인해 드릴게요" },
    ];
    expect(
      coerceAtSec(672.1, {
        quote: "고객: 제가 이렇게 전문적으로 물어보시면 이해력이 떨어져요",
        stt,
      }),
    ).toBe(672.1);
    expect(
      coerceAtSec(672.1, {
        quote: "상담원: 네네 확인해 드릴게요",
        stt,
      }),
    ).toBe(672.1);
  });
});

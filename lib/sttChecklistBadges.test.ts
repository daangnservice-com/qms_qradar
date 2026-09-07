import { describe, it, expect } from "vitest";
import {
  buildSttChecklistBadges,
  nearestAgentSegmentIndex,
  nearestSegmentIndex,
} from "./sttChecklistBadges";

describe("sttChecklistBadges", () => {
  it("picks nearest segment by atSec", () => {
    const segs = [{ atSec: 10 }, { atSec: 60 }, { atSec: 196 }];
    expect(nearestSegmentIndex(196, segs)).toBe(2);
    expect(nearestSegmentIndex(3.16, segs)).toBe(0); // raw seconds → near 10? 3.16 closer to 10 than others... |3.16-10|=6.84, |3.16-60| bigger → 0
    expect(nearestSegmentIndex(55, segs)).toBe(1);
  });

  it("attaches coerced MM.SS evidence to matching STT time", () => {
    const segments = [
      { atSec: 10, speaker: "고객", text: "안녕하세요" },
      { atSec: 196, speaker: "상담사", text: "지금 바로 앱 켜서 확인하셔야 해요" },
    ];
    const badges = buildSttChecklistBadges(segments, [
      {
        id: 411,
        violated: true,
        reason: "명령조",
        evidence: [{ atSec: 3.16, quote: "지금 바로 앱 켜서 확인하셔야 해요" }],
      },
    ]);
    expect(badges).toHaveLength(1);
    expect(badges[0].segmentIndex).toBe(1);
    expect(badges[0].evidenceAtSec).toBe(196); // quote match → 196, or MM.SS → 196
    expect(badges[0].violated).toBe(true);
  });

  it("uses prompt criteria label for ids outside CS_CHECKLIST", () => {
    const segments = [{ atSec: 352, speaker: "고객", text: "받았습니다 감사합니다" }];
    const badges = buildSttChecklistBadges(
      segments,
      [
        {
          id: 340,
          violated: true,
          reason: "감사",
          evidence: [{ atSec: 352, quote: "받았습니다 감사합니다" }],
        },
      ],
      [{ id: 340, label: "Best 후보", category: "우수상담 후보군" }],
    );
    // 고객만 있는 transcript — agent 세그먼트 없으면 최근접(고객) fallback
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe("Best 후보");
    expect(badges[0].category).toBe("우수상담 후보군");
  });

  it("skips customer-prefixed evidence and pins badge to agent utterance", () => {
    const segments = [
      { atSec: 33.1, speaker: "고객", text: "이해력이 떨어져요" },
      { atSec: 74.7, speaker: "상담원", text: "네네 확인해 드릴게요" },
    ];
    const badges = buildSttChecklistBadges(segments, [
      {
        id: 415,
        violated: true,
        reason: "공감 누락",
        evidence: [
          { atSec: 33.1, quote: "고객: 이해력이 떨어져요" },
          { atSec: 74.7, quote: "상담원: 네네 확인해 드릴게요" },
        ],
      },
    ]);
    expect(badges).toHaveLength(1);
    expect(badges[0].segmentIndex).toBe(1);
    expect(badges[0].evidenceAtSec).toBe(74.7);
    expect(badges[0].quote).toContain("상담원:");
    expect(badges[0].contextQuotes).toEqual(["고객: 이해력이 떨어져요"]);
  });

  it("does not badge when only customer-prefixed evidence exists", () => {
    const segments = [
      { atSec: 10, speaker: "고객", text: "답답해요" },
      { atSec: 20, speaker: "상담원", text: "네" },
    ];
    const badges = buildSttChecklistBadges(segments, [
      {
        id: 415,
        violated: true,
        reason: "공감 누락",
        evidence: [{ atSec: 10, quote: "고객: 답답해요" }],
      },
    ]);
    expect(badges).toHaveLength(0);
  });

  it("nearestAgentSegmentIndex prefers counselor even if customer is closer in time", () => {
    const segments = [
      { atSec: 70, speaker: "고객", text: "헐" },
      { atSec: 74.7, speaker: "상담원", text: "네 확인해 드릴게요" },
    ];
    // atSec 71 is closer to customer(70) than agent(74.7), but prefer agent
    expect(nearestAgentSegmentIndex(71, segments)).toBe(1);
  });
});

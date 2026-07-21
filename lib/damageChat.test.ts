import { describe, it, expect } from "vitest";
import { buildChatContext } from "./damageChat";
import type { DamageResult } from "./types";

const RESULT: DamageResult = {
  verdict: "파손됨",
  confidence: 0.82,
  summary: "우측 하단 긁힘",
  comparison: "신청인 사진에만 보임",
  findings: [
    { location: "우측 하단", type: "긁힘", description: "3cm", photoIndex: 0, party: "claimant", box: null },
  ],
  perPhoto: [],
  claimantCount: 1,
  respondentCount: 1,
  promptVersion: "v1",
};

describe("buildChatContext", () => {
  it("embeds verdict, comparison, party-labelled findings and Korean answer rules", () => {
    const ctx = buildChatContext(RESULT);
    expect(ctx).toContain("파손됨");
    expect(ctx).toContain("82%");
    expect(ctx).toContain("신청인 사진에만 보임");
    expect(ctx).toContain("신청인 사진 1"); // 파당 로컬 번호로 지칭
    expect(ctx).toContain("긁힘");
    expect(ctx).toContain("한국어");
  });

  it("shows (없음) when there are no findings", () => {
    const ctx = buildChatContext({ ...RESULT, findings: [] });
    expect(ctx).toContain("(없음)");
  });
});

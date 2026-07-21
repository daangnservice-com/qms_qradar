import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDamagePrompt, parseDamageResult, partyOfIndex, DAMAGE_PROMPT_VERSION } from "./vision";

describe("buildDamagePrompt", () => {
  it("describes both parties, verdict rules, comparison, and Korean instruction", () => {
    const p = buildDamagePrompt({ claimant: 2, respondent: 1 });
    expect(p).toContain("3장");
    expect(p).toContain("신청인");
    expect(p).toContain("피신청인");
    expect(p).toContain("파손됨");
    expect(p).toContain("정상");
    expect(p).toContain("불확실");
    expect(p).toContain("comparison");
    expect(p).toContain("한국어");
    expect(p).toContain("photoIndex");
    expect(p).toContain("box");
  });

  it("marks a party with no photos as 없음", () => {
    const p = buildDamagePrompt({ claimant: 2, respondent: 0 });
    expect(p).toContain("피신청인(반박하는 쪽)이 제출: 없음");
  });
});

describe("partyOfIndex", () => {
  it("splits the unified index at the claimant count", () => {
    const counts = { claimant: 2, respondent: 2 };
    expect(partyOfIndex(0, counts)).toBe("claimant");
    expect(partyOfIndex(1, counts)).toBe("claimant");
    expect(partyOfIndex(2, counts)).toBe("respondent");
    expect(partyOfIndex(3, counts)).toBe("respondent");
  });
});

describe("parseDamageResult", () => {
  it("parses a well-formed response and derives party from the index", () => {
    const raw = readFileSync(path.resolve(__dirname, "../test/fixtures/damage-response.json"), "utf8");
    const r = parseDamageResult(raw, { claimant: 1, respondent: 1 });
    expect(r.verdict).toBe("파손됨");
    expect(r.confidence).toBeCloseTo(0.87, 2);
    expect(r.comparison).toContain("피신청인");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].type).toBe("긁힘");
    expect(r.findings[0].photoIndex).toBe(1);
    expect(r.findings[0].party).toBe("respondent");
    expect(r.findings[0].box).toEqual({ ymin: 720, xmin: 640, ymax: 880, xmax: 900 });
    expect(r.perPhoto[1].note).toContain("후면");
    expect(r.claimantCount).toBe(1);
    expect(r.respondentCount).toBe(1);
    expect(r.promptVersion).toBe(DAMAGE_PROMPT_VERSION);
  });

  it("defaults photoIndex to 0 and box to null when a finding lacks them", () => {
    const r = parseDamageResult(
      '{"verdict":"파손됨","confidence":0.5,"summary":"","comparison":"","findings":[{"location":"앞면","type":"오염","description":"얼룩"}],"perPhoto":[]}',
      { claimant: 1, respondent: 0 },
    );
    expect(r.findings[0].photoIndex).toBe(0);
    expect(r.findings[0].party).toBe("claimant");
    expect(r.findings[0].box).toBeNull();
  });

  it("drops the box (no draw) for an out-of-range photoIndex instead of mis-attributing it", () => {
    const r = parseDamageResult(
      '{"verdict":"파손됨","confidence":0.5,"summary":"","comparison":"","findings":[{"location":"a","type":"b","description":"c","photoIndex":9,"box":{"ymin":10,"xmin":10,"ymax":20,"xmax":20}}],"perPhoto":[]}',
      { claimant: 1, respondent: 1 },
    );
    expect(r.findings[0].photoIndex).toBe(0);
    // 범위 밖이면 유효한 box가 와도 그리지 않는다(엉뚱한 사진 오귀속 방지)
    expect(r.findings[0].box).toBeNull();
  });

  it("returns null box for a malformed box", () => {
    const r = parseDamageResult(
      '{"verdict":"파손됨","confidence":0.5,"summary":"","comparison":"","findings":[{"location":"a","type":"b","description":"c","photoIndex":1,"box":{"ymin":"x"}}],"perPhoto":[]}',
      { claimant: 1, respondent: 1 },
    );
    expect(r.findings[0].photoIndex).toBe(1);
    expect(r.findings[0].box).toBeNull();
  });

  it("tolerates code fences and defaults missing arrays and comparison", () => {
    const r = parseDamageResult('```json\n{"verdict":"정상","confidence":0.9,"summary":"이상 없음"}\n```', {
      claimant: 1,
      respondent: 0,
    });
    expect(r.verdict).toBe("정상");
    expect(r.comparison).toBe("");
    expect(r.findings).toEqual([]);
    expect(r.perPhoto).toEqual([]);
  });

  it("falls back to 불확실 for an unknown verdict", () => {
    const r = parseDamageResult('{"verdict":"몰라요","confidence":0.1,"summary":"","comparison":"","findings":[],"perPhoto":[]}', {
      claimant: 0,
      respondent: 1,
    });
    expect(r.verdict).toBe("불확실");
  });
});

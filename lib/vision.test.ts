import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDamagePrompt, parseDamageResult } from "./vision";

describe("buildDamagePrompt", () => {
  it("includes verdict rules, 불확실 case, and Korean instruction", () => {
    const p = buildDamagePrompt(3);
    expect(p).toContain("3장");
    expect(p).toContain("파손됨");
    expect(p).toContain("정상");
    expect(p).toContain("불확실");
    expect(p).toContain("여러 각도");
    expect(p).toContain("한국어");
  });
});

describe("parseDamageResult", () => {
  it("parses a well-formed response", () => {
    const raw = readFileSync(path.resolve(__dirname, "../test/fixtures/damage-response.json"), "utf8");
    const r = parseDamageResult(raw);
    expect(r.verdict).toBe("파손됨");
    expect(r.confidence).toBeCloseTo(0.87, 2);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].type).toBe("긁힘");
    expect(r.perPhoto[1].note).toContain("후면");
  });

  it("tolerates code fences and defaults missing arrays", () => {
    const r = parseDamageResult('```json\n{"verdict":"정상","confidence":0.9,"summary":"이상 없음"}\n```');
    expect(r.verdict).toBe("정상");
    expect(r.findings).toEqual([]);
    expect(r.perPhoto).toEqual([]);
  });

  it("falls back to 불확실 for an unknown verdict", () => {
    const r = parseDamageResult('{"verdict":"몰라요","confidence":0.1,"summary":"","findings":[],"perPhoto":[]}');
    expect(r.verdict).toBe("불확실");
  });
});

import { describe, expect, it } from "vitest";
import {
  BATCH_STT_VERSION_ID,
  analysisIdFromSttVersionId,
  evalSttVersionId,
  evalVersionLabel,
  latestByAnalyzedAt,
  mergeSttVersions,
  sttVersionLabel,
  transcriptFingerprint,
  type SttVersionCandidate,
} from "./callArtifactVersions";

const seg = (text: string, atSec = 0) => ({ atSec, speaker: "상담원", text });

describe("transcriptFingerprint", () => {
  it("ignores empty utterances and changes when the body changes", () => {
    const a = [seg("안녕"), seg("  "), seg("문의요")];
    const b = [seg("안녕"), seg("문의요")];
    const c = [seg("안녕"), seg("다른 말")];
    expect(transcriptFingerprint(a)).toBe(transcriptFingerprint(b));
    expect(transcriptFingerprint(a)).not.toBe(transcriptFingerprint(c));
    expect(transcriptFingerprint([])).toBe("");
  });
});

describe("mergeSttVersions", () => {
  it("keeps the latest copy of the same transcript and prefers the later origin on ties", () => {
    const fp = transcriptFingerprint([seg("동일")]);
    const evalOlder: SttVersionCandidate = {
      versionId: evalSttVersionId("a1"),
      analyzedAt: "2026-09-17T01:00:00.000Z",
      sttSource: "gcp",
      segmentCount: 1,
      durationSec: 10,
      origin: "eval",
      analysisId: "a1",
      fingerprint: fp,
    };
    const evalNewerSame: SttVersionCandidate = {
      ...evalOlder,
      versionId: evalSttVersionId("a2"),
      analyzedAt: "2026-09-18T01:00:00.000Z",
      analysisId: "a2",
    };
    const batchSameTime: SttVersionCandidate = {
      versionId: BATCH_STT_VERSION_ID,
      analyzedAt: "2026-09-18T01:00:00.000Z",
      sttSource: "local",
      segmentCount: 1,
      durationSec: 10,
      origin: "batch",
      analysisId: null,
      fingerprint: fp,
    };
    const other: SttVersionCandidate = {
      versionId: evalSttVersionId("b1"),
      analyzedAt: "2026-09-16T01:00:00.000Z",
      sttSource: "gcp",
      segmentCount: 1,
      durationSec: 8,
      origin: "eval",
      analysisId: "b1",
      fingerprint: transcriptFingerprint([seg("다른 전사")]),
    };
    const merged = mergeSttVersions([evalOlder, other, evalNewerSame, batchSameTime]);
    expect(merged.map((v) => v.versionId)).toEqual([BATCH_STT_VERSION_ID, evalSttVersionId("b1")]);
    expect(merged[0]?.sttSource).toBe("local");
  });
});

describe("labels", () => {
  it("marks the latest STT/eval version", () => {
    const stt = {
      versionId: "batch",
      analyzedAt: "2026-09-18T02:03:00.000Z",
      sttSource: "local" as const,
      segmentCount: 3,
      durationSec: 40,
      origin: "batch" as const,
    };
    expect(sttVersionLabel(stt, "batch")).toContain("최신");
    expect(sttVersionLabel(stt, "eval:x")).toContain("로컬 STT");
    expect(sttVersionLabel(stt, "eval:x")).not.toContain("최신");

    const ev = {
      analysisId: "a1",
      analyzedAt: "2026-09-18T02:03:00.000Z",
      promptVersion: "260918_ver1",
      promptVersionId: "p1",
      aiLabel: "review_needed",
      analyzedBy: null,
    };
    expect(evalVersionLabel(ev, "a1")).toContain("검토 필요");
    expect(evalVersionLabel(ev, "a1")).toContain("최신");
    expect(latestByAnalyzedAt([ev, { ...ev, analysisId: "a0", analyzedAt: "2026-09-17T00:00:00.000Z" }])?.analysisId).toBe("a1");
    expect(analysisIdFromSttVersionId(evalSttVersionId("abc"))).toBe("abc");
  });
});

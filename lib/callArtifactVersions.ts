import { displayReviewNeededLabel } from "./judgmentUi";
import type { SttSource } from "./types";

export const BATCH_STT_VERSION_ID = "batch";

export type CallSttVersionOrigin = "eval" | "batch";

/** STT 패널 드롭다운용. 동일 전사는 fingerprint로 한 칸만 남긴다. */
export type CallSttVersionSummary = {
  versionId: string;
  analyzedAt: string;
  sttSource: SttSource | null;
  segmentCount: number;
  durationSec: number;
  origin: CallSttVersionOrigin;
  analysisId?: string | null;
};

/** AI 평가 패널 드롭다운용. analysis_id 1건 = 1버전. */
export type CallEvalVersionSummary = {
  analysisId: string;
  analyzedAt: string;
  promptVersion: string | null;
  promptVersionId: string | null;
  aiLabel: string | null;
  analyzedBy: string | null;
  purpose?: string | null;
};

export type SttVersionCandidate = CallSttVersionSummary & { fingerprint: string };

export function evalSttVersionId(analysisId: string): string {
  return `eval:${analysisId.trim()}`;
}

/** 로컬 STT 한 회차. 최신은 `batch`, 이전 회차는 `batch:{jobId}`. */
export function batchSttVersionId(archiveKey: string): string {
  const key = archiveKey.trim();
  return key ? `${BATCH_STT_VERSION_ID}:${key}` : BATCH_STT_VERSION_ID;
}

export function isBatchSttVersionId(versionId: string): boolean {
  const id = versionId.trim();
  return id === BATCH_STT_VERSION_ID || id.startsWith(`${BATCH_STT_VERSION_ID}:`);
}

export function analysisIdFromSttVersionId(versionId: string): string | null {
  const id = versionId.trim();
  return id.startsWith("eval:") ? id.slice("eval:".length).trim() || null : null;
}

export function transcriptFingerprint(
  segments: Array<{ atSec?: number; text?: string }>,
): string {
  const segs = segments.filter((s) => (s.text ?? "").trim());
  if (!segs.length) return "";
  const first = segs[0];
  const last = segs[segs.length - 1];
  const mid = segs[Math.floor(segs.length / 2)];
  return [
    segs.length,
    first?.atSec ?? 0,
    (first?.text ?? "").trim(),
    mid?.atSec ?? 0,
    (mid?.text ?? "").trim(),
    last?.atSec ?? 0,
    (last?.text ?? "").trim(),
  ].join("\u001f");
}

export function analyzedAtMs(iso: string | null | undefined): number {
  const n = Date.parse(String(iso ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** 같은 전사는 최신 1개만. 시각이 같으면 나중에 넣은 후보(배치 등)가 이긴다. */
export function mergeSttVersions(candidates: SttVersionCandidate[]): CallSttVersionSummary[] {
  const best = new Map<string, SttVersionCandidate>();
  for (const c of candidates) {
    const fp = c.fingerprint.trim();
    if (!fp) continue;
    const prev = best.get(fp);
    if (!prev || analyzedAtMs(c.analyzedAt) >= analyzedAtMs(prev.analyzedAt)) {
      best.set(fp, c);
    }
  }
  return [...best.values()]
    .sort((a, b) => analyzedAtMs(b.analyzedAt) - analyzedAtMs(a.analyzedAt))
    .map(({ fingerprint: _fp, ...rest }) => rest);
}

export function latestByAnalyzedAt<T extends { analyzedAt: string }>(items: T[]): T | null {
  if (!items.length) return null;
  return items.reduce((best, cur) => (analyzedAtMs(cur.analyzedAt) > analyzedAtMs(best.analyzedAt) ? cur : best));
}

export function formatVersionAt(iso: string | null | undefined): string {
  const ms = analyzedAtMs(iso);
  if (!ms) return "시각 없음";
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
}

function sttSourceLabel(source: SttSource | null | undefined): string {
  if (source === "local") return "로컬 STT";
  if (source === "gcp") return "GCP STT";
  return "STT";
}

export function sttVersionLabel(v: CallSttVersionSummary, latestId?: string | null): string {
  const latest = latestId && v.versionId === latestId ? " · 최신" : "";
  return `${formatVersionAt(v.analyzedAt)} · ${sttSourceLabel(v.sttSource)}${latest}`;
}

export function evalVersionLabel(v: CallEvalVersionSummary, latestId?: string | null): string {
  const latest = latestId && v.analysisId === latestId ? " · 최신" : "";
  const prompt = v.promptVersion?.trim() || "평가셋 없음";
  const label = displayReviewNeededLabel(v.aiLabel);
  const purpose = v.purpose === "qa_eval" ? " · QA" : "";
  return `${formatVersionAt(v.analyzedAt)} · ${prompt} · ${label}${purpose}${latest}`;
}

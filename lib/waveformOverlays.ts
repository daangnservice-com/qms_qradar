import type { SpeechOverlap } from "./silence";
import type { Silence } from "./types";

export type WaveformOverlayKind = "overlap" | "sentiment" | "silence" | "custom";

/** 구간 밴드 — 말겹침, 감성 격앙 구간, 공백 등 */
export type WaveformIntervalOverlay = {
  id: string;
  kind: WaveformOverlayKind;
  startSec: number;
  endSec: number;
  label?: string;
  /** 채널 정렬: both=전체 폭, left/right=해당 파형 레인 */
  channel?: "both" | "left" | "right";
  /** 감성 강도 등 0~1 (틴트/높이) */
  intensity?: number;
  tone?: string;
};

/** 시계열 — 향후 감성 스코어 곡선 */
export type WaveformSeriesOverlay = {
  id: string;
  kind: "sentiment";
  points: { atSec: number; value: number }[]; // 예: -1..1
};

export type WaveformOverlay = WaveformIntervalOverlay | WaveformSeriesOverlay;

export function isIntervalOverlay(o: WaveformOverlay): o is WaveformIntervalOverlay {
  return "startSec" in o && "endSec" in o;
}

export function isSeriesOverlay(o: WaveformOverlay): o is WaveformSeriesOverlay {
  return o.kind === "sentiment" && "points" in o && Array.isArray(o.points);
}

/** 기존 SpeechOverlap → 파형 오버레이 */
export function overlapsToOverlays(overlaps: SpeechOverlap[]): WaveformIntervalOverlay[] {
  return overlaps
    .filter((o) => Number.isFinite(o.startSec) && Number.isFinite(o.endSec) && o.endSec > o.startSec)
    .map((o, i) => ({
      id: `overlap-${i}-${o.startSec.toFixed(2)}`,
      kind: "overlap" as const,
      startSec: o.startSec,
      endSec: o.endSec,
      label: o.durationSec != null ? `말 겹침 ${o.durationSec.toFixed(1)}초` : "말 겹침",
      channel: "both" as const,
    }));
}

/** 공백 구간 → 파형 오버레이 (선택 연결용) */
export function silencesToOverlays(silences: Silence[]): WaveformIntervalOverlay[] {
  return silences
    .filter((s) => Number.isFinite(s.startSec) && Number.isFinite(s.endSec) && s.endSec > s.startSec)
    .map((s, i) => ({
      id: `silence-${i}-${s.startSec.toFixed(2)}`,
      kind: "silence" as const,
      startSec: s.startSec,
      endSec: s.endSec,
      label: `공백 ${s.durationSec.toFixed(1)}초`,
      channel: "both" as const,
    }));
}

/** 감성 격앙 등 구간 스팬 — 파이프라인 붙일 자리 */
export function sentimentSpansToOverlays(
  spans: { startSec: number; endSec: number; intensity?: number; label?: string }[],
): WaveformIntervalOverlay[] {
  return spans
    .filter((s) => Number.isFinite(s.startSec) && Number.isFinite(s.endSec) && s.endSec > s.startSec)
    .map((s, i) => ({
      id: `sentiment-span-${i}-${s.startSec.toFixed(2)}`,
      kind: "sentiment" as const,
      startSec: s.startSec,
      endSec: s.endSec,
      label: s.label ?? "감성",
      channel: "both" as const,
      intensity: s.intensity,
    }));
}

/**
 * agitated.comment 의 `startSec~endSec 근거` 형식 파싱.
 * 예: `196.0~210.5 고객 고성; 400~415 언성 상승`
 */
export function parseAgitatedSpansFromComment(
  comment: string | null | undefined,
): { startSec: number; endSec: number; label?: string }[] {
  if (!comment?.trim()) return [];
  const spans: { startSec: number; endSec: number; label?: string }[] = [];
  const re = /(\d+(?:\.\d+)?)\s*[~～\-–—]\s*(\d+(?:\.\d+)?)\s*([^;|]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(comment)) != null) {
    const startSec = Number(m[1]);
    const endSec = Number(m[2]);
    if (!(Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec)) continue;
    const label = m[3]?.trim() || "격앙";
    spans.push({ startSec, endSec, label });
  }
  return spans;
}

/** 감성 시계열 곡선 — 파이프라인 붙일 자리 */
export function sentimentSeriesOverlay(
  id: string,
  points: { atSec: number; value: number }[],
): WaveformSeriesOverlay {
  return {
    id,
    kind: "sentiment",
    points: points.filter((p) => Number.isFinite(p.atSec) && Number.isFinite(p.value)),
  };
}

/** kind별 트랙 틴트 (Tailwind/CSS var 클래스) */
export function overlayBandClass(kind: WaveformOverlayKind): string {
  switch (kind) {
    case "overlap":
      return "bg-[var(--warning)]/35";
    case "sentiment":
      return "bg-[var(--danger)]/30";
    case "silence":
      return "bg-[var(--fg-tertiary)]/20";
    default:
      return "bg-[var(--info)]/25";
  }
}

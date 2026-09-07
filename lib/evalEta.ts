/** 평가 wall-clock ETA: 브라우저에 쌓인 최근 성공 이력 + 통화 길이 스케일 */

const STORAGE_KEY = "helpdesk-x:eval-eta-history";
const MAX_HISTORY = 10;

export type EvalEtaSample = { totalMs: number; callDurationSec: number | null };

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function loadEvalEtaHistory(): EvalEtaSample[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is EvalEtaSample => !!x && typeof x === "object" && typeof (x as EvalEtaSample).totalMs === "number")
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export function recordEvalEta(sample: EvalEtaSample): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(sample.totalMs) || sample.totalMs <= 0) return;
  const next = [...loadEvalEtaHistory(), sample].slice(-MAX_HISTORY);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

/** 이력 + 통화길이로 예상 ms. hist 생략 시 localStorage. */
export function estimateEvalMsFromHistory(
  hist: EvalEtaSample[],
  callDurationSec: number | null | undefined,
): number {
  const dur = callDurationSec != null && Number.isFinite(callDurationSec) && callDurationSec > 0 ? callDurationSec : null;
  if (hist.length) {
    const medTotal = median(hist.map((h) => h.totalMs));
    const withDur = hist.filter((h) => h.callDurationSec != null && h.callDurationSec > 0);
    const medCall = median(withDur.map((h) => h.callDurationSec!));
    if (medTotal != null) {
      if (dur != null && medCall != null && medCall > 0) {
        const scaled = medTotal * (dur / medCall);
        return Math.round(Math.min(Math.max(scaled, 15_000), 600_000));
      }
      return Math.round(Math.min(Math.max(medTotal, 15_000), 600_000));
    }
  }
  // 폴백: ~40s + 0.3 * callDurationSec (2분 통화 ≈ 76초 감안; 단위 ms)
  const fallback = 40_000 + 300 * (dur ?? 120);
  return Math.round(Math.min(Math.max(fallback, 20_000), 300_000));
}

export function estimateEvalMs(callDurationSec: number | null | undefined): number {
  return estimateEvalMsFromHistory(loadEvalEtaHistory(), callDurationSec);
}

export function formatEtaSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `약 ${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `약 ${m}분 ${r}초` : `약 ${m}분`;
}

export function formatProgressWithEta(label: string, elapsedSec: number, etaSec: number | null): string {
  const base = `${label}… ${elapsedSec}초`;
  if (etaSec == null || etaSec <= 0) return base;
  return `${base} · 예상 ${formatEtaSec(etaSec)}`;
}

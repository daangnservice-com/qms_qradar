/** 장콜 임계값(분) — 순수 판정·퍼센타일 유틸. BQ I/O는 longCallThresholdStore. */

/** 당일 제외 직전 N일 일별 퍼센타일의 이동평균. */
export const LONG_CALL_THRESHOLD_WINDOW_DAYS = 7;

export type LongCallThresholdSnapshot = {
  snapshotId: string;
  ruleKey: string;
  percentile: number;
  windowDays: number;
  /** 윈도우 시작(당일 제외 직전 N일의 첫날, KST YYYY-MM-DD) */
  windowStart: string;
  /** 윈도우 끝(어제, KST YYYY-MM-DD) */
  windowEnd: string;
  /** 일별 상위 퍼센타일 통화시간(분)의 MA */
  thresholdMinutes: number;
  /** 일별 상세(선택) */
  daily: Array<{ date: string; thresholdMinutes: number; sampleCount: number }>;
  /** 스냅샷이 유효한 KST 날짜(=계산 당일). 이 값이 오늘이면 재계산 불필요 */
  asOfDate: string;
  computedAt: string;
};

/** 상위 p% → quantile 오프셋(0–100). 예: 상위 10% → P90 → 90 */
export function topPercentileQuantileOffset(percentile: number): number {
  const p = Math.min(Math.max(Number(percentile) || 10, 1), 50);
  return Math.min(99, Math.max(50, 100 - Math.round(p)));
}

export function clampLongCallPercentile(percentile: number): number {
  const n = Number(percentile);
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 1), 50);
}

/** 일별 임계값(분)의 단순 평균. 표본 없는 날은 제외. */
export function meanDailyThresholdMinutes(
  daily: Array<{ thresholdMinutes: number; sampleCount?: number }>,
): number | null {
  const vals = daily
    .filter((d) => (d.sampleCount == null || d.sampleCount > 0) && Number.isFinite(d.thresholdMinutes) && d.thresholdMinutes > 0)
    .map((d) => d.thresholdMinutes);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * 통화가 장콜인지. thresholdMinutes = 저장된 MA 기준분.
 * minMinutes가 있으면 AND(둘 다 이상).
 */
export function isLongCallDuration(
  durationSec: number | null | undefined,
  thresholdMinutes: number,
  minMinutes?: number | null,
): boolean {
  if (durationSec == null || !(durationSec > 0)) return false;
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) return false;
  const minutes = durationSec / 60;
  if (minMinutes != null && Number.isFinite(Number(minMinutes)) && minutes < Number(minMinutes)) {
    return false;
  }
  return minutes >= thresholdMinutes;
}

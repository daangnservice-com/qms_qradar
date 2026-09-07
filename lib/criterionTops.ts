/** 항목별 감지 비교 행 (UI·집계 공통) */
export type CriterionDiffRow = {
  id: number;
  fp: number;
  fn: number;
  diffCount: number;
};

/**
 * 과검출(FP) top / 미검출(FN) top.
 * 양쪽에 모두 들어가는 항목은 과검출에만 표시.
 */
export function splitOverUnderTops<T extends CriterionDiffRow>(
  byCriterion: T[],
  topN = 12,
): { overDetect: T[]; underDetect: T[] } {
  const overDetect = [...byCriterion]
    .filter((r) => r.fp > 0)
    .sort((a, b) => b.fp - a.fp || b.diffCount - a.diffCount)
    .slice(0, topN);
  const overIds = new Set(overDetect.map((r) => r.id));
  const underDetect = [...byCriterion]
    .filter((r) => r.fn > 0 && !overIds.has(r.id))
    .sort((a, b) => b.fn - a.fn || b.diffCount - a.diffCount)
    .slice(0, topN);
  return { overDetect, underDetect };
}

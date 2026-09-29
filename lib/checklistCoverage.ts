/** Never synthesize a false/normal result for inactive or omitted criteria. */
export function validateChecklistCoverage(results: { id: number }[], activeIds: number[]): void {
  const ids = results.map((r) => r.id);
  if (ids.length !== activeIds.length || new Set(ids).size !== ids.length || ids.some((id) => !activeIds.includes(id))) {
    throw new Error('체크리스트 출력이 활성 평가항목과 일치하지 않습니다');
  }
}

// CS 체크리스트 기준 BQ 로드 (서버 전용).
// 클라이언트가 import하는 lib/csChecklist.ts 에 BigQuery를 넣지 않기 위해 분리.
import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { CS_CHECKLIST, type CsCriterion } from "./csChecklist";

let _criteriaCache: CsCriterion[] | null = null;

/**
 * 평가 기준 로드. growthBq.criteriaView가 있으면 BQ 뷰 조회, 없거나 실패하면 CS_CHECKLIST.
 * 뷰 컬럼: id, parent_name, name (, type, extra …)
 */
export async function loadCsChecklist(): Promise<CsCriterion[]> {
  if (_criteriaCache) return _criteriaCache;
  const viewSql = growthBq.criteriaSql();
  if (!viewSql) return CS_CHECKLIST;

  try {
    const query = `
      select
        id,
        parent_name as category,
        name as label,
        cast(null as string) as hint
      from ${viewSql}
      order by parent_name, id
    `;
    const opts = growthBq.location ? { location: growthBq.location } : {};
    const [rows] = await getBQ().query({ query, ...opts });
    const list = (rows as Record<string, unknown>[])
      .map((r) => ({
        id: Number(r.id),
        category: String(r.category ?? ""),
        label: String(r.label ?? ""),
        hint: String(r.hint ?? ""),
      }))
      .filter((c) => Number.isFinite(c.id) && c.label);
    if (!list.length) {
      console.warn("[csChecklist] BQ 뷰 결과 비어 있음 — 하드코딩 폴백 사용");
      return CS_CHECKLIST;
    }
    _criteriaCache = list;
    return list;
  } catch (e) {
    console.warn(
      `[csChecklist] BQ 기준 로드 실패 — 하드코딩 폴백: ${e instanceof Error ? e.message : String(e)}`,
    );
    return CS_CHECKLIST;
  }
}

/** 테스트·핫리로드용 캐시 초기화. */
export function clearCsChecklistCache(): void {
  _criteriaCache = null;
}

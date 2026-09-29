// CS 체크리스트 기준 로드 (서버 전용). 원본 기준 뷰의 서빙 사본(qms_source_criteria, 야간 pull)을 읽는다.
// 클라이언트가 import하는 lib/csChecklist.ts 에 DB 접근을 넣지 않기 위해 분리.
import { growthBq } from "./bqRefs";
import { servingQuery } from "./servingDb";
import { CS_CHECKLIST, type CsCriterion } from "./csChecklist";

let _criteriaCache: CsCriterion[] | null = null;

/**
 * 평가 기준 로드. growthBq.criteriaView가 있으면 그 서빙 사본을, 없거나 비어 있으면 CS_CHECKLIST.
 * 뷰 컬럼: id, parent_name, name (, type, extra …)
 */
export async function loadCsChecklist(): Promise<CsCriterion[]> {
  if (_criteriaCache) return _criteriaCache;
  if (!growthBq.criteriaSql()) return CS_CHECKLIST;

  try {
    const rows = await servingQuery(`
      select id, parent_name as category, name as label, null::text as hint
      from qms_source_criteria
      order by parent_name collate "C", id
    `);
    const list = (rows as Record<string, unknown>[])
      .map((r) => ({
        id: Number(r.id),
        category: String(r.category ?? ""),
        label: String(r.label ?? ""),
        hint: String(r.hint ?? ""),
      }))
      .filter((c) => Number.isFinite(c.id) && c.label);
    if (!list.length) {
      console.warn("[csChecklist] 기준 사본이 비어 있음 — 하드코딩 폴백 사용");
      return CS_CHECKLIST;
    }
    _criteriaCache = list;
    return list;
  } catch (e) {
    console.warn(
      `[csChecklist] 기준 로드 실패 — 하드코딩 폴백: ${e instanceof Error ? e.message : String(e)}`,
    );
    return CS_CHECKLIST;
  }
}

/** 테스트·핫리로드용 캐시 초기화. */
export function clearCsChecklistCache(): void {
  _criteriaCache = null;
}

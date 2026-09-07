import { CS_CHECKLIST, type CsCriterion } from "./csChecklist";
import { DEFAULT_CRITERION_REVIEW_SCOPE, type CriterionReviewScope } from "./promptTypes";

/** UI 라벨 join용. promptConfig.criteria / CS_CHECKLIST 공통. */
export type CriterionLabelSource = Pick<CsCriterion, "id" | "label" | "category" | "reviewScope">;

/**
 * id → 메타. 하드코딩 CS_CHECKLIST를 베이스로 두고,
 * 평가셋 스냅샷(criteria)이 있으면 덮어쓴다(340 Best 후보 등 하드코딩에 없는 id 포함).
 */
export function buildCriterionMetaMap(
  criteria?: CriterionLabelSource[] | null,
): Map<number, CriterionLabelSource> {
  const m = new Map<number, CriterionLabelSource>();
  for (const c of CS_CHECKLIST)
    m.set(c.id, { id: c.id, label: c.label, category: c.category, reviewScope: c.reviewScope });
  for (const c of criteria ?? []) {
    if (!c || !Number.isFinite(c.id)) continue;
    m.set(c.id, {
      id: c.id,
      label: c.label || String(c.id),
      category: c.category ?? "",
      reviewScope: c.reviewScope,
    });
  }
  return m;
}

/** 표시용 항목 목록. 평가셋 스냅샷이 있으면 그걸, 없으면 CS_CHECKLIST. */
export function resolveCriterionOptions(
  criteria?: CriterionLabelSource[] | null,
): CriterionLabelSource[] {
  if (criteria?.length) {
    return criteria.map((c) => ({
      id: c.id,
      label: c.label || String(c.id),
      category: c.category ?? "",
      reviewScope: c.reviewScope,
    }));
  }
  return CS_CHECKLIST.map((c) => ({
    id: c.id,
    label: c.label,
    category: c.category,
    reviewScope: c.reviewScope,
  }));
}

export function resolveCriterionReviewScope(
  id: number,
  criteria?: CriterionLabelSource[] | null,
): CriterionReviewScope {
  return buildCriterionMetaMap(criteria).get(id)?.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE;
}

export function resolveCriterionLabel(
  id: number,
  criteria?: CriterionLabelSource[] | null,
): string {
  return buildCriterionMetaMap(criteria).get(id)?.label ?? `항목 ${id}`;
}

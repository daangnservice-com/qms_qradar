/** 수기 score_detail 한 줄 → 기준 id + 라벨. 형태: `라벨(id)` / `(카테고리) 라벨(id)` */
export interface HumanScoreItem {
  id: number;
  label: string;
  raw: string;
}

/**
 * score_detail 파싱.
 * - 줄바꿈 또는 연속 항목 분리
 * - 각 항목 끝의 `(숫자)` 가 evaluation criterion id
 */
export function parseScoreDetail(raw: unknown): HumanScoreItem[] {
  if (raw == null) return [];
  const text = String(raw).trim();
  if (!text) return [];

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const items: HumanScoreItem[] = [];
  const seen = new Set<number>();

  for (const line of lines) {
    const m = line.match(/^(.*)\((\d+)\)\s*$/);
    if (!m) continue;
    const id = Number(m[2]);
    if (!Number.isFinite(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      label: m[1].trim(),
      raw: line,
    });
  }
  return items;
}

export type CriterionCompareStatus = "tp" | "fp" | "fn" | "tn" | "human_only" | "ai_only";

export interface CriterionCompareRow {
  id: number;
  label: string;
  humanViolated: boolean;
  aiViolated: boolean | null;
  status: CriterionCompareStatus;
  aiReason?: string;
}

function lookupLabel(
  id: number,
  labelById?: Map<number, string> | Record<number, string>,
): string | undefined {
  if (!labelById) return undefined;
  if (labelById instanceof Map) return labelById.get(id);
  return labelById[id];
}

/** 수기 부적합 id 집합 vs AI checklist violated 비교 */
export function compareCriterionScores(input: {
  humanItems: HumanScoreItem[];
  aiChecklist: Array<{
    id: number;
    violated: boolean;
    reason?: string;
    label?: string;
    evidence?: Array<{ atSec: number; quote: string }>;
  }>;
  /** 수기/AI 결과에 라벨이 없을 때 쓰는 폴백 (AI 평가 항목 label 등) */
  labelById?: Map<number, string> | Record<number, string>;
}): {
  rows: CriterionCompareRow[];
  summary: { tp: number; fp: number; fn: number; tn: number };
} {
  const humanById = new Map(input.humanItems.map((h) => [h.id, h]));
  const aiById = new Map(input.aiChecklist.map((a) => [a.id, a]));
  const ids = new Set<number>([...humanById.keys(), ...aiById.keys()]);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const rows: CriterionCompareRow[] = [];

  for (const id of [...ids].sort((a, b) => a - b)) {
    const h = humanById.get(id);
    const a = aiById.get(id);
    const humanViolated = Boolean(h);
    const aiViolated = a ? Boolean(a.violated) : null;
    const label = h?.label || a?.label || lookupLabel(id, input.labelById) || String(id);

    let status: CriterionCompareStatus;
    if (a == null) {
      status = humanViolated ? "human_only" : "tn";
      if (humanViolated) fn += 1;
    } else if (humanViolated && aiViolated) {
      status = "tp";
      tp += 1;
    } else if (!humanViolated && aiViolated) {
      status = "fp";
      fp += 1;
    } else if (humanViolated && !aiViolated) {
      status = "fn";
      fn += 1;
    } else {
      status = "tn";
      tn += 1;
    }

    rows.push({
      id,
      label,
      humanViolated,
      aiViolated,
      status,
      aiReason: a?.reason,
    });
  }

  return { rows, summary: { tp, fp, fn, tn } };
}

/** 콜 결과(cold/hot) + 세부 부적합 항목 교집합 기반 일치 등급 */
export type MatchGrade =
  | "full" // 완전일치: 결과·세부 항목 모두 일치
  | "partial_items" // 항목 부분일치: 결과 일치 + 공통 항목 ≥1 + 차이 있음
  | "result_only" // 결과 일치·항목 미일치: 결과만 같고 공통 항목 0
  | "result_mismatch" // 결과 미일치
  | "unevaluated"; // QA 미평가

export const MATCH_GRADE_LABEL: Record<MatchGrade, string> = {
  full: "완전일치",
  partial_items: "항목 부분일치",
  result_only: "결과 일치·항목 미일치",
  result_mismatch: "결과 미일치",
  unevaluated: "미평가",
};

/**
 * humanViolated id 집합 vs AI violated id 집합.
 * - 결과(라벨) 불일치 → result_mismatch
 * - 결과 일치 + 집합 동일(둘 다 비어 포함) → full
 * - 결과 일치 + 교집합 ≥1 + 차집합 있음 → partial_items
 * - 결과 일치 + 교집합 0 (한쪽에라도 항목이 있거나 둘 다 비어있지 않은데 교집합 0) → result_only
 *   둘 다 비어 있으면 full 로 이미 처리됨.
 */
export function classifyMatchGrade(input: {
  humanResult: string | null | undefined;
  aiLabel: string | null | undefined;
  humanItemIds: number[];
  aiViolatedIds: number[];
  /** QA 결과 자체가 없으면 unevaluated */
  hasAiResult?: boolean;
}): MatchGrade {
  if (input.hasAiResult === false || input.aiLabel == null || String(input.aiLabel).trim() === "") {
    return "unevaluated";
  }

  const human = String(input.humanResult ?? "")
    .trim()
    .toLowerCase();
  const ai = String(input.aiLabel ?? "")
    .trim()
    .toLowerCase();
  if (!human || !ai || human !== ai) return "result_mismatch";

  const hSet = new Set(input.humanItemIds.filter((n) => Number.isFinite(n)));
  const aSet = new Set(input.aiViolatedIds.filter((n) => Number.isFinite(n)));

  let tp = 0;
  for (const id of hSet) if (aSet.has(id)) tp += 1;

  const onlyH = [...hSet].filter((id) => !aSet.has(id)).length;
  const onlyA = [...aSet].filter((id) => !hSet.has(id)).length;
  const identical = onlyH === 0 && onlyA === 0;

  if (identical) return "full";
  if (tp >= 1) return "partial_items";
  return "result_only";
}

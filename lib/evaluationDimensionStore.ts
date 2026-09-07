import { getBQ } from "./bigquery";
import { growthBq, promptBq } from "./bqRefs";
import type { ChecklistResult } from "./types";
import type { CsCriterion } from "./csChecklist";
import type { EvalCriterionBinding } from "./promptTypes";
import { cached } from "./serverCache";

/**
 * 평가 실행 결과에서 반복되던 기준 정의를 차원 테이블로 분리한다.
 *
 * - eval_set_criteria: 평가셋(version_id)과 기준/기준 프롬프트의 연결
 * - evaluation_criterion_results: 평가 실행 1건에서 기준별로 나온 판정
 *
 * BigQuery에는 FK 제약이 없으므로 id 연결은 애플리케이션에서 보장한다.
 * 기존 JSON 컬럼은 하위 호환을 위해 당분간 유지하고, 신규 데이터는 이 테이블에도 기록한다.
 */

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

const evalSetCriteriaTable = () =>
  getBQ().dataset(growthBq.dataset, { projectId: growthBq.projectId }).table(growthBq.evalSetCriteria);

const evalCriterionResultsTable = () =>
  getBQ().dataset(growthBq.dataset, { projectId: growthBq.projectId }).table(growthBq.evalCriterionResults);

const EVAL_SET_CRITERIA_SCHEMA = [
  { name: "eval_set_id", type: "STRING", mode: "REQUIRED" },
  { name: "criterion_id", type: "INTEGER", mode: "REQUIRED" },
  { name: "criterion_prompt_id", type: "STRING", mode: "NULLABLE" },
  { name: "sort_order", type: "INTEGER", mode: "NULLABLE" },
  { name: "enabled", type: "BOOLEAN", mode: "REQUIRED" },
  { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

const EVAL_CRITERION_RESULTS_SCHEMA = [
  { name: "analysis_id", type: "STRING", mode: "REQUIRED" },
  { name: "eval_set_id", type: "STRING", mode: "NULLABLE" },
  { name: "criterion_id", type: "INTEGER", mode: "REQUIRED" },
  { name: "criterion_prompt_id", type: "STRING", mode: "NULLABLE" },
  { name: "violated", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "reason", type: "STRING", mode: "NULLABLE" },
  { name: "evidence_json", type: "STRING", mode: "NULLABLE" },
  { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 ||
  /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureEvaluationDimensionTables(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const bq = getBQ();
      const ds = bq.dataset(growthBq.dataset, { projectId: growthBq.projectId });
      const [dsExists] = await ds.exists();
      if (!dsExists) {
        await ds.create({ location: growthBq.location ?? "US" }).catch((e) => {
          if (!isAlreadyExists(e)) throw e;
        });
      }

      for (const [name, schema] of [
        [growthBq.evalSetCriteria, EVAL_SET_CRITERIA_SCHEMA],
        [growthBq.evalCriterionResults, EVAL_CRITERION_RESULTS_SCHEMA],
      ] as const) {
        const table = ds.table(name);
        const [exists] = await table.exists();
        if (!exists) {
          await table
            .create({ schema: schema as unknown as { name: string; type: string; mode: string }[] })
            .catch((e) => {
              if (!isAlreadyExists(e)) throw e;
            });
        }
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

export async function syncEvalSetCriteria(input: {
  evalSetId: string;
  bindings: EvalCriterionBinding[];
}): Promise<void> {
  const evalSetId = input.evalSetId.trim();
  if (!evalSetId) return;
  await ensureEvaluationDimensionTables();

  const bindings = input.bindings.filter((b) => Number.isFinite(b.criterionId));
  if (!bindings.length) return;

  // 평가셋 version_id는 immutable하지만 재시도 시 중복을 만들지 않도록 교체한다.
  await getBQ().query({
    query: `
      delete from ${growthBq.resultsSql(growthBq.evalSetCriteria)}
      where eval_set_id = @eval_set_id
    `,
    params: { eval_set_id: evalSetId },
    ...loc(),
  });

  const createdAt = new Date().toISOString();
  await evalSetCriteriaTable().insert(
    bindings.map((b, index) => ({
      eval_set_id: evalSetId,
      criterion_id: b.criterionId,
      criterion_prompt_id: b.promptId?.trim() || null,
      sort_order: index + 1,
      enabled: b.enabled !== false,
      created_at: createdAt,
    })),
    { skipInvalidRows: false, ignoreUnknownValues: false },
  );
}

export async function saveEvaluationCriterionResults(input: {
  analysisId: string;
  evalSetId?: string | null;
  bindings?: EvalCriterionBinding[];
  checklist: ChecklistResult[];
  createdAt: string;
}): Promise<void> {
  if (!input.analysisId.trim() || !input.checklist.length) return;
  await ensureEvaluationDimensionTables();

  const promptIdByCriterion = new Map(
    (input.bindings ?? []).map((b) => [b.criterionId, b.promptId?.trim() || null]),
  );
  await evalCriterionResultsTable().insert(
    input.checklist.map((c) => ({
      analysis_id: input.analysisId,
      eval_set_id: input.evalSetId?.trim() || null,
      criterion_id: c.id,
      criterion_prompt_id: promptIdByCriterion.get(c.id) ?? null,
      violated: c.violated,
      reason: c.reason ?? null,
      evidence_json: JSON.stringify(c.evidence ?? []),
      created_at: input.createdAt,
    })),
    { skipInvalidRows: false, ignoreUnknownValues: false },
  );
}

export async function loadEvaluationCriterionResults(analysisId: string): Promise<ChecklistResult[] | null> {
  const id = analysisId.trim();
  if (!id) return null;

  try {
    const [rows] = await getBQ().query({
      query: `
        select criterion_id, violated, reason, evidence_json
        from ${growthBq.resultsSql(growthBq.evalCriterionResults)}
        where analysis_id = @analysis_id
        order by criterion_id
      `,
      params: { analysis_id: id },
      ...loc(),
    });
    if (!rows.length) return null;

    return (rows as Record<string, unknown>[]).map((r) => {
      let evidence: ChecklistResult["evidence"] = [];
      try {
        const parsed = JSON.parse(String(r.evidence_json ?? "[]")) as ChecklistResult["evidence"];
        if (Array.isArray(parsed)) evidence = parsed;
      } catch {
        evidence = [];
      }
      return {
        id: Number(r.criterion_id),
        violated: Boolean(r.violated),
        reason: String(r.reason ?? ""),
        evidence,
      };
    });
  } catch (e) {
    console.warn("[evaluationDimensionStore] load criterion results fallback:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 정규화된 평가셋 연결에서 당시 사용한 기준 프롬프트를 복원한다.
 * 테이블이 아직 없거나 과거 평가셋이면 null을 반환해 기존 criteria_json 경로를 사용한다.
 */
export function loadEvalSetCriteria(evalSetId: string): Promise<CsCriterion[] | null> {
  const id = evalSetId.trim();
  if (!id) return Promise.resolve(null);
  return cached(`eval-set-criteria:${id}`, 5 * 60 * 1000, () => loadEvalSetCriteriaUncached(id));
}

async function loadEvalSetCriteriaUncached(id: string): Promise<CsCriterion[] | null> {
  try {
    const [rows] = await getBQ().query({
      query: `
        select
          esc.criterion_id,
          esc.sort_order,
          coalesce(selected_cp.category, latest_cp.category) as category,
          coalesce(selected_cp.label, latest_cp.label) as label,
          coalesce(selected_cp.fields_json, latest_cp.fields_json) as fields_json
        from ${growthBq.resultsSql(growthBq.evalSetCriteria)} esc
        left join ${promptBq.sql(promptBq.tables.criterionPrompts)} selected_cp
          on selected_cp.prompt_id = esc.criterion_prompt_id
        left join (
          select prompt_id, criterion_id, category, label, fields_json
          from ${promptBq.sql(promptBq.tables.criterionPrompts)}
          qualify row_number() over (partition by criterion_id order by updated_at desc) = 1
        ) latest_cp
          on esc.criterion_prompt_id is null
         and latest_cp.criterion_id = esc.criterion_id
        where esc.eval_set_id = @eval_set_id
          and esc.enabled = true
        qualify row_number() over (
          partition by esc.criterion_id
          order by esc.sort_order
        ) = 1
        order by esc.sort_order, esc.criterion_id
      `,
      params: { eval_set_id: id },
      ...loc(),
    });
    if (!rows.length) return null;

    return (rows as Record<string, unknown>[]).map((r) => {
      let fields: Record<string, string> = {};
      try {
        const parsed = JSON.parse(String(r.fields_json ?? "{}")) as Record<string, unknown>;
        fields = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
      } catch {
        fields = {};
      }
      const hint = fields.definition ?? "";
      return {
        id: Number(r.criterion_id),
        category: String(r.category ?? ""),
        label: String(r.label ?? "") || `평가 ${String(r.criterion_id)}`,
        hint,
        fields,
      };
    });
  } catch (e) {
    // 신규 테이블이 배포되지 않은 환경/legacy 결과는 기존 경로로 복구한다.
    console.warn("[evaluationDimensionStore] load eval-set criteria fallback:", e instanceof Error ? e.message : e);
    return null;
  }
}

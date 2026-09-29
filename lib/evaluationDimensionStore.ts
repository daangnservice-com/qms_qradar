import { getBQ } from "./bigquery";
import { growthBq, promptBq } from "./bqRefs";
import type { ChecklistResult } from "./types";
import type { CsCriterion } from "./csChecklist";
import type { EvalCriterionBinding } from "./promptTypes";
import { cached, cacheInvalidate } from "./serverCache";
import { servingQuery, withServingTx } from "./servingDb";

/**
 * 평가 실행 결과에서 반복되던 기준 정의를 차원 테이블로 분리한다.
 *
 * - eval_set_criteria: 평가셋(version_id)과 기준/기준 프롬프트의 연결
 * - evaluation_criterion_results: 평가 실행 1건에서 기준별로 나온 판정
 *
 * 평가셋 연결의 원천은 서빙 Postgres(serving_eval_sets)이고 BQ 로는 야간 덤프가 내보낸다.
 * 기준별 판정 테이블은 더 쓰지 않는다. 결과 JSON 에 체크리스트가 없는 옛 결과만 BQ 에서 읽는다.
 */

const loc = () => (growthBq.location ? { location: growthBq.location } : {});

export async function syncEvalSetCriteria(input: {
  evalSetId: string;
  bindings: EvalCriterionBinding[];
}): Promise<void> {
  const evalSetId = input.evalSetId.trim();
  if (!evalSetId) return;

  const bindings = input.bindings.filter((b) => Number.isFinite(b.criterionId));
  await withServingTx(async (client) => {
    await client.query(`delete from serving_eval_sets where eval_set_id = $1`, [evalSetId]);
    // 연결을 전부 지우면 exported_at 으로 남는 행이 없어 덤프가 BQ 쪽 삭제를 모른다.
    await client.query(
      `
      insert into serving_export_dirty (kind, key) values ('eval_set', $1)
      on conflict (kind, key) do update set marked_at = now()
      `,
      [evalSetId],
    );
    for (let i = 0; i < bindings.length; i++) {
      const b = bindings[i];
      await client.query(
        `
        insert into serving_eval_sets
          (eval_set_id, criterion_id, criterion_prompt_id, sort_order, enabled, created_at, exported_at)
        values ($1, $2, $3, $4, $5, now(), null)
        `,
        [evalSetId, b.criterionId, b.promptId?.trim() || null, i + 1, b.enabled !== false],
      );
    }
  });
  cacheInvalidate(`eval-set-criteria:${evalSetId}`);
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
    const links = await servingQuery<{
      criterion_id: number;
      criterion_prompt_id: string | null;
    }>(
      `
      select criterion_id, criterion_prompt_id
      from serving_eval_sets
      where eval_set_id = $1 and enabled
      order by sort_order, criterion_id
      `,
      [id],
    );
    if (!links.length) return null;
    const promptIds = [...new Set(links.map((r) => r.criterion_prompt_id).filter((v): v is string => Boolean(v)))];
    const prompts = new Map<string, { category: string; label: string; fields_json: string }>();
    if (promptIds.length) {
      const rows = await servingQuery<Record<string, unknown>>(
        `
          select prompt_id, category, label, fields_json
          from ${promptBq.tables.criterionPrompts}
          where prompt_id = any($1::text[])
        `,
        [promptIds],
      );
      for (const r of rows) {
        prompts.set(String(r.prompt_id), {
          category: String(r.category ?? ""),
          label: String(r.label ?? ""),
          fields_json: String(r.fields_json ?? "{}"),
        });
      }
    }
    return links.map((link) => {
      const prompt = link.criterion_prompt_id ? prompts.get(link.criterion_prompt_id) : undefined;
      let fields: Record<string, string> = {};
      try {
        const parsed = JSON.parse(prompt?.fields_json ?? "{}") as Record<string, unknown>;
        fields = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
      } catch {
        fields = {};
      }
      const hint = fields.definition ?? "";
      return {
        id: Number(link.criterion_id),
        category: prompt?.category ?? "",
        label: prompt?.label || `평가 ${String(link.criterion_id)}`,
        hint,
        fields,
      };
    });
  } catch (e) {
    console.warn("[evaluationDimensionStore] load eval-set criteria fallback:", e instanceof Error ? e.message : e);
    return null;
  }
}

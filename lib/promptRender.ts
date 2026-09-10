import type { CsCriterion } from "./csChecklist";
import type { OutputSchemaConfig, PromptFieldKey } from "./promptTypes";
import { DEFAULT_FIELD_KEYS, DEFAULT_OUTPUT_SCHEMA_CONFIG } from "./promptTypes";
import { outputSchemaPromptVars } from "./outputSchema";

/** `{{name}}` 치환. 없는 키는 빈 문자열. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function formatCriteriaList(
  criteria: CsCriterion[],
  fieldKeys: PromptFieldKey[] = DEFAULT_FIELD_KEYS,
): string {
  const keys = fieldKeys.filter((f) => f.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
  return criteria
    .map((c) => {
      const fields = c.fields ?? (c.hint ? { definition: c.hint } : {});
      const lines = keys
        .map((k) => {
          const v = fields[k.key]?.trim();
          return v ? `     └ ${k.label}: ${v}` : null;
        })
        .filter(Boolean);
      if (!lines.length && c.hint) lines.push(`     └ 판단기준: ${c.hint}`);
      return [`[${c.id}] (${c.category}) ${c.label}`, ...lines].join("\n");
    })
    .join("\n");
}

export function buildChecklistBlock(
  checklistTemplate: string,
  criteria: CsCriterion[],
  fieldKeys?: PromptFieldKey[],
): string {
  if (!checklistTemplate.trim() || criteria.length === 0) return "";
  return renderTemplate(checklistTemplate, {
    criteria_count: String(criteria.length),
    criteria_list: formatCriteriaList(criteria, fieldKeys),
  });
}

/** 평가셋 미리보기용 — STT/공백은 플레이스홀더로 두고 체크리스트는 실제 반영 */
export function previewFinalPrompt(input: {
  basePrompt: string;
  checklistTemplate: string;
  criteria: CsCriterion[];
  useChecklist: boolean;
  fieldKeys?: PromptFieldKey[];
  outputSchemaConfig?: OutputSchemaConfig;
}): string {
  const checklistBlock =
    input.useChecklist && input.criteria.length
      ? buildChecklistBlock(input.checklistTemplate, input.criteria, input.fieldKeys)
      : "";
  const schemaVars = outputSchemaPromptVars(input.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG);
  return renderTemplate(input.basePrompt, {
    silences: "[미리보기: 공백 구간]",
    silence_summary: "[미리보기: 공백 요약]",
    stt_script: "[미리보기: STT 스크립트]",
    overlaps: "[미리보기: 말 겹침 구간]",
    conversation_text: "[미리보기: 고객 문의·상담사 답변 원문]",
    checklist_block: checklistBlock ? `\n${checklistBlock}` : "",
    score_items: schemaVars.score_items,
    overall_fields: schemaVars.overall_fields,
  }).trim();
}

export function parseCriteriaJson(raw: string): CsCriterion[] {
  const arr = JSON.parse(raw) as unknown;
  if (!Array.isArray(arr)) throw new Error("criteria_json은 배열이어야 합니다");
  return arr.map((c, i) => {
    const o = c as Record<string, unknown>;
    const id = Number(o.id);
    if (!Number.isFinite(id)) throw new Error(`criteria[${i}].id 가 숫자가 아닙니다`);
    let fields: Record<string, string> | undefined;
    if (o.fields && typeof o.fields === "object" && !Array.isArray(o.fields)) {
      fields = Object.fromEntries(
        Object.entries(o.fields as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
      );
    }
    const hint = String(o.hint ?? fields?.definition ?? "");
    return {
      id,
      category: String(o.category ?? ""),
      label: String(o.label ?? ""),
      hint,
      fields: fields ?? (hint ? { definition: hint } : {}),
      reviewScope: o.reviewScope === "conversation" ? "conversation" : o.reviewScope === "occurrence" ? "occurrence" : undefined,
    };
  });
}

export function parseSchemaJson(raw: string): object {
  const o = JSON.parse(raw) as unknown;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("response_schema_json은 객체여야 합니다");
  return o as object;
}

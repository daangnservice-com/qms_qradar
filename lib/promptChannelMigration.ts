import { createHash } from 'node:crypto';
import { feedbackFields, FEEDBACK_DISABLED_CRITERIA, FEEDBACK_FIRST_PASS_GUIDANCE, FEEDBACK_CHECKLIST_TEMPLATE } from './feedbackPromptDraft';
import { parseCriteriaJson } from './promptRender';
import type { CriterionPrompt, EvalCriterionBinding } from './promptTypes';

export const CHANNEL_MIGRATION = 'feedback-channels-v1-20260916';
export type MigrationRow = Record<string, any>;
export const migrationId = (kind: string, ...parts: string[]) => `${CHANNEL_MIGRATION}-${kind}-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20)}`;

export function legacyBindings(v: MigrationRow): EvalCriterionBinding[] {
  const bindings = JSON.parse(v.criterion_bindings_json || 'null');
  if (Array.isArray(bindings)) return bindings.map((b) => ({ criterionId: Number(b.criterionId), promptId: String(b.promptId ?? ''), enabled: b.enabled !== false }));
  const selected = JSON.parse(v.selected_criterion_ids || '[]');
  const ids = selected.length ? selected : parseCriteriaJson(v.criteria_json || '[]').map((c) => c.id);
  return ids.map((id: number) => ({ criterionId: id, promptId: '', enabled: true }));
}

/** Freeze the old normalized loader's effective prompt before inserting newer details. */
export function legacySnapshot(v: MigrationRow, prompts: MigrationRow[], links: MigrationRow[]) {
  const normalized = links.filter((r) => r.eval_set_id === v.version_id && r.enabled).sort((a, b) => a.sort_order - b.sort_order);
  const seen = new Set<number>();
  const criteria = normalized.length ? normalized.filter((r) => {
    if (seen.has(r.criterion_id)) return false;
    seen.add(r.criterion_id); return true;
  }).map((r) => {
    const p = r.criterion_prompt_id == null
      ? prompts.filter((p) => p.criterion_id === r.criterion_id).sort((a, b) => String(b.updated_at?.value ?? b.updated_at).localeCompare(String(a.updated_at?.value ?? a.updated_at)))[0]
      : prompts.find((p) => p.prompt_id === r.criterion_prompt_id);
    const fields = JSON.parse(p?.fields_json || '{}');
    return { id: Number(r.criterion_id), category: p?.category ?? '', label: p?.label || `평가 ${r.criterion_id}`, hint: fields.definition ?? '', fields };
  }) : parseCriteriaJson(v.criteria_json || '[]');
  if (v.use_checklist && (!criteria.length || criteria.every((c) => !(c.fields?.definition?.trim() || c.hint?.trim())))) {
    throw new Error(`기존 weak snapshot은 별도 확인 필요: ${v.version_id}`);
  }
  return { templateKey: v.template_key, bindings: legacyBindings(v), criteria };
}

export function buildFeedbackMigrationPlan(versions: MigrationRow[], prompts: MigrationRow[], links: MigrationRow[]) {
  const production = (key: string) => {
    const rows = versions.filter((v) => v.template_key === key && v.status === 'production');
    if (rows.length !== 1) throw new Error(`${key}: production 한 개가 필요합니다 (${rows.length})`);
    return rows[0];
  };
  const feedback = production('feedback_eval');
  const phone = production('call_eval_growth');
  const phoneBindings = legacyBindings(phone);
  const bindings = legacyBindings(feedback);
  const snapshots = versions.filter((v) => v.status === 'production').map((v) => ({ id: v.version_id, json: JSON.stringify(legacySnapshot(v, prompts, links)) }));
  const details: MigrationRow[] = [];
  const criteria = [];
  for (const b of bindings) {
    if (!b.enabled || FEEDBACK_DISABLED_CRITERIA.includes(b.criterionId as typeof FEEDBACK_DISABLED_CRITERIA[number])) {
      b.enabled = false;
      b.promptId = '';
      continue;
    }
    const sourceId = phoneBindings.find((p) => p.criterionId === b.criterionId && p.enabled)?.promptId || b.promptId;
    const source = prompts.find((p) => p.prompt_id === sourceId && p.criterion_id === b.criterionId);
    if (!source) throw new Error(`원본 상세가 없는 활성 항목 ${b.criterionId}`);
    const fields = feedbackFields({ criterionId: b.criterionId, fields: JSON.parse(source.fields_json || '{}') } as CriterionPrompt);
    const id = migrationId('item', feedback.version_id, phone.version_id, String(b.criterionId), sourceId);
    const label = `${CHANNEL_MIGRATION}-${b.criterionId}`;
    details.push({ ...source, prompt_id: id, version_label: label, fields_json: JSON.stringify(fields), exposure_channels_json: '["feedback"]', updated_by: CHANNEL_MIGRATION });
    b.promptId = id;
    criteria.push({ id: b.criterionId, category: source.category, label: source.label, hint: fields.definition ?? '', fields, reviewScope: source.review_scope || 'occurrence' });
  }
  const draft: MigrationRow = {
    ...feedback,
    version_id: migrationId('set', feedback.version_id, phone.version_id),
    version_label: `260916_ver1_${CHANNEL_MIGRATION}`,
    status: 'draft',
    base_prompt: `${feedback.base_prompt}\n\n${FEEDBACK_FIRST_PASS_GUIDANCE}`,
    checklist_template: FEEDBACK_CHECKLIST_TEMPLATE,
    criteria_json: JSON.stringify(criteria),
    criterion_bindings_json: JSON.stringify(bindings),
    selected_criterion_ids: JSON.stringify(bindings.filter((b) => b.enabled).map((b) => b.criterionId)),
    change_note: `${CHANNEL_MIGRATION}; feedback source=${feedback.version_id}; phone detail source=${phone.version_id}; disabled=413,416,547,548; no promotion`,
    created_by: CHANNEL_MIGRATION,
    legacy_channel_snapshot_json: null,
  };
  return { draft, details, bindings, snapshots, sourceFeedbackId: feedback.version_id, sourcePhoneId: phone.version_id };
}

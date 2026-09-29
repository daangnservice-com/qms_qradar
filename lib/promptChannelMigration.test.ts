import { describe, it, expect } from 'vitest';
import { buildFeedbackMigrationPlan, legacySnapshot, type MigrationRow } from './promptChannelMigration';
import { FEEDBACK_FIRST_PASS_GUIDANCE, feedbackFields } from './feedbackPromptDraft';
import { previewFinalPrompt } from './promptRender';
import { defaultPromptSeed } from './promptDefaults';
import { parseEvaluation } from './gemini';

const ids = [415, 545, 413, 416, 547, 548];
const prompts = ids.map((id) => ({ prompt_id: `p-${id}`, criterion_id: id, category: '공통분류', label: `항목${id}`, fields_json: JSON.stringify({ definition: '원문 정의', good: '정중한 표현', bad: '반말 / \n들릴 정도로 크게 내쉬는 의도적 한숨', exception: '', custom: '추가 동적 필드' }), updated_at: '2026-09-01' }));
const bindings = ids.map((id) => ({ criterionId: id, promptId: `p-${id}`, enabled: true }));
const version = (key: string): MigrationRow => ({
  version_id: key, template_key: key, status: 'production',
  base_prompt: '{{conversation_text}}\n{{checklist_block}}', checklist_template: '{{criteria_list}}',
  criterion_bindings_json: JSON.stringify(bindings), criteria_json: JSON.stringify([{ id: 415, category: '공통분류', label: '415', hint: '원문 정의', fields: { definition: '원문 정의' } }]),
  response_schema_json: defaultPromptSeed('feedback_eval').responseSchemaJson,
  result_parse_config_json: JSON.stringify(defaultPromptSeed('feedback_eval').resultParseConfig),
  output_schema_config_json: JSON.stringify(defaultPromptSeed('feedback_eval').outputSchemaConfig), use_checklist: true,
});

describe('feedback migration plan', () => {
  it('is deterministic, immutable, preserves schema/parser and excludes inactive criteria', () => {
    const versions = [version('call_eval_growth'), version('feedback_eval')];
    const before = JSON.stringify({ versions, prompts });
    const first = buildFeedbackMigrationPlan(versions, prompts, []);
    const second = buildFeedbackMigrationPlan(versions, prompts, []);
    expect(second).toEqual(first);
    expect(JSON.stringify({ versions, prompts })).toBe(before);
    expect(first.draft.status).toBe('draft');
    expect(first.draft.response_schema_json).toBe(versions[1].response_schema_json);
    expect(first.draft.result_parse_config_json).toBe(versions[1].result_parse_config_json);
    expect(first.bindings.filter((b) => !b.enabled).map((b) => b.criterionId)).toEqual([413, 416, 547, 548]);
    expect(JSON.parse(first.draft.criteria_json).map((c: any) => c.id)).toEqual([415, 545]);
    expect(first.details.every((d) => d.exposure_channels_json === '["feedback"]')).toBe(true);
    expect(first.details.every((d) => JSON.parse(d.fields_json).custom === '추가 동적 필드')).toBe(true);
    const rendered = previewFinalPrompt({ basePrompt: first.draft.base_prompt, checklistTemplate: first.draft.checklist_template, criteria: JSON.parse(first.draft.criteria_json), useChecklist: true });
    expect(rendered).toContain(FEEDBACK_FIRST_PASS_GUIDANCE);
    expect(rendered).toContain('활성 2개');
    expect(rendered).not.toContain('들릴 정도');
    expect(rendered).not.toContain('[413]');
  });
  it('freezes legacy unbound normalized definitions before new channel versions exist', () => {
    const old = legacySnapshot(version('feedback_eval'), prompts, [{ eval_set_id: 'feedback_eval', criterion_id: 415, enabled: true, criterion_prompt_id: null, sort_order: 1 }]);
    expect(old.criteria[0].fields?.definition).toBe('원문 정의');
    const updated = [...prompts, { ...prompts[0], fields_json: '{"definition":"new"}', updated_at: '2026-09-16' }];
    expect(legacySnapshot(version('feedback_eval'), updated, []).criteria[0].hint).toBe('원문 정의');
    expect(old.criteria[0].fields?.definition).toBe('원문 정의');
  });
  it('does not redefine voice-only or policy-disabled items', () => {
    for (const id of [413, 416, 547, 548]) expect(() => feedbackFields({ criterionId: id, fields: {} } as any)).toThrow();
  });
  it('preserves boolean violated parsing independently of the overall score', () => {
    const result = parseEvaluation(JSON.stringify({ scores: { attitude: { score: 5, comment: '좋음' } }, overallSummary: '좋은 상담', csChecklist: [{ id: 415, violated: true, reason: '원문 후보', evidence: [] }] }));
    expect(result.csChecklist.some((c) => c.violated)).toBe(true);
    expect(result.csChecklist[0]).not.toHaveProperty('status');
  });
});

/** Read-only verification through the application's actual prompt loader. No evaluation/LLM calls. */
import assert from 'node:assert/strict';
import { getBQ } from '../lib/bigquery';
import { promptBq, growthBq } from '../lib/bqRefs';
import { getProductionPrompt, getPromptConfigByVersionId } from '../lib/promptStore';
import { buildFeedbackMigrationPlan, legacySnapshot } from '../lib/promptChannelMigration';
import { previewFinalPrompt } from '../lib/promptRender';
import { buildTextEvaluationPrompt } from '../lib/gemini';
import { FEEDBACK_FIRST_PASS_GUIDANCE } from '../lib/feedbackPromptDraft';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main() {
  const suffix = '_backup_channels_20260916_v1';
  const read = async (table: string) => (await getBQ().query({ query: `SELECT * FROM ${promptBq.sql(table + suffix)}`, location: promptBq.location }))[0];
  const [versions, prompts, links] = await Promise.all([read(promptBq.tables.versions), read(promptBq.tables.criterionPrompts), read(growthBq.evalSetCriteria)]);
  const plan = buildFeedbackMigrationPlan(versions, prompts, links);
  for (const old of versions.filter((v) => v.status === 'production')) {
    const current = await getProductionPrompt(old.template_key, { ensure: false });
    const frozen = legacySnapshot(old, prompts, links);
    assert.equal(current.version.versionId, old.version_id);
    assert.equal(current.version.basePrompt, old.base_prompt ?? '');
    assert.equal(current.version.responseSchemaJson, old.response_schema_json);
    assert.deepEqual(current.version.criterionBindings, frozen.bindings);
    const preview = previewFinalPrompt({ ...current.version, criteria: current.criteria });
    const before = previewFinalPrompt({ ...current.version, basePrompt: old.base_prompt ?? '', checklistTemplate: old.checklist_template ?? '', criteria: frozen.criteria });
    assert.equal(preview, before);
    console.log(JSON.stringify({ production: old.template_key, versionId: old.version_id, renderedPromptUnchanged: true, count: current.criteria.length }));
  }
  const draft = await getPromptConfigByVersionId(plan.draft.version_id, { ensure: false });
  assert.ok(draft);
  assert.equal(draft.version.status, 'draft');
  assert.deepEqual(draft.version.criterionBindings, plan.bindings);
  assert.deepEqual(draft.criteria, JSON.parse(plan.draft.criteria_json));
  const rendered = buildTextEvaluationPrompt([{ turnId: 'fixture', speaker: 'customer', speakerLabel: '고객', text: '합성 테스트 문의', atSec: 0 }], true, draft.criteria, draft);
  assert.ok(rendered.includes(FEEDBACK_FIRST_PASS_GUIDANCE));
  assert.ok(rendered.includes('활성 20개'));
  assert.ok(!rendered.includes('[413]'));
  // Shared master labels can mention audio; only channel detail fields are tested here.
  const detailText = draft.criteria.flatMap((c) => Object.values(c.fields ?? {})).join('\n');
  assert.ok(!/STT|원음|스피커폰|여보세요|한숨|음성|통화가 끊|\d+초.*대기|\d+분.*대기/.test(detailText));
  writeFileSync(join(tmpdir(), 'qradar-prompt-channels', 'runtime-draft-preview.txt'), rendered);
  console.log(JSON.stringify({ draftId: draft.version.versionId, runtimeVerified: true, activeCount: draft.criteria.length, llmCalls: 0 }));
}
main().catch((e) => { console.error(JSON.stringify({ code: e.code, message: e.message })); process.exitCode = 1; });

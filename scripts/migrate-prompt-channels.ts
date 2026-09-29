/** Read/plan by default. --apply performs additive DDL + one atomic metadata/draft transaction.
 * Uses existing Next env + getBQ auth via: node scripts/run-local-ts.cjs scripts/migrate-prompt-channels.ts [--apply]
 * No LLM calls, consultation reads, production promotion, or production content updates.
 */
import assert from 'node:assert/strict';
import { getBQ } from '../lib/bigquery';
import { promptBq, growthBq } from '../lib/bqRefs';
import { buildFeedbackMigrationPlan, CHANNEL_MIGRATION, type MigrationRow } from '../lib/promptChannelMigration';
import { readExposureChannels, validateChannelBindings } from '../lib/criterionChannels';
import { previewFinalPrompt } from '../lib/promptRender';
import { FEEDBACK_FIRST_PASS_GUIDANCE } from '../lib/feedbackPromptDraft';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const suffix = '_backup_channels_20260916_v1';
const refs = {
  versions: promptBq.tables.versions,
  prompts: promptBq.tables.criterionPrompts,
  links: growthBq.evalSetCriteria,
};
const sql = (name: string) => promptBq.sql(name);
const bq = getBQ();
const query = async (query: string, params?: Record<string, any>) => (await bq.query({ query, params, location: promptBq.location }))[0] as MigrationRow[];
const stable = (row: MigrationRow, omit: string[] = []) => JSON.stringify(Object.fromEntries(Object.keys(row).filter((k) => !omit.includes(k)).sort().map((k) => [k, row[k]])));

async function main() {
  assert.equal(promptBq.projectId, growthBq.projectId, '정규화 테이블 프로젝트 확인 필요');
  assert.equal(promptBq.dataset, growthBq.dataset, '정규화 테이블 데이터셋 확인 필요');
  console.log(JSON.stringify({ stage: 'target', project: promptBq.projectId, dataset: promptBq.dataset, location: promptBq.location, apply: process.argv.includes('--apply') }));
  const [metadata] = await bq.dataset(promptBq.dataset, { projectId: promptBq.projectId }).getMetadata();
  assert.equal(metadata.location.toLowerCase(), promptBq.location.toLowerCase(), '설정 location 불일치');
  // Refuse partial backups; each table name derives from the actual configured reference.
  const backupExists = await Promise.all(Object.values(refs).map(async (name) => (await bq.dataset(promptBq.dataset, { projectId: promptBq.projectId }).table(name + suffix).exists())[0]));
  const useBackup = backupExists.every(Boolean);
  if (backupExists.some(Boolean) && !useBackup) throw new Error('부분 백업 상태입니다. 수동 확인 필요');
  const load = (name: string) => query(`SELECT * FROM ${sql(name + (useBackup ? suffix : ''))}`);
  const [versions, prompts, links] = await Promise.all([load(refs.versions), load(refs.prompts), load(refs.links)]);
  const plan = buildFeedbackMigrationPlan(versions, prompts, links);
  const report = { migration: CHANNEL_MIGRATION, project: promptBq.projectId, dataset: promptBq.dataset, location: promptBq.location,
    sourceFeedbackId: plan.sourceFeedbackId, sourcePhoneId: plan.sourcePhoneId,
    draftId: plan.draft.version_id, itemVersions: plan.details.map((d) => ({ criterionId: d.criterion_id, promptId: d.prompt_id, versionLabel: d.version_label })),
    disabledIds: plan.bindings.filter((b) => !b.enabled).map((b) => b.criterionId), activeCount: plan.details.length,
    backupTables: Object.values(refs).map((t) => promptBq.fq(t + suffix)),
  };
  console.log(JSON.stringify({ stage: 'plan', ...report }));
  if (!process.argv.includes('--apply')) return;
  if (!useBackup) {
    // Single query captures all backups at a common timestamp. Backups retain original schemas.
    await query(`DECLARE snapshot_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP();\n${Object.values(refs).map((name) => `CREATE TABLE ${sql(name + suffix)} OPTIONS (expiration_timestamp = NULL) AS SELECT * FROM ${sql(name)} FOR SYSTEM_TIME AS OF snapshot_at;`).join('\n')}`);
  }
  await query(`ALTER TABLE ${sql(refs.prompts)} ADD COLUMN IF NOT EXISTS exposure_channels_json STRING;\nALTER TABLE ${sql(refs.versions)} ADD COLUMN IF NOT EXISTS legacy_channel_snapshot_json STRING;`);
  const detailColumns = ['prompt_id', 'criterion_id', 'version_label', 'category', 'label', 'fields_json', 'review_scope', 'exposure_channels_json', 'updated_by'];
  const versionColumns = ['version_id', 'template_key', 'version_label', 'status', 'base_prompt', 'checklist_template', 'response_schema_json', 'criteria_json', 'selected_criterion_ids', 'criterion_bindings_json', 'output_schema_config_json', 'result_parse_config_json', 'audio_pipeline_config_json', 'use_checklist', 'change_note', 'created_by'];
  const extract = (columns: string[], variable: string) => columns.map((c) => {
    const value = `JSON_VALUE(${variable}, '$.${c}')`;
    return c === 'criterion_id' ? `CAST(${value} AS INT64)` : c === 'use_checklist' ? `CAST(${value} AS BOOL)` : value;
  }).join(', ');
  await query(`
    BEGIN TRANSACTION;
    ASSERT (SELECT COUNT(*) FROM ${sql(refs.versions)} WHERE status = 'production' AND template_key = 'feedback_eval' AND version_id = @feedback_id) = 1 AS 'feedback production changed';
    ASSERT (SELECT COUNT(*) FROM ${sql(refs.versions)} WHERE status = 'production' AND template_key = 'call_eval_growth' AND version_id = @phone_id) = 1 AS 'phone production changed';
    UPDATE ${sql(refs.prompts)} SET exposure_channels_json = @phone_channels WHERE exposure_channels_json IS NULL;
    UPDATE ${sql(refs.versions)} v SET legacy_channel_snapshot_json = JSON_VALUE(s, '$.json')
      FROM UNNEST(JSON_QUERY_ARRAY(@snapshots)) s WHERE v.version_id = JSON_VALUE(s, '$.id') AND v.legacy_channel_snapshot_json IS NULL;
    INSERT INTO ${sql(refs.prompts)} (${detailColumns.join(', ')}, updated_at)
      SELECT ${extract(detailColumns, 'p')}, CURRENT_TIMESTAMP() FROM UNNEST(JSON_QUERY_ARRAY(@details)) p
      WHERE NOT EXISTS (SELECT 1 FROM ${sql(refs.prompts)} existing WHERE existing.prompt_id = JSON_VALUE(p, '$.prompt_id'));
    INSERT INTO ${sql(refs.versions)} (${versionColumns.join(', ')}, created_at)
      SELECT ${extract(versionColumns, '@draft')}, CURRENT_TIMESTAMP() FROM UNNEST([@draft])
      WHERE NOT EXISTS (SELECT 1 FROM ${sql(refs.versions)} WHERE version_id = @draft_id);
    INSERT INTO ${sql(refs.links)} (eval_set_id, criterion_id, criterion_prompt_id, sort_order, enabled, created_at)
      SELECT @draft_id, CAST(JSON_VALUE(b, '$.criterionId') AS INT64), NULLIF(JSON_VALUE(b, '$.promptId'), ''), offset + 1, CAST(JSON_VALUE(b, '$.enabled') AS BOOL), CURRENT_TIMESTAMP()
      FROM UNNEST(JSON_QUERY_ARRAY(@bindings)) b WITH OFFSET
      WHERE NOT EXISTS (SELECT 1 FROM ${sql(refs.links)} e WHERE e.eval_set_id = @draft_id AND e.criterion_id = CAST(JSON_VALUE(b, '$.criterionId') AS INT64));
    COMMIT TRANSACTION;
  `, { feedback_id: plan.sourceFeedbackId, phone_id: plan.sourcePhoneId, phone_channels: '["phone"]', snapshots: JSON.stringify(plan.snapshots), details: JSON.stringify(plan.details), draft: JSON.stringify(plan.draft), draft_id: plan.draft.version_id, bindings: JSON.stringify(plan.bindings) });
  const [afterVersions, afterPrompts, afterLinks] = await Promise.all(Object.values(refs).map((name) => query(`SELECT * FROM ${sql(name)}`)));
  for (const old of versions) {
    const rows = afterVersions.filter((v) => v.version_id === old.version_id);
    assert.equal(rows.length, 1);
    assert.equal(stable(rows[0], ['legacy_channel_snapshot_json']), stable(old, ['legacy_channel_snapshot_json']), `기존 버전 변경: ${old.version_id}`);
  }
  for (const old of prompts) {
    const rows = afterPrompts.filter((p) => p.prompt_id === old.prompt_id);
    // Legacy prompt ids must be unique for deterministic bindings.
    assert.equal(rows.length, 1, `중복/없는 기존 prompt_id ${old.prompt_id}`);
    assert.equal(stable(rows[0], ['exposure_channels_json']), stable(old, ['exposure_channels_json']));
    assert.deepEqual(readExposureChannels(rows[0].exposure_channels_json), old.exposure_channels_json ? readExposureChannels(old.exposure_channels_json) : ['phone']);
  }
  assert.deepEqual(afterLinks.filter((r) => r.eval_set_id !== plan.draft.version_id).map((r) => stable(r)).sort(), links.map((r) => stable(r)).sort());
  const saved = afterVersions.filter((v) => v.version_id === plan.draft.version_id);
  assert.equal(saved.length, 1);
  for (const col of versionColumns) assert.equal(saved[0][col], plan.draft[col], `draft ${col}`);
  assert.equal(saved[0].status, 'draft');
  for (const d of plan.details) {
    const actual = afterPrompts.filter((p) => p.prompt_id === d.prompt_id);
    assert.equal(actual.length, 1);
    for (const col of detailColumns) assert.equal(actual[0][col] ?? null, d[col] ?? null, `detail ${d.criterion_id} ${col}`);
  }
  const actualBindings = afterLinks.filter((r) => r.eval_set_id === plan.draft.version_id).sort((a, b) => a.sort_order - b.sort_order).map((r) => ({ criterionId: r.criterion_id, promptId: r.criterion_prompt_id || '', enabled: r.enabled }));
  assert.deepEqual(actualBindings, plan.bindings);
  validateChannelBindings(actualBindings, plan.details.map((p) => ({ promptId: p.prompt_id, criterionId: p.criterion_id, exposureChannels: ['feedback'] })) as any, 'feedback');
  const rendered = previewFinalPrompt({ basePrompt: saved[0].base_prompt, checklistTemplate: saved[0].checklist_template, criteria: JSON.parse(saved[0].criteria_json), useChecklist: true, outputSchemaConfig: JSON.parse(saved[0].output_schema_config_json) });
  assert.ok(rendered.includes(FEEDBACK_FIRST_PASS_GUIDANCE));
  for (const id of [413, 416, 547, 548]) assert.ok(!JSON.parse(saved[0].criteria_json).some((c: { id: number }) => c.id === id));
  const dir = join(tmpdir(), 'qradar-prompt-channels'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'verified.json'), JSON.stringify({ ...report, verified: true, rerun: useBackup }, null, 2));
  writeFileSync(join(dir, 'draft-preview.txt'), rendered);
  console.log(JSON.stringify({ stage: 'verified', ...report, rerun: useBackup, productionUnchanged: true, originalBindingsUnchanged: true }));
}
main().catch((e) => { console.error(JSON.stringify({ stage: 'blocked', code: e.code, message: e.message })); process.exitCode = 1; });

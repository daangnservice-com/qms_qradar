import { getBQ } from '../lib/bigquery';
import { promptBq, growthBq } from '../lib/bqRefs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main() {
  const bq = getBQ();
  console.log(JSON.stringify({ project: promptBq.projectId, dataset: promptBq.dataset, location: promptBq.location }));
  const [schema] = await bq.query({
    query: `SELECT table_name, column_name, data_type FROM \`${promptBq.projectId}.${promptBq.dataset}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name IN UNNEST(@tables) ORDER BY table_name, ordinal_position`,
    params: { tables: [promptBq.tables.versions, promptBq.tables.criterionPrompts, growthBq.evalSetCriteria] },
    location: promptBq.location,
  });
  console.log(JSON.stringify({ schema }));
  const [versions] = await bq.query({
    query: `SELECT version_id, template_key, version_label, criterion_bindings_json, criteria_json, base_prompt, checklist_template, output_schema_config_json, response_schema_json, result_parse_config_json FROM ${promptBq.sql(promptBq.tables.versions)} WHERE status = @status ORDER BY template_key, created_at DESC`,
    params: { status: 'production' }, location: promptBq.location,
  });
  // Only prompt metadata, never consultation records or credential objects.
  const [prompts] = await bq.query({ query: `SELECT * FROM ${promptBq.sql(promptBq.tables.criterionPrompts)}`, location: promptBq.location });
  const [bindings] = await bq.query({ query: `SELECT * FROM ${growthBq.resultsSql(growthBq.evalSetCriteria)} WHERE eval_set_id IN UNNEST(@ids)`, params: { ids: versions.map((v) => v.version_id) }, location: promptBq.location });
  const dir = join(tmpdir(), 'qradar-prompt-channels');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'before.json'), JSON.stringify({ schema, versions, prompts, bindings }, null, 2));
  console.log(JSON.stringify({ snapshot: join(dir, 'before.json'), versions: versions.map((v) => ({ id: v.version_id, key: v.template_key, bindings: JSON.parse(v.criterion_bindings_json), criteria: JSON.parse(v.criteria_json).map((c: { id: number }) => c.id) })), promptCount: prompts.length, bindingCount: bindings.length }));
}
main().catch((e) => { console.error(JSON.stringify({ code: e.code, message: e.message })); process.exitCode = 1; });

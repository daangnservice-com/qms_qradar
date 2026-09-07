import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { promptBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import {
  PROMPT_TEMPLATE_KEYS,
  defaultCriteria,
  defaultPromptSeed,
  type PromptTemplateKey,
} from "./promptDefaults";
import { parseCriteriaJson, parseSchemaJson } from "./promptRender";
import { parseOutputSchemaConfig, buildResponseSchemaFromConfig } from "./outputSchema";
import {
  ensureCriterionTables,
  buildCriteriaSnapshot,
  seedDraftCriterionPromptsFromChecklist,
  listCriterionPrompts,
} from "./criterionStore";
import { loadEvalSetCriteria, syncEvalSetCriteria } from "./evaluationDimensionStore";
import type { CsCriterion } from "./csChecklist";
import type {
  AudioPipelineConfig,
  EvalCriterionBinding,
  OutputSchemaConfig,
  PromptStatus,
  PromptVersion,
  ResultParseConfig,
} from "./promptTypes";
import {
  DEFAULT_AUDIO_PIPELINE_CONFIG,
  DEFAULT_OUTPUT_SCHEMA_CONFIG,
  DEFAULT_RESULT_PARSE_CONFIG,
  parseAudioPipelineConfig,
  parseResultParseConfig,
  TEXT_AUDIO_PIPELINE_CONFIG,
} from "./promptTypes";

export type { PromptStatus, PromptVersion } from "./promptTypes";

export interface PromptConfig {
  version: PromptVersion;
  criteria: CsCriterion[];
  responseSchema: object;
}

const VERSIONS = promptBq.tables.versions;
const HISTORY = promptBq.tables.prodHistory;
const loc = () => (promptBq.location ? { location: promptBq.location } : {});

const VERSIONS_SCHEMA = [
  { name: "version_id", type: "STRING", mode: "REQUIRED" },
  { name: "template_key", type: "STRING", mode: "REQUIRED" },
  { name: "version_label", type: "STRING", mode: "NULLABLE" },
  { name: "status", type: "STRING", mode: "REQUIRED" },
  { name: "base_prompt", type: "STRING", mode: "NULLABLE" },
  { name: "checklist_template", type: "STRING", mode: "NULLABLE" },
  { name: "response_schema_json", type: "STRING", mode: "NULLABLE" },
  { name: "criteria_json", type: "STRING", mode: "NULLABLE" },
  { name: "selected_criterion_ids", type: "STRING", mode: "NULLABLE" },
  { name: "criterion_bindings_json", type: "STRING", mode: "NULLABLE" },
  { name: "output_schema_config_json", type: "STRING", mode: "NULLABLE" },
  { name: "result_parse_config_json", type: "STRING", mode: "NULLABLE" },
  { name: "audio_pipeline_config_json", type: "STRING", mode: "NULLABLE" },
  { name: "use_checklist", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "change_note", type: "STRING", mode: "NULLABLE" },
  { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "created_by", type: "STRING", mode: "NULLABLE" },
] as const;

const HISTORY_SCHEMA = [
  { name: "event_id", type: "STRING", mode: "REQUIRED" },
  { name: "template_key", type: "STRING", mode: "REQUIRED" },
  { name: "from_version_id", type: "STRING", mode: "NULLABLE" },
  { name: "to_version_id", type: "STRING", mode: "REQUIRED" },
  { name: "action", type: "STRING", mode: "NULLABLE" },
  { name: "note", type: "STRING", mode: "NULLABLE" },
  { name: "changed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "changed_by", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensurePromptTables(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      await ensureCriterionTables();
      const bq = getBQ();
      const ds = bq.dataset(promptBq.dataset, { projectId: promptBq.projectId });
      const [dsExists] = await ds.exists();
      if (!dsExists) {
        await ds.create({ location: promptBq.location ?? "US" }).catch((e) => {
          if (!isAlreadyExists(e)) throw e;
        });
      }
      for (const [name, schema] of [
        [VERSIONS, VERSIONS_SCHEMA],
        [HISTORY, HISTORY_SCHEMA],
      ] as const) {
        const t = ds.table(name);
        const [exists] = await t.exists();
        if (!exists) {
          await t
            .create({ schema: schema as unknown as { name: string; type: string; mode: string }[] })
            .catch((e) => {
              if (!isAlreadyExists(e)) throw e;
            });
        }
      }
      // 스키마에 이미 포함된 컬럼은 metadata 확인 후 없을 때만 ALTER (quota 절약)
      await addColumnsIfMissing(
        ds.table(VERSIONS),
        [
          { name: "selected_criterion_ids", type: "STRING" },
          { name: "output_schema_config_json", type: "STRING" },
          { name: "criterion_bindings_json", type: "STRING" },
          { name: "result_parse_config_json", type: "STRING" },
          { name: "audio_pipeline_config_json", type: "STRING" },
        ],
        { location: promptBq.location ?? undefined, logTag: "promptStore" },
      );
      await seedIfEmpty();
    })().catch((err) => {
      _ensured = null;
      throw err;
    });
  }
  return _ensured;
}

async function seedIfEmpty(): Promise<void> {
  const sql = promptBq.sql(VERSIONS);
  const [rows] = await getBQ().query({
    query: `select count(*) as n from ${sql}`,
    ...loc(),
  });
  const n = Number((rows as { n: number }[])[0]?.n ?? 0);
  if (n > 0) return;
  for (const key of PROMPT_TEMPLATE_KEYS) {
    const seed = defaultPromptSeed(key);
    const criterionBindings: EvalCriterionBinding[] = seed.selectedCriterionIds.map((id) => ({
      criterionId: id,
      promptId: "",
      enabled: true,
    }));
    await insertVersion({
      ...seed,
      criterionBindings,
      resultParseConfig: seed.resultParseConfig ?? DEFAULT_RESULT_PARSE_CONFIG,
      audioPipelineConfig:
        key === "feedback_eval" || key === "chatcs_eval"
          ? TEXT_AUDIO_PIPELINE_CONFIG
          : DEFAULT_AUDIO_PIPELINE_CONFIG,
      status: "production",
      createdBy: "system-seed",
    });
  }
  console.log(`[promptStore] seeded ${PROMPT_TEMPLATE_KEYS.length} production versions into ${promptBq.fq(VERSIONS)}`);
}

function parseSelectedIds(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const a = JSON.parse(raw) as unknown;
      if (Array.isArray(a)) return a.map(Number).filter(Number.isFinite);
    } catch {
      /* ignore */
    }
  }
  return [];
}

function parseBindings(raw: unknown, fallbackIds: number[]): EvalCriterionBinding[] {
  if (typeof raw === "string" && raw.trim()) {
    try {
      const a = JSON.parse(raw) as unknown;
      if (Array.isArray(a)) {
        return a
          .map((x) => {
            const o = x as Record<string, unknown>;
            return {
              criterionId: Number(o.criterionId),
              promptId: String(o.promptId ?? ""),
              enabled: o.enabled !== false,
            };
          })
          .filter((b) => Number.isFinite(b.criterionId));
      }
    } catch {
      /* ignore */
    }
  }
  return fallbackIds.map((id) => ({ criterionId: id, promptId: "", enabled: true }));
}

function rowToVersion(r: Record<string, unknown>): PromptVersion {
  const created = r.created_at;
  const createdAt =
    created && typeof created === "object" && "value" in (created as object)
      ? String((created as { value: string }).value)
      : String(created ?? "");
  let selectedCriterionIds = parseSelectedIds(r.selected_criterion_ids);
  if (!selectedCriterionIds.length && r.criteria_json) {
    try {
      selectedCriterionIds = parseCriteriaJson(String(r.criteria_json)).map((c) => c.id);
    } catch {
      /* ignore */
    }
  }
  const criterionBindings = parseBindings(r.criterion_bindings_json, selectedCriterionIds);
  if (!selectedCriterionIds.length) {
    selectedCriterionIds = criterionBindings.filter((b) => b.enabled).map((b) => b.criterionId);
  }
  let outputSchemaConfig: OutputSchemaConfig = DEFAULT_OUTPUT_SCHEMA_CONFIG;
  if (r.output_schema_config_json) {
    try {
      outputSchemaConfig = parseOutputSchemaConfig(JSON.parse(String(r.output_schema_config_json)));
    } catch {
      /* ignore */
    }
  }
  let resultParseConfig: ResultParseConfig = DEFAULT_RESULT_PARSE_CONFIG;
  if (r.result_parse_config_json) {
    try {
      resultParseConfig = parseResultParseConfig(JSON.parse(String(r.result_parse_config_json)));
    } catch {
      /* ignore */
    }
  }
  let audioPipelineConfig: AudioPipelineConfig = DEFAULT_AUDIO_PIPELINE_CONFIG;
  if (r.audio_pipeline_config_json) {
    try {
      audioPipelineConfig = parseAudioPipelineConfig(JSON.parse(String(r.audio_pipeline_config_json)));
    } catch {
      /* ignore */
    }
  }
  return {
    versionId: String(r.version_id),
    templateKey: String(r.template_key) as PromptTemplateKey,
    versionLabel: String(r.version_label ?? ""),
    status: String(r.status) as PromptStatus,
    basePrompt: String(r.base_prompt ?? ""),
    checklistTemplate: String(r.checklist_template ?? ""),
    responseSchemaJson: String(r.response_schema_json ?? "{}"),
    selectedCriterionIds,
    criterionBindings,
    outputSchemaConfig,
    resultParseConfig,
    audioPipelineConfig,
    criteriaJson: String(r.criteria_json ?? "[]"),
    useChecklist: Boolean(r.use_checklist),
    changeNote: String(r.change_note ?? ""),
    createdAt,
    createdBy: String(r.created_by ?? ""),
  };
}

async function insertVersion(input: {
  templateKey: PromptTemplateKey;
  versionLabel: string;
  status: PromptStatus;
  basePrompt: string;
  checklistTemplate: string;
  responseSchemaJson: string;
  criteriaJson: string;
  selectedCriterionIds: number[];
  criterionBindings: EvalCriterionBinding[];
  outputSchemaConfig: OutputSchemaConfig;
  resultParseConfig: ResultParseConfig;
  audioPipelineConfig: AudioPipelineConfig;
  useChecklist: boolean;
  changeNote: string;
  createdBy: string;
  versionId?: string;
}): Promise<PromptVersion> {
  parseSchemaJson(input.responseSchemaJson);
  parseCriteriaJson(input.criteriaJson);

  const versionId = input.versionId ?? randomUUID();
  const createdAt = new Date().toISOString();
  const sql = promptBq.sql(VERSIONS);
  await getBQ().query({
    query: `
      insert into ${sql}
        (version_id, template_key, version_label, status, base_prompt, checklist_template,
         response_schema_json, criteria_json, selected_criterion_ids, criterion_bindings_json,
         output_schema_config_json, result_parse_config_json, audio_pipeline_config_json,
         use_checklist, change_note, created_at, created_by)
      values
        (@version_id, @template_key, @version_label, @status, @base_prompt, @checklist_template,
         @response_schema_json, @criteria_json, @selected_criterion_ids, @criterion_bindings_json,
         @output_schema_config_json, @result_parse_config_json, @audio_pipeline_config_json,
         @use_checklist, @change_note, timestamp(@created_at), @created_by)
    `,
    params: {
      version_id: versionId,
      template_key: input.templateKey,
      version_label: input.versionLabel,
      status: input.status,
      base_prompt: input.basePrompt,
      checklist_template: input.checklistTemplate,
      response_schema_json: input.responseSchemaJson,
      criteria_json: input.criteriaJson,
      selected_criterion_ids: JSON.stringify(input.selectedCriterionIds),
      criterion_bindings_json: JSON.stringify(input.criterionBindings),
      output_schema_config_json: JSON.stringify(input.outputSchemaConfig),
      result_parse_config_json: JSON.stringify(input.resultParseConfig),
      audio_pipeline_config_json: JSON.stringify(input.audioPipelineConfig),
      use_checklist: input.useChecklist,
      change_note: input.changeNote,
      created_at: createdAt,
      created_by: input.createdBy,
    },
    ...loc(),
  });
  await syncEvalSetCriteria({
    evalSetId: versionId,
    bindings: input.criterionBindings,
  }).catch((e) =>
    console.warn("[promptStore] normalized eval-set criteria sync:", e instanceof Error ? e.message : e),
  );
  return {
    versionId,
    templateKey: input.templateKey,
    versionLabel: input.versionLabel,
    status: input.status,
    basePrompt: input.basePrompt,
    checklistTemplate: input.checklistTemplate,
    responseSchemaJson: input.responseSchemaJson,
    selectedCriterionIds: input.selectedCriterionIds,
    criterionBindings: input.criterionBindings,
    outputSchemaConfig: input.outputSchemaConfig,
    resultParseConfig: input.resultParseConfig,
    audioPipelineConfig: input.audioPipelineConfig,
    criteriaJson: input.criteriaJson,
    useChecklist: input.useChecklist,
    changeNote: input.changeNote,
    createdAt,
    createdBy: input.createdBy,
  };
}

export async function listPromptVersions(
  templateKey: PromptTemplateKey,
  opts?: { ensure?: boolean },
): Promise<PromptVersion[]> {
  if (opts?.ensure !== false) await ensurePromptTables();
  const sql = promptBq.sql(VERSIONS);
  const [rows] = await getBQ().query({
    query: `
      select *
      from ${sql}
      where template_key = @template_key
      order by created_at desc
      limit 100
    `,
    params: { template_key: templateKey },
    ...loc(),
  });
  return (rows as Record<string, unknown>[]).map(rowToVersion);
}

export async function getPromptVersion(versionId: string): Promise<PromptVersion | null> {
  await ensurePromptTables();
  const sql = promptBq.sql(VERSIONS);
  const [rows] = await getBQ().query({
    query: `select * from ${sql} where version_id = @version_id limit 1`,
    params: { version_id: versionId },
    ...loc(),
  });
  const r = (rows as Record<string, unknown>[])[0];
  return r ? rowToVersion(r) : null;
}

export async function getProductionPrompt(
  templateKey: PromptTemplateKey,
  opts?: { ensure?: boolean; seedDraft?: boolean },
): Promise<PromptConfig> {
  try {
    if (opts?.ensure !== false) await ensurePromptTables();
    // 읽기 경로에서는 기본 시드 스킵(ensure 시 seedIfEmpty + criterion ensure 시 시드됨)
    if (opts?.seedDraft) {
      await seedDraftCriterionPromptsFromChecklist().catch(() => {});
    }
    const sql = promptBq.sql(VERSIONS);
    const [rows] = await getBQ().query({
      query: `
        select *
        from ${sql}
        where template_key = @template_key and status = 'production'
        order by created_at desc
        limit 1
      `,
      params: { template_key: templateKey },
      ...loc(),
    });
    const r = (rows as Record<string, unknown>[])[0];
    if (r) {
      return await promptConfigFromVersion(rowToVersion(r));
    }
  } catch (e) {
    console.warn(
      `[promptStore] getProductionPrompt failed — hardcoded fallback: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return hardcodedFallback(templateKey);
}

/** version_id 로 PromptConfig 로드 (draft/archived 포함). 없으면 null. */
export async function getPromptConfigByVersionId(versionId: string): Promise<PromptConfig | null> {
  const id = (versionId ?? "").trim();
  if (!id) return null;
  const version = await getPromptVersion(id);
  if (!version) return null;
  return promptConfigFromVersion(version);
}

async function promptConfigFromVersion(version: PromptVersion): Promise<PromptConfig> {
  let criteria = parseCriteriaJson(version.criteriaJson);
  const normalizedCriteria = await loadEvalSetCriteria(version.versionId);
  if (normalizedCriteria?.length) criteria = normalizedCriteria;
  const weak =
    version.useChecklist &&
    (!criteria.length ||
      criteria.every((c) => !(c.fields?.definition?.trim() || c.hint?.trim())));
  if (weak) {
    criteria = await buildCriteriaSnapshot(
      version.criterionBindings?.length
        ? version.criterionBindings
        : defaultCriteria(true).map((c) => ({
            criterionId: c.id,
            promptId: "",
            enabled: true,
          })),
    );
  }
  return {
    version,
    criteria,
    responseSchema: parseSchemaJson(version.responseSchemaJson),
  };
}

/** CS_CHECKLIST 기반 초안 평가셋을 production 으로 저장(기존 production demote) */
export async function seedChecklistDraftEvalSet(input: {
  templateKey?: PromptTemplateKey;
  createdBy?: string;
  promote?: boolean;
}): Promise<PromptVersion> {
  const templateKey = input.templateKey ?? "call_eval_growth";
  if (templateKey === "feedback_eval" || templateKey === "chatcs_eval") {
    throw new Error("문의·채팅 평가셋은 기존 전화 체크리스트 시드 대신 채널 탭에서 항목을 선택해 만드세요");
  }
  await ensurePromptTables();
  await seedDraftCriterionPromptsFromChecklist();
  const prompts = await listCriterionPrompts();
  const latestByCrit = new Map<number, string>();
  for (const p of prompts) {
    const cur = latestByCrit.get(p.criterionId);
    // list is ordered by updated_at desc per earlier query — first wins
    if (!cur) latestByCrit.set(p.criterionId, p.promptId);
  }
  const criteria = defaultCriteria(true);
  const criterionBindings: EvalCriterionBinding[] = criteria.map((c) => ({
    criterionId: c.id,
    promptId: latestByCrit.get(c.id) ?? "",
    enabled: true,
  }));
  return savePromptVersion({
    templateKey,
    versionLabel: "v1-checklist-draft",
    basePrompt: defaultPromptSeed(templateKey).basePrompt,
    checklistTemplate: defaultPromptSeed(templateKey).checklistTemplate,
    criterionBindings,
    outputSchemaConfig: defaultPromptSeed(templateKey).outputSchemaConfig,
    resultParseConfig: DEFAULT_RESULT_PARSE_CONFIG,
    useChecklist: true,
    changeNote: "CS_CHECKLIST hint 기반 초안 평가셋 (definition만 채움)",
    createdBy: input.createdBy ?? "system-seed-checklist",
    promote: input.promote !== false,
  });
}

function hardcodedFallback(templateKey: PromptTemplateKey): PromptConfig {
  const seed = defaultPromptSeed(templateKey);
  const criterionBindings: EvalCriterionBinding[] = seed.selectedCriterionIds.map((id) => ({
    criterionId: id,
    promptId: "",
    enabled: true,
  }));
  const version: PromptVersion = {
    versionId: "hardcoded-fallback",
    templateKey,
    versionLabel: seed.versionLabel,
    status: "production",
    basePrompt: seed.basePrompt,
    checklistTemplate: seed.checklistTemplate,
    responseSchemaJson: seed.responseSchemaJson,
    selectedCriterionIds: seed.selectedCriterionIds,
    criterionBindings,
    outputSchemaConfig: seed.outputSchemaConfig,
    resultParseConfig: seed.resultParseConfig ?? DEFAULT_RESULT_PARSE_CONFIG,
    audioPipelineConfig: DEFAULT_AUDIO_PIPELINE_CONFIG,
    criteriaJson: seed.criteriaJson,
    useChecklist: seed.useChecklist,
    changeNote: seed.changeNote,
    createdAt: new Date(0).toISOString(),
    createdBy: "hardcoded",
  };
  return {
    version,
    criteria: parseCriteriaJson(version.criteriaJson),
    responseSchema: parseSchemaJson(version.responseSchemaJson),
  };
}

export async function savePromptVersion(input: {
  templateKey: PromptTemplateKey;
  /** @deprecated 서버에서 versionNote 로 YYMMDD_verN 자동 생성. 하위호환 */
  versionLabel?: string;
  /** 사용자 추가 문구(선택). 최종 라벨은 YYMMDD_verN[_note] */
  versionNote?: string;
  basePrompt: string;
  checklistTemplate: string;
  criterionBindings: EvalCriterionBinding[];
  outputSchemaConfig: OutputSchemaConfig;
  resultParseConfig?: ResultParseConfig;
  audioPipelineConfig?: AudioPipelineConfig;
  useChecklist: boolean;
  changeNote: string;
  createdBy: string;
  promote?: boolean;
}): Promise<PromptVersion> {
  await ensurePromptTables();
  const status: PromptStatus = input.promote ? "production" : "draft";
  if (input.promote) await demoteCurrentProduction(input.templateKey);

  const existing = await listPromptVersions(input.templateKey, { ensure: false });
  const { buildCriterionVersionLabel, parseVersionLabel } = await import("./criterionVersionLabel");
  // versionNote 우선. 없으면 versionLabel 이 이미 YYMMDD_verN 형식이면 무시(노트 아님), 아니면 노트로 취급
  const rawNote =
    input.versionNote != null
      ? input.versionNote
      : parseVersionLabel(String(input.versionLabel ?? ""))
        ? ""
        : String(input.versionLabel ?? "");
  const versionLabel = buildCriterionVersionLabel(
    rawNote,
    existing.map((v) => v.versionLabel),
  );

  const audioPipelineConfig = parseAudioPipelineConfig(input.audioPipelineConfig ?? DEFAULT_AUDIO_PIPELINE_CONFIG);
  const silenceSchemaOn = audioPipelineConfig.steps.find((s) => s.id === "schema_silence_comments")?.enabled !== false;
  const outputSchemaConfig = {
    ...input.outputSchemaConfig,
    includeCsChecklist: input.useChecklist && input.outputSchemaConfig.includeCsChecklist,
    includeSilenceComments: silenceSchemaOn && input.outputSchemaConfig.includeSilenceComments,
  };
  const resultParseConfig = input.resultParseConfig ?? DEFAULT_RESULT_PARSE_CONFIG;
  const responseSchemaJson = JSON.stringify(buildResponseSchemaFromConfig(outputSchemaConfig), null, 2);
  const criterionBindings = input.criterionBindings;
  const selectedCriterionIds = criterionBindings.filter((b) => b.enabled).map((b) => b.criterionId);
  const criteria = input.useChecklist ? await buildCriteriaSnapshot(criterionBindings) : [];
  const criteriaJson = JSON.stringify(criteria, null, 2);

  const v = await insertVersion({
    templateKey: input.templateKey,
    versionLabel,
    status,
    basePrompt: input.basePrompt,
    checklistTemplate: input.checklistTemplate,
    responseSchemaJson,
    criteriaJson,
    selectedCriterionIds,
    criterionBindings,
    outputSchemaConfig,
    resultParseConfig,
    audioPipelineConfig,
    useChecklist: input.useChecklist,
    changeNote: input.changeNote,
    createdBy: input.createdBy,
  });
  if (input.promote) {
    await appendProdHistory({
      templateKey: input.templateKey,
      fromVersionId: null,
      toVersionId: v.versionId,
      action: "promote",
      note: input.changeNote,
      changedBy: input.createdBy,
    });
  }
  return v;
}

export async function setProductionVersion(input: {
  templateKey: PromptTemplateKey;
  versionId: string;
  changedBy: string;
  note?: string;
  action?: "promote" | "rollback";
}): Promise<PromptVersion> {
  await ensurePromptTables();
  const target = await getPromptVersion(input.versionId);
  if (!target || target.templateKey !== input.templateKey) {
    throw new Error("버전을 찾을 수 없습니다");
  }
  const prev = await getProductionPrompt(input.templateKey);
  const prevId = prev.version.versionId === "hardcoded-fallback" ? null : prev.version.versionId;

  await demoteCurrentProduction(input.templateKey);
  const promoted = await insertVersion({
    templateKey: target.templateKey,
    versionLabel: target.versionLabel,
    status: "production",
    basePrompt: target.basePrompt,
    checklistTemplate: target.checklistTemplate,
    responseSchemaJson: target.responseSchemaJson,
    criteriaJson: target.criteriaJson,
    selectedCriterionIds: target.selectedCriterionIds,
    criterionBindings: target.criterionBindings ?? [],
    outputSchemaConfig: target.outputSchemaConfig,
    resultParseConfig: target.resultParseConfig ?? DEFAULT_RESULT_PARSE_CONFIG,
    audioPipelineConfig: target.audioPipelineConfig ?? DEFAULT_AUDIO_PIPELINE_CONFIG,
    useChecklist: target.useChecklist,
    changeNote: input.note ?? `set production from ${target.versionId}`,
    createdBy: input.changedBy,
  });
  await appendProdHistory({
    templateKey: input.templateKey,
    fromVersionId: prevId,
    toVersionId: promoted.versionId,
    action: input.action ?? "promote",
    note: input.note ?? "",
    changedBy: input.changedBy,
  });
  return promoted;
}

async function demoteCurrentProduction(templateKey: PromptTemplateKey): Promise<void> {
  const sql = promptBq.sql(VERSIONS);
  try {
    await getBQ().query({
      query: `
        update ${sql}
        set status = 'archived'
        where template_key = @template_key and status = 'production'
      `,
      params: { template_key: templateKey },
      ...loc(),
    });
  } catch (e) {
    console.warn(
      `[promptStore] demoteCurrentProduction UPDATE failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function appendProdHistory(input: {
  templateKey: PromptTemplateKey;
  fromVersionId: string | null;
  toVersionId: string;
  action: string;
  note: string;
  changedBy: string;
}): Promise<void> {
  const sql = promptBq.sql(HISTORY);
  await getBQ().query({
    query: `
      insert into ${sql}
        (event_id, template_key, from_version_id, to_version_id, action, note, changed_at, changed_by)
      values
        (@event_id, @template_key, @from_version_id, @to_version_id, @action, @note, timestamp(@changed_at), @changed_by)
    `,
    params: {
      event_id: randomUUID(),
      template_key: input.templateKey,
      from_version_id: input.fromVersionId,
      to_version_id: input.toVersionId,
      action: input.action,
      note: input.note,
      changed_at: new Date().toISOString(),
      changed_by: input.changedBy,
    },
    types: {
      event_id: "STRING",
      template_key: "STRING",
      from_version_id: "STRING",
      to_version_id: "STRING",
      action: "STRING",
      note: "STRING",
      changed_at: "STRING",
      changed_by: "STRING",
    },
    ...loc(),
  });
}

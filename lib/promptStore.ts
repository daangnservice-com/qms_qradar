import { randomUUID } from "node:crypto";
import { ChannelBindingError, validateChannelBindings, readExposureChannels } from './criterionChannels';
import { promptBq } from "./bqRefs";
import { servingRows } from "./servingDb";
import {
  PROMPT_TEMPLATE_KEYS,
  defaultCriteria,
  defaultPromptSeed,
  type PromptTemplateKey,
  promptChannelForTemplateKey,
} from "./promptDefaults";
import { parseCriteriaJson, parseSchemaJson } from "./promptRender";
import { parseOutputSchemaConfig, buildResponseSchemaFromConfig } from "./outputSchema";
import {
  ensureCriterionTables,
  buildCriteriaSnapshot,
  seedDraftCriterionPromptsFromChecklist,
  listCriterionPrompts,
  listFieldKeys,
} from "./criterionStore";
import { syncEvalSetCriteria } from "./evaluationDimensionStore";
import { validateChecklistCoverage } from './checklistCoverage';
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
  fieldKeys?: import('./promptTypes').PromptFieldKey[];
  version: PromptVersion;
  criteria: CsCriterion[];
  responseSchema: object;
}

// 평가셋 버전·배포 이력. 원천은 서빙 Postgres(테이블 이름은 BQ 와 같다), BQ 는 야간 덤프 사본.
const VERSIONS = promptBq.tables.versions;
const HISTORY = promptBq.tables.prodHistory;

let _ensured: Promise<void> | null = null;

/** 기준 테이블 시드와 기본 평가셋 시드. 프로세스당 한 번. */
export function ensurePromptTables(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      await ensureCriterionTables();
      await seedIfEmpty();
    })().catch((err) => {
      _ensured = null;
      throw err;
    });
  }
  return _ensured;
}

async function seedIfEmpty(): Promise<void> {
  const rows = await servingRows<{ n: number }>(`select count(*)::int as n from ${VERSIONS}`);
  const n = Number(rows[0]?.n ?? 0);
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
  console.log(`[promptStore] seeded ${PROMPT_TEMPLATE_KEYS.length} production versions into ${VERSIONS}`);
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
    legacyChannelSnapshotJson: r.legacy_channel_snapshot_json ? String(r.legacy_channel_snapshot_json) : undefined,
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
  await servingRows(
    `
      insert into ${VERSIONS}
        (version_id, template_key, version_label, status, base_prompt, checklist_template,
         response_schema_json, criteria_json, selected_criterion_ids, criterion_bindings_json,
         output_schema_config_json, result_parse_config_json, audio_pipeline_config_json,
         use_checklist, change_note, created_at, created_by)
      values
        (@version_id, @template_key, @version_label, @status, @base_prompt, @checklist_template,
         @response_schema_json, @criteria_json, @selected_criterion_ids, @criterion_bindings_json,
         @output_schema_config_json, @result_parse_config_json, @audio_pipeline_config_json,
         @use_checklist, @change_note, @created_at::timestamptz, @created_by)
    `,
    {
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
  );
  await syncEvalSetCriteria({
    evalSetId: versionId,
    bindings: input.criterionBindings,
  });
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
  const rows = await servingRows(
    `
      select *
      from ${VERSIONS}
      where template_key = @template_key
      order by created_at desc
      limit 100
    `,
    { template_key: templateKey },
  );
  return rows.map(rowToVersion);
}

export async function getPromptVersion(versionId: string, opts?: { ensure?: boolean }): Promise<PromptVersion | null> {
  if (opts?.ensure !== false) await ensurePromptTables();
  const rows = await servingRows(`select * from ${VERSIONS} where version_id = @version_id limit 1`, {
    version_id: versionId,
  });
  const r = rows[0];
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
    const rows = await servingRows(
      `
        select *
        from ${VERSIONS}
        where template_key = @template_key and status = 'production'
        order by created_at desc
        limit 1
      `,
      { template_key: templateKey },
    );
    const r = rows[0];
    if (r) {
      try {
        return await promptConfigFromVersion(rowToVersion(r));
      } catch (error) {
        throw new ChannelBindingError(`저장된 production 평가셋 검증 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (e) {
    if (e instanceof ChannelBindingError) throw e;
    console.warn(
      `[promptStore] getProductionPrompt failed — hardcoded fallback: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return hardcodedFallback(templateKey);
}

/** version_id 로 PromptConfig 로드 (draft/archived 포함). 없으면 null. */
export async function getPromptConfigByVersionId(versionId: string, opts?: { ensure?: boolean }): Promise<PromptConfig | null> {
  const id = (versionId ?? "").trim();
  if (!id) return null;
  const version = await getPromptVersion(id, opts);
  if (!version) return null;
  return promptConfigFromVersion(version);
}

async function promptConfigFromVersion(version: PromptVersion): Promise<PromptConfig> {
  const frozen = await validatePromptVersionChannels(version);
  if (frozen) return { version, criteria: frozen, responseSchema: parseSchemaJson(version.responseSchemaJson) };
  // Persisted snapshots are authoritative. Never rebuild from a latest detail at read time.
  const criteria = parseCriteriaJson(version.criteriaJson);
  if (version.useChecklist) validateChecklistCoverage(criteria, version.criterionBindings.filter((b) => b.enabled).map((b) => b.criterionId));
  return {
    version,
    criteria,
    fieldKeys: await listFieldKeys(),
    responseSchema: parseSchemaJson(version.responseSchemaJson),
  };
}

/** Legacy snapshots are granted only by the migration; new saves cannot grant compatibility. */
export async function validatePromptVersionChannels(version: PromptVersion): Promise<CsCriterion[] | null> {
  if (version.legacyChannelSnapshotJson) {
    const frozen = JSON.parse(version.legacyChannelSnapshotJson);
    if (frozen.templateKey !== version.templateKey || JSON.stringify(frozen.bindings) !== JSON.stringify(version.criterionBindings)) {
      throw new ChannelBindingError('기존 평가셋 호환 스냅샷과 바인딩이 다릅니다');
    }
    return parseCriteriaJson(JSON.stringify(frozen.criteria));
  }
  await validateChannelBindings(version.criterionBindings, await listCriterionPrompts(), promptChannelForTemplateKey(version.templateKey));
  return null;
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
    if (!readExposureChannels(p.exposureChannels).includes('phone')) continue;
    const cur = latestByCrit.get(p.criterionId);
    if (cur) throw new ChannelBindingError(`[${p.criterionId}] 상세 버전이 여러 개입니다. 평가셋 편집에서 직접 선택하세요`);
    latestByCrit.set(p.criterionId, p.promptId);
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
  await validateChannelBindings(input.criterionBindings, await listCriterionPrompts(), promptChannelForTemplateKey(input.templateKey));

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
  const criteria = input.useChecklist ? await buildCriteriaSnapshot(criterionBindings, promptChannelForTemplateKey(input.templateKey)) : [];
  const criteriaJson = JSON.stringify(criteria, null, 2);
  if (input.promote) await demoteCurrentProduction(input.templateKey);

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
  validateChannelBindings(target.criterionBindings, await listCriterionPrompts(), promptChannelForTemplateKey(target.templateKey));
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
  try {
    await servingRows(
      `
        update ${VERSIONS}
        set status = 'archived'
        where template_key = @template_key and status = 'production'
      `,
      { template_key: templateKey },
    );
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
  await servingRows(
    `
      insert into ${HISTORY}
        (event_id, template_key, from_version_id, to_version_id, "action", note, changed_at, changed_by)
      values
        (@event_id, @template_key, @from_version_id, @to_version_id, @action, @note, @changed_at::timestamptz, @changed_by)
    `,
    {
      event_id: randomUUID(),
      template_key: input.templateKey,
      from_version_id: input.fromVersionId,
      to_version_id: input.toVersionId,
      action: input.action,
      note: input.note,
      changed_at: new Date().toISOString(),
      changed_by: input.changedBy,
    },
  );
}

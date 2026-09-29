import { randomUUID } from "node:crypto";
import { readExposureChannels, requireExposureChannels, validateChannelBindings } from './criterionChannels';
import type { EvaluationChannel } from './evaluationChannel';
import { promptBq } from "./bqRefs";
import { servingRows } from "./servingDb";
import {
  DEFAULT_FIELD_KEYS,
  DEFAULT_CRITERION_REVIEW_SCOPE,
  parseCriterionReviewScope,
  type CriterionPrompt,
  type CriterionReviewScope,
  type EvalCriterionBinding,
  type PromptFieldKey,
  type SourceCriterion,
} from "./promptTypes";
import { type CsCriterion, CS_CHECKLIST } from "./csChecklist";

// 평가 항목 프롬프트·필드 설정. 원천은 서빙 Postgres(테이블 이름은 BQ 와 같다), BQ 는 야간 덤프 사본.
const FIELD_TABLE = promptBq.tables.fieldConfig;
const CRIT_TABLE = promptBq.tables.criterionPrompts;

let _ensured: Promise<void> | null = null;

/** CS_CHECKLIST 초안 시드. 프로세스당 한 번. */
export function ensureCriterionTables(): Promise<void> {
  if (!_ensured) {
    _ensured = seedDraftCriterionPromptsFromChecklist()
      .then(() => undefined)
      .catch((e) => {
        _ensured = null;
        throw e;
      });
  }
  return _ensured;
}

function checklistFields(c: CsCriterion): Record<string, string> {
  return (
    c.fields ?? {
      definition: c.hint,
      good: "",
      bad: "",
      exception: "",
    }
  );
}

function hasExampleFields(fields: Record<string, string> | undefined): boolean {
  const f = fields ?? {};
  return Boolean(f.good?.trim() || f.bad?.trim() || f.exception?.trim());
}

/**
 * CS_CHECKLIST fields → 프롬프트 초안 시드.
 * - 프롬프트가 없는 criterion_id: 신규 insert (v1-ref-0803)
 * - 최신 버전에 good/bad/exception 이 비어 있으면: 레퍼런스 채운 새 버전 insert
 * - 이미 사례가 채워진 항목은 건너뜀
 */
export async function seedDraftCriterionPromptsFromChecklist(): Promise<number> {
  const existing = await listCriterionPrompts();
  const latestByCrit = new Map<number, (typeof existing)[number]>();
  for (const p of existing) {
    if (!readExposureChannels(p.exposureChannels).includes('phone')) continue;
    const cur = latestByCrit.get(p.criterionId);
    if (!cur || p.updatedAt > cur.updatedAt) latestByCrit.set(p.criterionId, p);
  }

  const missing = CS_CHECKLIST.filter((c) => {
    const latest = latestByCrit.get(c.id);
    if (!latest) return true;
    return !hasExampleFields(latest.fields);
  });
  if (!missing.length) return 0;

  const updatedAt = new Date().toISOString();
  for (const c of missing) {
    await servingRows(
      `
      insert into ${CRIT_TABLE}
        (prompt_id, criterion_id, version_label, category, label, fields_json, exposure_channels_json, updated_at, updated_by)
      values
        (@prompt_id, @criterion_id, @version_label, @category, @label, @fields_json, @exposure_channels_json, @updated_at::timestamptz, @updated_by)
      `,
      {
        prompt_id: randomUUID(),
        criterion_id: c.id,
        version_label: "v1-ref-0803",
        category: c.category,
        label: c.label,
        fields_json: JSON.stringify(checklistFields(c)),
        exposure_channels_json: '["phone"]',
        updated_at: updatedAt,
        updated_by: "system-seed-ref-0803",
      },
    );
  }
  const n = missing.length;
  console.log(`[criterionStore] seeded ${n} ref-0803 prompts into ${CRIT_TABLE}`);
  return n;
}

/** 원본 평가 기준(데이터 쪽 뷰). 서빙 사본(qms_source_criteria, 야간 pull)을 읽는다. */
export async function listSourceCriteria(): Promise<SourceCriterion[]> {
  const rows = await servingRows(`
    select id, type, parent_name, name, parent_id, extra
    from qms_source_criteria
    order by parent_name collate "C", id
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    type: String(r.type ?? ""),
    parentName: String(r.parent_name ?? ""),
    name: String(r.name ?? ""),
    parentId: r.parent_id == null ? null : Number(r.parent_id),
    extra: String(r.extra ?? ""),
  }));
}

export async function listFieldKeys(): Promise<PromptFieldKey[]> {
  try {
    const rows = await servingRows(`
      select * from (
        select distinct on ("key") "key", label, sort_order, enabled
        from ${FIELD_TABLE}
        order by "key", updated_at desc
      ) latest
      order by sort_order nulls first, "key" collate "C"
    `);
    const list = rows.map((r) => ({
      key: String(r.key),
      label: String(r.label ?? r.key),
      sortOrder: Number(r.sort_order ?? 0),
      enabled: r.enabled !== false,
    }));
    return list.length ? list : DEFAULT_FIELD_KEYS;
  } catch (e) {
    console.warn("[criterionStore] listFieldKeys fallback:", e instanceof Error ? e.message : e);
    return DEFAULT_FIELD_KEYS;
  }
}

export async function upsertFieldKey(field: PromptFieldKey, updatedBy: string): Promise<void> {
  await ensureCriterionTables();
  await servingRows(
    `
      insert into ${FIELD_TABLE} ("key", label, sort_order, enabled, updated_at, updated_by)
      values (@key, @label, @sort_order, @enabled, @updated_at::timestamptz, @updated_by)
    `,
    {
      key: field.key,
      label: field.label,
      sort_order: field.sortOrder,
      enabled: field.enabled,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
  );
}

export async function saveFieldKeys(fields: PromptFieldKey[], updatedBy: string): Promise<void> {
  for (const f of fields) await upsertFieldKey(f, updatedBy);
}

/** 모든 항목 프롬프트 버전 (1:N) */
export async function listCriterionPrompts(): Promise<CriterionPrompt[]> {
  try {
    const rows = await servingRows(`
      select *
      from ${CRIT_TABLE}
      order by criterion_id, updated_at desc
    `);
    return (rows as Record<string, unknown>[]).map(rowToCriterionPrompt);
  } catch (e) {
    console.warn("[criterionStore] listCriterionPrompts fallback:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function listCriterionPromptsFor(criterionId: number): Promise<CriterionPrompt[]> {
  const all = await listCriterionPrompts();
  return all.filter((p) => p.criterionId === criterionId);
}

export async function getCriterionPromptById(promptId: string): Promise<CriterionPrompt | null> {
  const all = await listCriterionPrompts();
  return all.find((p) => p.promptId === promptId) ?? null;
}

/** 새 버전으로 저장 (기존 행 덮어쓰지 않음). versionLabel 명시 시 그대로, 아니면 YYMMDD_verN[_note] */
export async function saveCriterionPrompt(input: {
  exposureChannels: EvaluationChannel[];
  criterionId: number;
  category: string;
  label: string;
  fields: Record<string, string>;
  reviewScope?: CriterionReviewScope;
  /** 명시 시 이 라벨 사용(프롬프트 개선 improved_ver 등). 없으면 versionNote로 자동 생성 */
  versionLabel?: string;
  /** 사용자 추가 문구(선택). versionLabel 없을 때 최종 라벨은 YYMMDD_verN[_note] */
  versionNote?: string;
  updatedBy: string;
}): Promise<CriterionPrompt> {
  const exposureChannels = requireExposureChannels(input.exposureChannels);
  await ensureCriterionTables();
  const existing = await listCriterionPromptsFor(input.criterionId);
  const { buildCriterionVersionLabel } = await import("./criterionVersionLabel");
  const explicit = String(input.versionLabel ?? "").trim();
  const versionLabel =
    explicit ||
    buildCriterionVersionLabel(
      input.versionNote,
      existing.map((p) => p.versionLabel),
    );
  const promptId = randomUUID();
  const updatedAt = new Date().toISOString();
  await servingRows(
    `
      insert into ${CRIT_TABLE}
        (prompt_id, criterion_id, version_label, category, label, fields_json, review_scope, exposure_channels_json, updated_at, updated_by)
      values
        (@prompt_id, @criterion_id, @version_label, @category, @label, @fields_json, @review_scope, @exposure_channels_json, @updated_at::timestamptz, @updated_by)
    `,
    {
      prompt_id: promptId,
      criterion_id: input.criterionId,
      version_label: versionLabel,
      category: input.category,
      label: input.label,
      fields_json: JSON.stringify(input.fields),
      exposure_channels_json: JSON.stringify(exposureChannels),
      review_scope: input.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE,
      updated_at: updatedAt,
      updated_by: input.updatedBy,
    },
  );
  return {
    promptId,
    criterionId: input.criterionId,
    versionLabel,
    category: input.category,
    label: input.label,
    fields: input.fields,
    exposureChannels,
    reviewScope: input.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE,
    updatedAt,
    updatedBy: input.updatedBy,
  };
}

function tsValue(updated: unknown): string {
  if (updated && typeof updated === "object" && "value" in (updated as object)) {
    return String((updated as { value: string }).value);
  }
  return String(updated ?? "");
}

function rowToCriterionPrompt(r: Record<string, unknown>): CriterionPrompt {
  let fields: Record<string, string> = {};
  try {
    fields = JSON.parse(String(r.fields_json ?? "{}")) as Record<string, string>;
  } catch {
    fields = {};
  }
  const updatedAt = tsValue(r.updated_at);
  const criterionId = Number(r.criterion_id);
  const promptIdRaw = r.prompt_id != null ? String(r.prompt_id).trim() : "";
  const promptId = promptIdRaw || `legacy-${criterionId}-${updatedAt}`;
  const versionLabel = String(r.version_label ?? "").trim() || "v1";
  const rawScope = r.review_scope;
  const hasExplicitScope =
    rawScope != null && String(rawScope).trim() !== "";
  return {
    promptId,
    criterionId,
    versionLabel,
    category: String(r.category ?? ""),
    label: String(r.label ?? ""),
    fields,
    exposureChannels: readExposureChannels(r.exposure_channels_json),
    reviewScope: hasExplicitScope ? parseCriterionReviewScope(rawScope) : undefined,
    updatedAt,
    updatedBy: String(r.updated_by ?? ""),
  };
}

/** 평가셋 바인딩 → 렌더용 CsCriterion[] (기준당 지정된 프롬프트 1개) */
export async function buildCriteriaSnapshot(bindings: EvalCriterionBinding[], channel: EvaluationChannel): Promise<CsCriterion[]> {
  const enabled = bindings.filter((b) => b.enabled);
  // Explicitly empty/all-disabled bindings mean an empty checklist.
  const targets = enabled;

  const prompts = await listCriterionPrompts();
  validateChannelBindings(bindings, prompts, channel);
  const byPromptId = new Map(prompts.map((p) => [p.promptId, p]));
  const hardById = new Map(CS_CHECKLIST.map((c) => [c.id, c]));
  const source = await listSourceCriteria().catch(() => [] as SourceCriterion[]);
  const sourceById = new Map(source.map((s) => [s.id, s]));

  return targets.map((b) => {
    const p =
      byPromptId.get(b.promptId);
    const hard = hardById.get(b.criterionId);
    const s = sourceById.get(b.criterionId);
    const fields = p?.fields ?? {};
    return {
      id: b.criterionId,
      category: p?.category || hard?.category || s?.parentName || "",
      label: p?.label || hard?.label || s?.name || String(b.criterionId),
      hint: fields.definition || "",
      fields,
      reviewScope: p?.reviewScope ?? hard?.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE,
    };
  });
}

export function countPromptsByCriterion(prompts: CriterionPrompt[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of prompts) m.set(p.criterionId, (m.get(p.criterionId) ?? 0) + 1);
  return m;
}

/**
 * 기준 id → 표시 라벨 맵.
 * 우선순위: AI 평가 항목(최신 프롬프트) label → 원본 뷰 name → CS_CHECKLIST → (없음)
 */
export async function resolveCriterionLabelMap(): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  for (const c of CS_CHECKLIST) m.set(c.id, c.label);

  const [source, prompts] = await Promise.all([
    listSourceCriteria().catch(() => [] as SourceCriterion[]),
    listCriterionPrompts().catch(() => [] as CriterionPrompt[]),
  ]);

  for (const s of source) {
    if (s.name?.trim()) m.set(s.id, s.name.trim());
  }

  const latestByCrit = new Map<number, CriterionPrompt>();
  for (const p of prompts) {
    const cur = latestByCrit.get(p.criterionId);
    if (!cur || p.updatedAt > cur.updatedAt) latestByCrit.set(p.criterionId, p);
  }
  for (const [id, p] of latestByCrit) {
    if (p.label?.trim()) m.set(id, p.label.trim());
  }

  return m;
}

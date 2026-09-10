import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq, promptBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
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

const FIELD_TABLE = promptBq.tables.fieldConfig;
const CRIT_TABLE = promptBq.tables.criterionPrompts;
const loc = () => (promptBq.location ? { location: promptBq.location } : {});
const growthLoc = () => (growthBq.location ? { location: growthBq.location } : {});

const FIELD_SCHEMA = [
  { name: "key", type: "STRING", mode: "REQUIRED" },
  { name: "label", type: "STRING", mode: "NULLABLE" },
  { name: "sort_order", type: "INTEGER", mode: "NULLABLE" },
  { name: "enabled", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "updated_by", type: "STRING", mode: "NULLABLE" },
] as const;

const CRIT_SCHEMA = [
  { name: "prompt_id", type: "STRING", mode: "REQUIRED" },
  { name: "criterion_id", type: "INTEGER", mode: "REQUIRED" },
  { name: "version_label", type: "STRING", mode: "NULLABLE" },
  { name: "category", type: "STRING", mode: "NULLABLE" },
  { name: "label", type: "STRING", mode: "NULLABLE" },
  { name: "fields_json", type: "STRING", mode: "NULLABLE" },
  { name: "review_scope", type: "STRING", mode: "NULLABLE" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "updated_by", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureCriterionTables(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const bq = getBQ();
      const ds = bq.dataset(promptBq.dataset, { projectId: promptBq.projectId });
      const [dsExists] = await ds.exists();
      if (!dsExists) {
        await ds.create({ location: promptBq.location ?? "US" }).catch((e) => {
          if (!isAlreadyExists(e)) throw e;
        });
      }
      for (const [name, schema] of [
        [FIELD_TABLE, FIELD_SCHEMA],
        [CRIT_TABLE, CRIT_SCHEMA],
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
      await addColumnsIfMissing(
        ds.table(CRIT_TABLE),
        [
          { name: "prompt_id", type: "STRING" },
          { name: "version_label", type: "STRING" },
          { name: "review_scope", type: "STRING" },
        ],
        { location: promptBq.location ?? undefined, logTag: "criterionStore" },
      );
      await seedDraftCriterionPromptsFromChecklist();
    })().catch((e) => {
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
  await ensureCriterionTablesCore();
  const existing = await listCriterionPrompts();
  const latestByCrit = new Map<number, (typeof existing)[number]>();
  for (const p of existing) {
    const cur = latestByCrit.get(p.criterionId);
    if (!cur || p.updatedAt > cur.updatedAt) latestByCrit.set(p.criterionId, p);
  }

  const missing = CS_CHECKLIST.filter((c) => {
    const latest = latestByCrit.get(c.id);
    if (!latest) return true;
    return !hasExampleFields(latest.fields);
  });
  if (!missing.length) return 0;

  const sql = promptBq.sql(CRIT_TABLE);
  const updatedAt = new Date().toISOString();
  const values = missing
    .map(
      (_, i) =>
        `(@prompt_id_${i}, @criterion_id_${i}, @version_label_${i}, @category_${i}, @label_${i}, @fields_json_${i}, timestamp(@updated_at), @updated_by)`,
    )
    .join(",\n");
  const params: Record<string, string | number> = {
    updated_at: updatedAt,
    updated_by: "system-seed-ref-0803",
  };
  const types: Record<string, string> = {
    updated_at: "STRING",
    updated_by: "STRING",
  };
  missing.forEach((c, i) => {
    params[`prompt_id_${i}`] = randomUUID();
    params[`criterion_id_${i}`] = c.id;
    params[`version_label_${i}`] = "v1-ref-0803";
    params[`category_${i}`] = c.category;
    params[`label_${i}`] = c.label;
    params[`fields_json_${i}`] = JSON.stringify(checklistFields(c));
    types[`prompt_id_${i}`] = "STRING";
    types[`criterion_id_${i}`] = "INT64";
    types[`version_label_${i}`] = "STRING";
    types[`category_${i}`] = "STRING";
    types[`label_${i}`] = "STRING";
    types[`fields_json_${i}`] = "STRING";
  });
  await getBQ().query({
    query: `
      insert into ${sql}
        (prompt_id, criterion_id, version_label, category, label, fields_json, updated_at, updated_by)
      values ${values}
    `,
    params,
    types,
    ...loc(),
  });
  const n = missing.length;
  console.log(`[criterionStore] seeded ${n} ref-0803 prompts into ${promptBq.fq(CRIT_TABLE)}`);
  return n;
}

/** ensure 본문만 (시드 재귀 방지용) */
async function ensureCriterionTablesCore(): Promise<void> {
  // ensureCriterionTables 가 이미 돌고 있으면 테이블은 존재한다고 가정
  const bq = getBQ();
  const ds = bq.dataset(promptBq.dataset, { projectId: promptBq.projectId });
  const [dsExists] = await ds.exists();
  if (!dsExists) {
    await ds.create({ location: promptBq.location ?? "US" }).catch((e) => {
      if (!isAlreadyExists(e)) throw e;
    });
  }
  for (const [name, schema] of [
    [FIELD_TABLE, FIELD_SCHEMA],
    [CRIT_TABLE, CRIT_SCHEMA],
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
}

export async function listSourceCriteria(): Promise<SourceCriterion[]> {
  const viewSql = growthBq.criteriaSql();
  if (!viewSql) return [];
  const [rows] = await getBQ().query({
    query: `
      select id, type, parent_name, name, parent_id, extra
      from ${viewSql}
      order by parent_name, id
    `,
    ...growthLoc(),
  });
  return (rows as Record<string, unknown>[]).map((r) => ({
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
    const sql = promptBq.sql(FIELD_TABLE);
    const [rows] = await getBQ().query({
      query: `
        select key, label, sort_order, enabled
        from ${sql}
        qualify row_number() over (partition by key order by updated_at desc) = 1
        order by sort_order, key
      `,
      ...loc(),
    });
    const list = (rows as Record<string, unknown>[]).map((r) => ({
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
  const sql = promptBq.sql(FIELD_TABLE);
  await getBQ().query({
    query: `
      insert into ${sql} (key, label, sort_order, enabled, updated_at, updated_by)
      values (@key, @label, @sort_order, @enabled, timestamp(@updated_at), @updated_by)
    `,
    params: {
      key: field.key,
      label: field.label,
      sort_order: field.sortOrder,
      enabled: field.enabled,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    ...loc(),
  });
}

export async function saveFieldKeys(fields: PromptFieldKey[], updatedBy: string): Promise<void> {
  for (const f of fields) await upsertFieldKey(f, updatedBy);
}

/** 모든 항목 프롬프트 버전 (1:N) */
export async function listCriterionPrompts(): Promise<CriterionPrompt[]> {
  try {
    const sql = promptBq.sql(CRIT_TABLE);
    let rows;
    try {
      [rows] = await getBQ().query({
        query: `
          select prompt_id, criterion_id, version_label, category, label, fields_json, review_scope, updated_at, updated_by
          from ${sql}
          order by criterion_id, updated_at desc
        `,
        ...loc(),
      });
    } catch (e) {
      // 기존 테이블에 review_scope 컬럼이 아직 없는 경우에도 기존 프롬프트는 읽는다.
      if (!/review_scope|unrecognized name|column/i.test(e instanceof Error ? e.message : String(e))) throw e;
      [rows] = await getBQ().query({
        query: `
          select prompt_id, criterion_id, version_label, category, label, fields_json, updated_at, updated_by
          from ${sql}
          order by criterion_id, updated_at desc
        `,
        ...loc(),
      });
    }
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
  const sql = promptBq.sql(CRIT_TABLE);
  await getBQ().query({
    query: `
      insert into ${sql}
        (prompt_id, criterion_id, version_label, category, label, fields_json, review_scope, updated_at, updated_by)
      values
        (@prompt_id, @criterion_id, @version_label, @category, @label, @fields_json, @review_scope, timestamp(@updated_at), @updated_by)
    `,
    params: {
      prompt_id: promptId,
      criterion_id: input.criterionId,
      version_label: versionLabel,
      category: input.category,
      label: input.label,
      fields_json: JSON.stringify(input.fields),
      review_scope: input.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE,
      updated_at: updatedAt,
      updated_by: input.updatedBy,
    },
    ...loc(),
  });
  return {
    promptId,
    criterionId: input.criterionId,
    versionLabel,
    category: input.category,
    label: input.label,
    fields: input.fields,
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
    reviewScope: hasExplicitScope ? parseCriterionReviewScope(rawScope) : undefined,
    updatedAt,
    updatedBy: String(r.updated_by ?? ""),
  };
}

/** 평가셋 바인딩 → 렌더용 CsCriterion[] (기준당 지정된 프롬프트 1개) */
export async function buildCriteriaSnapshot(bindings: EvalCriterionBinding[]): Promise<CsCriterion[]> {
  const enabled = bindings.filter((b) => b.enabled);
  // 바인딩 없으면 CS_CHECKLIST 전체로 초안 스냅샷
  const targets: EvalCriterionBinding[] = enabled.length
    ? enabled
    : CS_CHECKLIST.map((c) => ({ criterionId: c.id, promptId: "", enabled: true }));

  await seedDraftCriterionPromptsFromChecklist().catch((e) =>
    console.warn("[criterionStore] seed before snapshot:", e instanceof Error ? e.message : e),
  );

  const prompts = await listCriterionPrompts();
  const byPromptId = new Map(prompts.map((p) => [p.promptId, p]));
  const latestByCrit = new Map<number, CriterionPrompt>();
  for (const p of prompts) {
    const cur = latestByCrit.get(p.criterionId);
    if (!cur || p.updatedAt > cur.updatedAt) latestByCrit.set(p.criterionId, p);
  }
  const hardById = new Map(CS_CHECKLIST.map((c) => [c.id, c]));
  const source = await listSourceCriteria().catch(() => [] as SourceCriterion[]);
  const sourceById = new Map(source.map((s) => [s.id, s]));

  return targets.map((b) => {
    const p =
      (b.promptId ? byPromptId.get(b.promptId) : undefined) ?? latestByCrit.get(b.criterionId);
    const hard = hardById.get(b.criterionId);
    const s = sourceById.get(b.criterionId);
    const fields =
      p?.fields && Object.keys(p.fields).length
        ? p.fields
        : hard
          ? { definition: hard.hint, good: "", bad: "", exception: "" }
          : {};
    return {
      id: b.criterionId,
      category: p?.category || hard?.category || s?.parentName || "",
      label: p?.label || hard?.label || s?.name || String(b.criterionId),
      hint: fields.definition || hard?.hint || "",
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

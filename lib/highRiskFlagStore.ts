import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq, promptBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import { cached, cacheInvalidate, SERVER_CACHE_TTL } from "./serverCache";
import type { CallQualityOrg } from "./callQualityOrg";
import {
  DEFAULT_HIGH_RISK_RULES,
  parseHighRiskFlagRule,
  type HighRiskFlagKind,
  type HighRiskFlagRule,
} from "./highRiskFlags";

const TABLE = promptBq.tables.highRiskFlagRules;
const loc = () => (promptBq.location ? { location: promptBq.location } : {});
const sql = () => promptBq.sql(TABLE);
const tableRef = () =>
  getBQ().dataset(promptBq.dataset, { projectId: promptBq.projectId }).table(TABLE);

const SCHEMA = [
  { name: "rule_id", type: "STRING", mode: "REQUIRED" },
  { name: "key", type: "STRING", mode: "REQUIRED" },
  { name: "label", type: "STRING", mode: "NULLABLE" },
  { name: "enabled", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "kind", type: "STRING", mode: "REQUIRED" },
  { name: "params_json", type: "STRING", mode: "NULLABLE" },
  { name: "sort_order", type: "INTEGER", mode: "NULLABLE" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "updated_by", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureHighRiskFlagTables(): Promise<void> {
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
      const t = tableRef();
      const [exists] = await t.exists();
      if (!exists) {
        await t
          .create({ schema: SCHEMA as unknown as { name: string; type: string; mode: string }[] })
          .catch((e) => {
            if (!isAlreadyExists(e)) throw e;
          });
      } else {
        await addColumnsIfMissing(t, [...SCHEMA], { location: promptBq.location, logTag: "highRiskFlagStore" });
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

function tsValue(updated: unknown): string {
  if (updated && typeof updated === "object" && "value" in (updated as object)) {
    return String((updated as { value: string }).value);
  }
  return String(updated ?? "");
}

function rowToRule(r: Record<string, unknown>): HighRiskFlagRule | null {
  let params: unknown = {};
  try {
    params = JSON.parse(String(r.params_json ?? "{}"));
  } catch {
    params = {};
  }
  return parseHighRiskFlagRule({
    ruleId: r.rule_id,
    key: r.key,
    label: r.label,
    enabled: r.enabled,
    kind: r.kind,
    params,
    sortOrder: r.sort_order,
    updatedAt: tsValue(r.updated_at),
    updatedBy: r.updated_by,
  });
}

async function seedDefaults(by: string): Promise<HighRiskFlagRule[]> {
  const now = new Date().toISOString();
  const rules: HighRiskFlagRule[] = DEFAULT_HIGH_RISK_RULES.map((d, i) => ({
    ...d,
    ruleId: randomUUID(),
    updatedAt: now,
    updatedBy: by,
    sortOrder: d.sortOrder || i + 1,
  }));
  for (const rule of rules) {
    await insertRule(rule);
  }
  return rules;
}

async function insertRule(rule: HighRiskFlagRule): Promise<void> {
  await getBQ().query({
    query: `
      insert into ${sql()} (
        rule_id, key, label, enabled, kind, params_json, sort_order, updated_at, updated_by
      ) values (
        @rule_id, @key, @label, @enabled, @kind, @params_json, @sort_order, timestamp(@updated_at), @updated_by
      )
    `,
    params: {
      rule_id: rule.ruleId,
      key: rule.key,
      label: rule.label,
      enabled: rule.enabled,
      kind: rule.kind,
      params_json: JSON.stringify(rule.params ?? {}),
      sort_order: rule.sortOrder,
      updated_at: rule.updatedAt,
      updated_by: rule.updatedBy,
    },
    types: {
      rule_id: "STRING",
      key: "STRING",
      label: "STRING",
      enabled: "BOOL",
      kind: "STRING",
      params_json: "STRING",
      sort_order: "INT64",
      updated_at: "STRING",
      updated_by: "STRING",
    },
    ...loc(),
  });
}

/** 최신 스냅샷(키별 최신 1건). 비면 기본 규칙 시드. */
export async function listHighRiskFlagRules(opts?: { seedBy?: string }): Promise<HighRiskFlagRule[]> {
  return cached("high-risk-rules", SERVER_CACHE_TTL.highRiskRules, async () => {
  await ensureHighRiskFlagTables();
  const [rows] = await getBQ().query({
    query: `
      select rule_id, key, label, enabled, kind, params_json, sort_order, updated_at, updated_by
      from ${sql()}
      qualify row_number() over (partition by key order by updated_at desc) = 1
      order by sort_order asc, key asc
    `,
    ...loc(),
  });
  const rules = (rows as Record<string, unknown>[])
    .map(rowToRule)
    .filter((r): r is HighRiskFlagRule => r != null);
  if (!rules.length) {
    return seedDefaults(opts?.seedBy ?? "system");
  }
  return rules;
  });
}

export async function upsertHighRiskFlagRules(
  rules: Array<{
    ruleId?: string;
    key: string;
    label: string;
    enabled: boolean;
    kind: HighRiskFlagKind;
    params: HighRiskFlagRule["params"];
    sortOrder: number;
  }>,
  updatedBy: string,
): Promise<HighRiskFlagRule[]> {
  await ensureHighRiskFlagTables();
  const now = new Date().toISOString();
  const out: HighRiskFlagRule[] = [];
  for (const [i, r] of rules.entries()) {
    const rule: HighRiskFlagRule = {
      ruleId: (r.ruleId ?? "").trim() || randomUUID(),
      key: r.key.trim(),
      label: r.label.trim() || r.key.trim(),
      enabled: r.enabled !== false,
      kind: r.kind,
      params: r.params ?? {},
      sortOrder: Number.isFinite(r.sortOrder) ? r.sortOrder : i + 1,
      updatedAt: now,
      updatedBy,
    };
    if (!rule.key) continue;
    await insertRule(rule);
    out.push(rule);
  }
  cacheInvalidate("high-risk-rules");
  return out;
}

const CASES_SQL = growthBq.casesSql();
const CID = "json_value(case_content, '$.genesys_conversation_id')";
const CALL_START_TS = "safe_cast(json_value(case_content, '$.call_start') as timestamp)";
const CALL_DATE_KST = `format_date('%F', date(${CALL_START_TS}, 'Asia/Seoul'))`;
const CALL_END_TS = "safe_cast(json_value(case_content, '$.call_end') as timestamp)";
const MINUTES = "safe_cast(json_value(case_content, '$.minutes_taken') as float64)";
const DURATION_SEC = `coalesce(
  if(timestamp_diff(${CALL_END_TS}, ${CALL_START_TS}, second) > 0,
     timestamp_diff(${CALL_END_TS}, ${CALL_START_TS}, second), null),
  if(${MINUTES} > 0, cast(round(${MINUTES} * 60) as int64), null)
)`;

/** 팀·일간 상위 percentile + 선택적 최소 분. conversation_id 집합. */
export async function listLongCallConversationIds(opts: {
  percentile: number;
  minMinutes?: number | null;
  limit?: number;
  callDateStart?: string | null;
  callDateEnd?: string | null;
  teams?: string[];
}): Promise<string[]> {
  const percentile = Math.min(Math.max(Number(opts.percentile) || 10, 1), 50);
  const thresholdRank = Math.max(0, Math.min(100, 100 - percentile)) / 100;
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 500) || 500, 1), 2000);
  const where: string[] = ["year_month >= '2026-04-01'", `${CID} is not null`, `${DURATION_SEC} is not null`];
  const params: Record<string, unknown> = {
    limit: lim,
    threshold_rank: thresholdRank,
  };
  const types: Record<string, string> = {
    limit: "INT64",
    threshold_rank: "FLOAT64",
  };

  if (opts.callDateStart) {
    where.push(`${CALL_DATE_KST} >= @callDateStart`);
    params.callDateStart = opts.callDateStart;
  }
  if (opts.callDateEnd) {
    where.push(`${CALL_DATE_KST} <= @callDateEnd`);
    params.callDateEnd = opts.callDateEnd;
  }
  const teams = (opts.teams ?? []).map((t) => t.trim()).filter(Boolean);
  if (teams.length) {
    where.push(`json_value(case_content, '$.operator_renewal_team_name') in unnest(@teams)`);
    params.teams = teams;
  }
  if (opts.minMinutes != null && Number.isFinite(Number(opts.minMinutes))) {
    where.push(`${DURATION_SEC} >= @min_sec`);
    params.min_sec = Math.round(Number(opts.minMinutes) * 60);
    types.min_sec = "INT64";
  }

  const query = `
    with base as (
      select
        ${CID} as conversation_id,
        json_value(case_content, '$.operator_renewal_team_name') as team,
        ${CALL_DATE_KST} as call_date,
        ${DURATION_SEC} as duration_sec
      from ${CASES_SQL}
      where ${where.join("\n        and ")}
      qualify row_number() over (partition by ${CID} order by inquiry_created_at_kst desc) = 1
    ),
    ranked as (
      select
        conversation_id,
        team,
        call_date,
        duration_sec,
        percent_rank() over (
          partition by ifnull(team, ''), call_date
          order by duration_sec
        ) as pr
      from base
      where duration_sec > 0
    )
    select conversation_id
    from ranked
    where pr >= @threshold_rank
    order by duration_sec desc
    limit @limit
  `;

  try {
    const [rows] = await getBQ().query({
      query,
      params,
      types,
      ...(growthBq.location ? { location: growthBq.location } : {}),
    });
    return (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id)).filter(Boolean);
  } catch (e) {
    console.error("[highRiskFlagStore] listLongCall:", e);
    return [];
  }
}

/** 결과 테이블에 저장된 메트릭 기반 고위험 플래그가 있는 conversation. */
export async function listMetricHighRiskConversationIds(
  org: CallQualityOrg,
  opts?: { limit?: number },
): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(opts?.limit ?? 500) || 500, 1), 2000);
  const resultsSql = growthBq.resultsSql(growthBq.resultsTable);
  try {
    const [rows] = await getBQ().query({
      query: `
        select conversation_id
        from ${resultsSql}
        where org = @org
          and conversation_id is not null and conversation_id != ''
          and high_risk_flags_json is not null
          and high_risk_flags_json != '[]'
          and high_risk_flags_json != ''
        qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
        order by analyzed_at desc
        limit @limit
      `,
      params: { org, limit: lim },
      types: { org: "STRING", limit: "INT64" },
      ...(growthBq.location ? { location: growthBq.location } : {}),
    });
    return (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id)).filter(Boolean);
  } catch (e) {
    // 컬럼 미존재 등 — 빈 결과
    console.warn("[highRiskFlagStore] listMetricHighRisk:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** 고위험군 필터용 conversation id 합집합. */
export async function listHighRiskConversationIds(
  org: CallQualityOrg,
  opts?: {
    limit?: number;
    callDateStart?: string | null;
    callDateEnd?: string | null;
    teams?: string[];
  },
): Promise<{ ids: string[]; longCallIds: Set<string> }> {
  const rules = await listHighRiskFlagRules();
  const longRule = rules.find((r) => r.enabled && r.kind === "long_call_percentile");
  const lim = opts?.limit ?? 500;
  const [longIds, metricIds] = await Promise.all([
    longRule
      ? listLongCallConversationIds({
          percentile: Number(longRule.params.percentile ?? 10),
          minMinutes: longRule.params.minMinutes ?? null,
          limit: lim,
          callDateStart: opts?.callDateStart,
          callDateEnd: opts?.callDateEnd,
          teams: opts?.teams,
        })
      : Promise.resolve([] as string[]),
    listMetricHighRiskConversationIds(org, { limit: lim }),
  ]);
  const longCallIds = new Set(longIds);
  const ids = [...new Set([...longIds, ...metricIds])];
  return { ids, longCallIds };
}

import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { csatBq, growthBq, promptBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import { cached, cacheInvalidate, SERVER_CACHE_TTL } from "./serverCache";
import type { CallQualityOrg } from "./callQualityOrg";
import {
  DEFAULT_HIGH_RISK_RULES,
  parseHighRiskFlagRule,
  resolveDsatRule,
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
const PHONE_INQUIRY_ID = "json_value(case_content, '$.상담이력 ID')";
const CALL_START_TS = "safe_cast(json_value(case_content, '$.call_start') as timestamp)";
const CALL_DATE_KST = `format_date('%F', date(${CALL_START_TS}, 'Asia/Seoul'))`;
const CALL_END_TS = "safe_cast(json_value(case_content, '$.call_end') as timestamp)";
const MINUTES = "safe_cast(json_value(case_content, '$.minutes_taken') as float64)";
const DURATION_SEC = `coalesce(
  if(timestamp_diff(${CALL_END_TS}, ${CALL_START_TS}, second) > 0,
     timestamp_diff(${CALL_END_TS}, ${CALL_START_TS}, second), null),
  if(${MINUTES} > 0, cast(round(${MINUTES} * 60) as int64), null)
)`;

/**
 * 저장된 장콜 임계분(직전 7일 MA) 이상으로 긴 통화의 conversation_id.
 * 요청마다 percent_rank를 돌리지 않는다 — getOrRefreshLongCallThreshold 결과 사용.
 */
export async function listLongCallConversationIds(opts: {
  percentile: number;
  minMinutes?: number | null;
  limit?: number;
  callDateStart?: string | null;
  callDateEnd?: string | null;
  teams?: string[];
  /** 이미 가져온 임계분(분). 없으면 DB/재계산 */
  thresholdMinutes?: number | null;
  ruleKey?: string;
}): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 500) || 500, 1), 2000);

  let thresholdMinutes = opts.thresholdMinutes;
  if (thresholdMinutes == null || !Number.isFinite(Number(thresholdMinutes)) || Number(thresholdMinutes) <= 0) {
    const { getOrRefreshLongCallThreshold } = await import("./longCallThresholdStore");
    const snap = await getOrRefreshLongCallThreshold({
      percentile: opts.percentile,
      ruleKey: opts.ruleKey ?? "long_call",
    });
    thresholdMinutes = snap?.thresholdMinutes ?? null;
  }
  if (thresholdMinutes == null || !(Number(thresholdMinutes) > 0)) return [];

  const where: string[] = [
    "year_month >= '2026-04-01'",
    `${CID} is not null`,
    `${DURATION_SEC} is not null`,
    `${DURATION_SEC} >= @threshold_sec`,
  ];
  const params: Record<string, unknown> = {
    limit: lim,
    threshold_sec: Math.round(Number(thresholdMinutes) * 60),
  };
  const types: Record<string, string> = {
    limit: "INT64",
    threshold_sec: "INT64",
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
    // 규칙 minMinutes와 MA 임계분 중 더 큰 쪽을 실질 하한으로 쓴다.
    const minSec = Math.round(Number(opts.minMinutes) * 60);
    if (minSec > Number(params.threshold_sec)) {
      params.threshold_sec = minSec;
    }
  }

  const query = `
    with base as (
      select
        ${CID} as conversation_id,
        ${DURATION_SEC} as duration_sec
      from ${CASES_SQL}
      where ${where.join("\n        and ")}
      qualify row_number() over (partition by ${CID} order by inquiry_created_at_kst desc) = 1
    )
    select conversation_id
    from base
    where duration_sec > 0
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

/**
 * CSAT 점수가 주어진 집합에 드는 통화의 conversation_id.
 * 케이스(상담이력 ID) ↔ CSAT(inquiry_id, PhoneInquiry, dup_no=1) 매핑으로 찾는다.
 * `includeNone`이면 설문 미참여 건도 함께 (점수 조건과 OR).
 * 날짜·팀 필터는 케이스 쪽 기준(장콜과 동일).
 */
export async function listConversationIdsByCsatRates(opts: {
  rates: number[];
  includeNone?: boolean;
  limit?: number;
  callDateStart?: string | null;
  callDateEnd?: string | null;
  teams?: string[];
}): Promise<string[]> {
  // 1~5 정수만 남겨 SQL에 직접 넣는다(값 자체를 검증하므로 주입 위험 없음 —
  // 배열 파라미터 타입 추론(FLOAT64/INT64) 문제를 피하려는 것).
  const rates = [...new Set(opts.rates.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5))].sort();
  const includeNone = opts.includeNone === true;
  if (!rates.length && !includeNone) return [];
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 500) || 500, 1), 2000);
  const where: string[] = ["year_month >= '2026-04-01'", `${CID} is not null`, `${PHONE_INQUIRY_ID} is not null`];
  const params: Record<string, unknown> = { limit: lim };
  const types: Record<string, string> = { limit: "INT64" };

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

  const rateIn = rates.length ? `rate in (${rates.join(", ")})` : "false";
  // 미참여를 포함할 때만 left join이 필요하다. 아니면 CTE에서 미리 걸러 스캔을 줄인다.
  const csatWhere = includeNone ? "" : `
        and rate is not null and ${rateIn}`;
  const joinKind = includeNone ? "left join" : "join";
  const match = includeNone
    ? `((d.rate is not null and ${rateIn}) or d.inquiry_id is null)`
    : "true";
  const query = `
    with cases as (
      select
        ${CID} as conversation_id,
        safe_cast(${PHONE_INQUIRY_ID} as int64) as inquiry_id,
        inquiry_created_at_kst
      from ${CASES_SQL}
      where ${where.join("\n        and ")}
      qualify row_number() over (partition by ${CID} order by inquiry_created_at_kst desc) = 1
    ),
    csat as (
      select inquiry_id, rate
      from ${csatBq.rawlogSql()}
      where dup_no = 1
        and inquiry_type = 'PhoneInquiry'${csatWhere}
    )
    select c.conversation_id
    from cases c
    ${joinKind} csat d using (inquiry_id)
    where c.inquiry_id is not null
      and ${match}
    order by c.inquiry_created_at_kst desc
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
    // CSAT은 부가 정보 — 실패해도 고위험군 필터 자체는 살아 있어야 한다.
    console.warn("[highRiskFlagStore] listCsatRates:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 결과 테이블에 저장된 메트릭 기반 고위험 플래그가 있는 conversation.
 * `keys`를 주면 저장된 플래그 중 그 키가 하나라도 있는 건만.
 */
export async function listMetricHighRiskConversationIds(
  org: CallQualityOrg,
  opts?: { limit?: number; keys?: string[] },
): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(opts?.limit ?? 500) || 500, 1), 2000);
  const keys = [...new Set((opts?.keys ?? []).map((k) => k.trim()).filter(Boolean))];
  const resultsSql = growthBq.resultsSql(growthBq.resultsTable);
  const keyClause = keys.length
    ? `and exists(
            select 1 from unnest(json_query_array(high_risk_flags_json, '$')) f
            where json_value(f, '$.key') in unnest(@keys)
          )`
    : "";
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
          ${keyClause}
        qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
        order by analyzed_at desc
        limit @limit
      `,
      params: keys.length ? { org, limit: lim, keys } : { org, limit: lim },
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

/**
 * 고위험군 필터용 conversation id 합집합.
 * `keys`를 주면 그 플래그에 해당하는 통화만(선택한 것 중 하나라도 = OR).
 */
export async function listHighRiskConversationIds(
  org: CallQualityOrg,
  opts?: {
    limit?: number;
    callDateStart?: string | null;
    callDateEnd?: string | null;
    teams?: string[];
    keys?: string[];
  },
): Promise<{ ids: string[]; longCallIds: Set<string> }> {
  const rules = await listHighRiskFlagRules();
  const longRule = rules.find((r) => r.enabled && r.kind === "long_call_percentile");
  const dsatRule = resolveDsatRule(rules);
  const picked = new Set((opts?.keys ?? []).map((k) => k.trim()).filter(Boolean));
  const wants = (key: string) => picked.size === 0 || picked.has(key);
  // 메트릭 기반 규칙(장콜·DSAT 제외) 중 선택된 것
  const metricKeys = rules
    .filter((r) => r.enabled && (r.kind === "agent_speak_ratio" || r.kind === "sentiment_agitated"))
    .map((r) => r.key)
    .filter(wants);
  const lim = opts?.limit ?? 500;
  const longOpts =
    longRule && wants(longRule.key)
      ? {
          percentile: Number(longRule.params.percentile ?? 10),
          minMinutes: longRule.params.minMinutes ?? null,
          limit: lim,
          callDateStart: opts?.callDateStart,
          callDateEnd: opts?.callDateEnd,
          teams: opts?.teams,
          ruleKey: longRule.key,
        }
      : null;
  const [longIds, metricIds, dsatList] = await Promise.all([
    longOpts ? listLongCallConversationIds(longOpts) : Promise.resolve([] as string[]),
    picked.size && !metricKeys.length
      ? Promise.resolve([] as string[])
      : listMetricHighRiskConversationIds(org, {
          limit: lim,
          ...(picked.size ? { keys: metricKeys } : {}),
        }),
    dsatRule.enabled && wants(dsatRule.key)
      ? listConversationIdsByCsatRates({
          // DSAT = 기준 점수 이하 → 1..maxRate
          rates: Array.from({ length: Math.max(0, Math.floor(dsatRule.maxRate)) }, (_, i) => i + 1),
          limit: lim,
          callDateStart: opts?.callDateStart,
          callDateEnd: opts?.callDateEnd,
          teams: opts?.teams,
        })
      : Promise.resolve([] as string[]),
  ]);
  // DSAT 뱃지는 목록 조회에서 CSAT 점수로 직접 계산한다 — 여기서는 필터 풀에만 합친다.
  const longCallIds = new Set(longIds);
  const ids = [...new Set([...longIds, ...metricIds, ...dsatList])];
  return { ids, longCallIds };
}

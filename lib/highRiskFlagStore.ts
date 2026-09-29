import { randomUUID } from "node:crypto";
import { promptBq } from "./bqRefs";
import { servingRows } from "./servingDb";
import { cached, cacheInvalidate, SERVER_CACHE_TTL } from "./serverCache";
import type { EvaluationChannel } from "./evaluationChannel";
import {
  DEFAULT_HIGH_RISK_CHANNEL,
  DEFAULT_HIGH_RISK_RULES,
  parseHighRiskFlagRule,
  resolveDsatRule,
  resolveHighRiskFlagChannel,
  type HighRiskFlagKind,
  type HighRiskFlagRule,
} from "./highRiskFlags";

const TABLE = promptBq.tables.highRiskFlagRules;
// 고위험 플래그 규칙. 원천은 서빙 Postgres(테이블 이름은 BQ 와 같다), BQ 는 야간 덤프 사본.

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
    channel: r.channel,
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
  await servingRows(
    `
      insert into ${TABLE} (
        rule_id, "key", label, enabled, channel, kind, params_json, sort_order, updated_at, updated_by
      ) values (
        @rule_id, @key, @label, @enabled, @channel, @kind, @params_json, @sort_order, @updated_at::timestamptz, @updated_by
      )
    `,
    {
      rule_id: rule.ruleId,
      key: rule.key,
      label: rule.label,
      enabled: rule.enabled,
      channel: rule.channel,
      kind: rule.kind,
      params_json: JSON.stringify(rule.params ?? {}),
      sort_order: rule.sortOrder,
      updated_at: rule.updatedAt,
      updated_by: rule.updatedBy,
    },
  );
}

/**
 * 최신 스냅샷(채널+키별 최신 1건). 비면 기본 규칙 시드.
 * `channel`을 주면 그 채널 규칙만 — 콜 규칙이 문의 평가에 새지 않게 호출부에서 좁혀 쓴다.
 */
export async function listHighRiskFlagRules(opts?: {
  seedBy?: string;
  channel?: EvaluationChannel;
}): Promise<HighRiskFlagRule[]> {
  const all = await cached("high-risk-rules", SERVER_CACHE_TTL.highRiskRules, async () => {
    const rows = await servingRows(`
      select * from (
        select distinct on (coalesce(channel, '${DEFAULT_HIGH_RISK_CHANNEL}'), "key")
          rule_id, "key", label, enabled, channel, kind, params_json, sort_order, updated_at, updated_by
        from ${TABLE}
        order by coalesce(channel, '${DEFAULT_HIGH_RISK_CHANNEL}'), "key", updated_at desc
      ) latest
      order by sort_order asc nulls first, "key" collate "C" asc
    `);
    const rules = rows
      .map(rowToRule)
      .filter((r): r is HighRiskFlagRule => r != null);
    if (!rules.length) {
      return seedDefaults(opts?.seedBy ?? "system");
    }
    return rules;
  });
  return opts?.channel ? all.filter((r) => r.channel === opts.channel) : all;
}

export async function upsertHighRiskFlagRules(
  rules: Array<{
    ruleId?: string;
    key: string;
    label: string;
    enabled: boolean;
    channel?: EvaluationChannel;
    kind: HighRiskFlagKind;
    params: HighRiskFlagRule["params"];
    sortOrder: number;
  }>,
  updatedBy: string,
): Promise<HighRiskFlagRule[]> {
  const now = new Date().toISOString();
  const out: HighRiskFlagRule[] = [];
  for (const [i, r] of rules.entries()) {
    const rule: HighRiskFlagRule = {
      ruleId: (r.ruleId ?? "").trim() || randomUUID(),
      key: r.key.trim(),
      label: r.label.trim() || r.key.trim(),
      enabled: r.enabled !== false,
      channel: resolveHighRiskFlagChannel(r.kind, r.channel),
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

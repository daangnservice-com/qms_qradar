import type { HighRiskFlagHit, MetricDetail } from "./types";

/** 고위험 플래그 키 — DSAT는 목록 조회에서 CSAT 점수로 계산한다(장콜과 동일한 패턴). */
export const DSAT_FLAG_KEY = "dsat";
/** DSAT 기본 기준 — CSAT 점수가 이 값 이하면 불만족으로 본다. */
export const DSAT_DEFAULT_MAX_RATE = 2;

export type HighRiskFlagKind =
  | "long_call_percentile"
  | "agent_speak_ratio"
  | "sentiment_agitated"
  | "csat_dsat";

export interface HighRiskFlagRule {
  ruleId: string;
  key: string;
  label: string;
  enabled: boolean;
  kind: HighRiskFlagKind;
  /**
   * kind별 파라미터. long_call: percentile, minMinutes(AND 하한).
   * 실제 장콜 판정 임계분(분)은 long_call_thresholds 테이블의 직전 7일 MA 스냅샷을 쓴다.
   * agent_speak: minPercent / sentiment: metricKey / csat_dsat: maxRate
   */
  params: {
    percentile?: number | null;
    minMinutes?: number | null;
    minPercent?: number | null;
    metricKey?: string | null;
    maxRate?: number | null;
  };
  sortOrder: number;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_HIGH_RISK_RULES: Omit<HighRiskFlagRule, "ruleId" | "updatedAt" | "updatedBy">[] = [
  {
    key: "long_call",
    label: "장콜",
    enabled: true,
    kind: "long_call_percentile",
    params: { percentile: 10, minMinutes: null },
    sortOrder: 1,
  },
  {
    key: "agent_speak_high",
    label: "상담사 발화 과다",
    enabled: true,
    kind: "agent_speak_ratio",
    params: { minPercent: 70, metricKey: "agentSpeakRatio" },
    sortOrder: 2,
  },
  {
    key: "agitated",
    label: "격앙 감지",
    enabled: true,
    kind: "sentiment_agitated",
    params: { metricKey: "agitated" },
    sortOrder: 3,
  },
  {
    key: DSAT_FLAG_KEY,
    label: "DSAT",
    enabled: true,
    kind: "csat_dsat",
    params: { maxRate: DSAT_DEFAULT_MAX_RATE },
    sortOrder: 4,
  },
];

/**
 * DSAT 규칙 해석. 규칙 테이블이 이미 시드된 배포에는 csat_dsat 행이 없으므로
 * (시드는 테이블이 비었을 때만 돈다) 행이 없으면 기본값으로 켜진 것으로 본다.
 * 끄거나 기준을 바꾸려면 평가 설계 ▸ 고위험군 플래그에서 규칙을 저장하면 그쪽이 이긴다.
 */
export function resolveDsatRule(rules: HighRiskFlagRule[] | undefined | null): {
  enabled: boolean;
  maxRate: number;
  key: string;
} {
  const rule = (rules ?? []).find((r) => r.kind === "csat_dsat");
  if (!rule) return { enabled: true, maxRate: DSAT_DEFAULT_MAX_RATE, key: DSAT_FLAG_KEY };
  // null/빈값은 Number()가 0으로 바꿔 버려서 "아무것도 DSAT 아님"이 된다 — 기본값으로 되돌린다.
  const raw = rule.params.maxRate == null ? Number.NaN : Number(rule.params.maxRate);
  return {
    enabled: rule.enabled,
    maxRate: Number.isFinite(raw) ? raw : DSAT_DEFAULT_MAX_RATE,
    key: rule.key || DSAT_FLAG_KEY,
  };
}

/** 평가 결과 metrics 기준 플래그(장콜 제외 — 목록 조회에서 계산). */
export function matchMetricHighRiskFlags(
  rules: HighRiskFlagRule[],
  metrics: Record<string, MetricDetail> | undefined | null,
): HighRiskFlagHit[] {
  const hits: HighRiskFlagHit[] = [];
  const m = metrics ?? {};
  for (const rule of rules.filter((r) => r.enabled).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (rule.kind === "agent_speak_ratio") {
      const key = String(rule.params.metricKey ?? "agentSpeakRatio");
      const minPct = Number(rule.params.minPercent ?? 70);
      const raw = m[key]?.value;
      const pct = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(pct) && Number.isFinite(minPct) && pct >= minPct) {
        hits.push({
          key: rule.key,
          label: rule.label,
          reason: `${key}=${pct}% ≥ ${minPct}%`,
        });
      }
    } else if (rule.kind === "sentiment_agitated") {
      const key = String(rule.params.metricKey ?? "agitated");
      const raw = m[key]?.value;
      const on = raw === true || raw === "true" || raw === 1 || raw === "1";
      if (on) {
        hits.push({
          key: rule.key,
          label: rule.label,
          reason: m[key]?.comment?.trim() || `${key}=true`,
        });
      }
    }
  }
  return hits;
}

export function parseHighRiskFlagRule(raw: unknown): HighRiskFlagRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ruleId = String(o.ruleId ?? o.rule_id ?? "").trim();
  const key = String(o.key ?? "").trim();
  if (!ruleId || !key) return null;
  const kindRaw = String(o.kind ?? "").trim();
  const kind: HighRiskFlagKind =
    kindRaw === "agent_speak_ratio" ||
    kindRaw === "sentiment_agitated" ||
    kindRaw === "long_call_percentile" ||
    kindRaw === "csat_dsat"
      ? kindRaw
      : "long_call_percentile";
  const paramsRaw = (o.params && typeof o.params === "object" ? o.params : {}) as Record<string, unknown>;
  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    ruleId,
    key,
    label: String(o.label ?? key).trim() || key,
    enabled: o.enabled !== false,
    kind,
    params: {
      percentile: numOrNull(paramsRaw.percentile),
      minMinutes: numOrNull(paramsRaw.minMinutes),
      minPercent: numOrNull(paramsRaw.minPercent),
      metricKey: paramsRaw.metricKey != null ? String(paramsRaw.metricKey) : null,
      maxRate: numOrNull(paramsRaw.maxRate),
    },
    sortOrder: Number.isFinite(Number(o.sortOrder)) ? Number(o.sortOrder) : 0,
    updatedAt: String(o.updatedAt ?? o.updated_at ?? ""),
    updatedBy: String(o.updatedBy ?? o.updated_by ?? ""),
  };
}

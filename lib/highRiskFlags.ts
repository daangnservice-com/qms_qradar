import { isEvaluationChannel, type EvaluationChannel } from "./evaluationChannel";
import type { HighRiskFlagHit, MetricDetail } from "./types";

/** 고위험 플래그 키 — DSAT는 목록 조회에서 CSAT 점수로 계산한다(장콜과 동일한 패턴). */
export const DSAT_FLAG_KEY = "dsat";
/** DSAT 기본 기준 — CSAT 점수가 이 값 이하면 불만족으로 본다. */
export const DSAT_DEFAULT_MAX_RATE = 2;

export type HighRiskFlagKind =
  | "long_call_percentile"
  | "agent_speak_ratio"
  | "sentiment_agitated"
  | "csat_dsat"
  | "feedback_message_count";

/** 인앱 문의 스레드에서 셀 대상. */
export type FeedbackCountTarget = "feedback" | "reply" | "total";

/** 규칙이 붙는 채널. 채널 컬럼이 없던 시절 행은 전부 콜 규칙으로 읽는다. */
export const DEFAULT_HIGH_RISK_CHANNEL: EvaluationChannel = "phone";

/** 채널별로 고를 수 있는 종류. 콜 전용 신호(통화시간·발화비율)는 텍스트 채널에 없다. */
export const HIGH_RISK_CHANNEL_KINDS: Record<EvaluationChannel, HighRiskFlagKind[]> = {
  phone: ["long_call_percentile", "agent_speak_ratio", "sentiment_agitated", "csat_dsat"],
  feedback: ["feedback_message_count"],
  chatcs: [],
};

export interface HighRiskFlagRule {
  ruleId: string;
  key: string;
  label: string;
  enabled: boolean;
  channel: EvaluationChannel;
  kind: HighRiskFlagKind;
  /**
   * kind별 파라미터. long_call: percentile, minMinutes(AND 하한).
   * 실제 장콜 판정 임계분(분)은 long_call_thresholds 테이블의 직전 7일 MA 스냅샷을 쓴다.
   * agent_speak: minPercent / sentiment: metricKey / csat_dsat: maxRate
   * feedback_message_count: countTarget(문의·답변·합계) + minCount
   */
  params: {
    percentile?: number | null;
    minMinutes?: number | null;
    minPercent?: number | null;
    metricKey?: string | null;
    maxRate?: number | null;
    countTarget?: FeedbackCountTarget | null;
    minCount?: number | null;
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
    channel: "phone",
    kind: "long_call_percentile",
    params: { percentile: 10, minMinutes: null },
    sortOrder: 1,
  },
  {
    key: "agent_speak_high",
    label: "상담사 발화 과다",
    enabled: true,
    channel: "phone",
    kind: "agent_speak_ratio",
    params: { minPercent: 70, metricKey: "agentSpeakRatio" },
    sortOrder: 2,
  },
  {
    key: "agitated",
    label: "격앙 감지",
    enabled: true,
    channel: "phone",
    kind: "sentiment_agitated",
    params: { metricKey: "agitated" },
    sortOrder: 3,
  },
  {
    key: DSAT_FLAG_KEY,
    label: "DSAT",
    enabled: true,
    channel: "phone",
    kind: "csat_dsat",
    params: { maxRate: DSAT_DEFAULT_MAX_RATE },
    sortOrder: 4,
  },
];

/**
 * 종류가 속한 채널. 채널 컬럼이 비었거나(구 행) 종류와 안 맞으면 종류 쪽으로 맞춘다.
 * 문의 건수 규칙이 콜 채널로 남으면 목록 API가 통째로 건너뛰어 플래그가 한 건도 안 붙는다.
 */
export function resolveHighRiskFlagChannel(
  kind: HighRiskFlagKind,
  channelRaw?: string | null,
): EvaluationChannel {
  const stored = isEvaluationChannel(channelRaw) ? channelRaw : null;
  if (stored && HIGH_RISK_CHANNEL_KINDS[stored].includes(kind)) return stored;
  if (HIGH_RISK_CHANNEL_KINDS.feedback.includes(kind)) return "feedback";
  if (HIGH_RISK_CHANNEL_KINDS.chatcs.includes(kind)) return "chatcs";
  return DEFAULT_HIGH_RISK_CHANNEL;
}

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
    if (rule.channel && rule.channel !== "phone") continue;
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

export const FEEDBACK_COUNT_TARGET_LABEL: Record<FeedbackCountTarget, string> = {
  feedback: "문의 갯수",
  reply: "답변 갯수",
  total: "문의+답변 갯수",
};

function feedbackCountOf(
  target: FeedbackCountTarget,
  counts: { feedbackCount: number; replyCount: number },
): number {
  if (target === "feedback") return counts.feedbackCount;
  if (target === "reply") return counts.replyCount;
  return counts.feedbackCount + counts.replyCount;
}

export interface FeedbackHighRiskCountPredicate {
  key: string;
  label: string;
  countTarget: FeedbackCountTarget;
  minCount: number;
}

/** 목록 SQL·매칭이 같이 쓰는 문의 건수 규칙. `pickedKeys`가 있으면 그 키만(OR). */
export function feedbackHighRiskCountPredicates(
  rules: HighRiskFlagRule[],
  pickedKeys?: string[] | null,
): FeedbackHighRiskCountPredicate[] {
  const picked = new Set((pickedKeys ?? []).map((key) => key.trim()).filter(Boolean));
  const out: FeedbackHighRiskCountPredicate[] = [];
  for (const rule of rules.filter((r) => r.enabled).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (rule.kind !== "feedback_message_count") continue;
    if (picked.size && !picked.has(rule.key)) continue;
    const min = Number(rule.params.minCount);
    if (!Number.isFinite(min) || min < 0) continue;
    out.push({
      key: rule.key,
      label: rule.label,
      countTarget: rule.params.countTarget ?? "total",
      minCount: min,
    });
  }
  return out;
}

/**
 * 인앱 문의 스레드의 문의·답변 건수 기준 플래그.
 * AI 평가 결과가 아니라 원천 스레드 메타로 판정하므로 목록 조회에서 바로 계산한다.
 * 채널 값은 보지 않는다 — 종류가 건수 규칙이면 문의 플래그로 판정한다.
 */
export function matchFeedbackHighRiskFlags(
  rules: HighRiskFlagRule[],
  counts: { feedbackCount: number; replyCount: number },
): HighRiskFlagHit[] {
  const hits: HighRiskFlagHit[] = [];
  for (const pred of feedbackHighRiskCountPredicates(rules)) {
    const actual = feedbackCountOf(pred.countTarget, counts);
    if (actual >= pred.minCount) {
      hits.push({
        key: pred.key,
        label: pred.label,
        reason: `${FEEDBACK_COUNT_TARGET_LABEL[pred.countTarget]} ${actual}건 ≥ ${pred.minCount}건`,
      });
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
    kindRaw === "csat_dsat" ||
    kindRaw === "feedback_message_count"
      ? kindRaw
      : "long_call_percentile";
  const channelRaw = String(o.channel ?? "").trim();
  const channel = resolveHighRiskFlagChannel(kind, channelRaw);
  const paramsRaw = (o.params && typeof o.params === "object" ? o.params : {}) as Record<string, unknown>;
  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const targetRaw = String(paramsRaw.countTarget ?? "").trim();
  return {
    ruleId,
    key,
    label: String(o.label ?? key).trim() || key,
    enabled: o.enabled !== false,
    channel,
    kind,
    params: {
      percentile: numOrNull(paramsRaw.percentile),
      minMinutes: numOrNull(paramsRaw.minMinutes),
      minPercent: numOrNull(paramsRaw.minPercent),
      metricKey: paramsRaw.metricKey != null ? String(paramsRaw.metricKey) : null,
      maxRate: numOrNull(paramsRaw.maxRate),
      countTarget:
        targetRaw === "feedback" || targetRaw === "reply" || targetRaw === "total" ? targetRaw : null,
      minCount: numOrNull(paramsRaw.minCount),
    },
    sortOrder: Number.isFinite(Number(o.sortOrder)) ? Number(o.sortOrder) : 0,
    updatedAt: String(o.updatedAt ?? o.updated_at ?? ""),
    updatedBy: String(o.updatedBy ?? o.updated_by ?? ""),
  };
}

import type { HighRiskFlagRule } from "./highRiskFlags";

const FALLBACK_LABELS: Record<string, string> = {
  long_call: "장콜",
  agent_speak_high: "상담사 발화 과다",
  agitated: "격앙",
};

export function buildHighRiskFlagLabelMap(rules: HighRiskFlagRule[] | undefined | null): Map<string, string> {
  const map = new Map<string, string>(Object.entries(FALLBACK_LABELS));
  for (const rule of rules ?? []) {
    if (rule.key && rule.label) map.set(rule.key, rule.label);
  }
  return map;
}

export function resolveHighRiskFlagLabel(key: string, labelMap: Map<string, string>): string {
  return labelMap.get(key) ?? FALLBACK_LABELS[key] ?? key;
}

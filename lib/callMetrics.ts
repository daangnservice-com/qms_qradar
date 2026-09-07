import type { SchemaField, SchemaFieldSource, SchemaValueType } from "./promptTypes";
import type { MetricDetail } from "./types";
import type { SpeechOverlap } from "./silence";

/** STT 발화 구간에서 상담사 발화 비율(%). 전체 발화 시간 대비. */
export function computeAgentSpeakRatioPercent(
  segments: { atSec: number; endSec: number; speakerTag: number }[],
  agentSpeakerTag: number | null,
): number | null {
  if (agentSpeakerTag == null || !Number.isFinite(agentSpeakerTag)) return null;
  let agentSec = 0;
  let totalSec = 0;
  for (const s of segments) {
    const dur = Math.max(0, (s.endSec ?? s.atSec) - s.atSec);
    if (dur <= 0) continue;
    totalSec += dur;
    if (s.speakerTag === agentSpeakerTag) agentSec += dur;
  }
  if (totalSec <= 0) return null;
  return Math.round((agentSec / totalSec) * 1000) / 10;
}

/** 말 겹침 총 시간 / 통화 길이 × 100. */
export function computeOverlapRatioPercent(
  overlaps: Pick<SpeechOverlap, "durationSec">[],
  durationSec: number,
): number | null {
  if (!(durationSec > 0)) return null;
  const total = overlaps.reduce((a, o) => a + Math.max(0, o.durationSec || 0), 0);
  return Math.round((total / durationSec) * 1000) / 10;
}

function fieldMeta(f: SchemaField): {
  valueType: SchemaValueType;
  source: SchemaFieldSource;
} {
  return {
    valueType: f.valueType ?? "score",
    source: f.source ?? "llm",
  };
}

/** 스키마의 signal 필드 + LLM metrics를 합쳐 evaluation.metrics 구성. */
export function buildSignalMetrics(opts: {
  fields: SchemaField[];
  agentSpeakRatioPercent: number | null;
  overlapRatioPercent: number | null;
}): Record<string, MetricDetail> {
  const out: Record<string, MetricDetail> = {};
  for (const f of opts.fields) {
    const { valueType, source } = fieldMeta(f);
    if (source !== "signal") continue;
    let value: number | boolean | string | null = null;
    if (f.key === "agentSpeakRatio") value = opts.agentSpeakRatioPercent;
    else if (f.key === "overlapRatio") value = opts.overlapRatioPercent;
    out[f.key] = { valueType, value, source: "signal" };
  }
  return out;
}

export function mergeMetricMaps(
  ...maps: Array<Record<string, MetricDetail> | undefined | null>
): Record<string, MetricDetail> {
  const out: Record<string, MetricDetail> = {};
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) out[k] = v;
  }
  return out;
}

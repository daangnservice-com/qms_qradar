"use client";

import { useMemo, type ReactNode } from "react";
import { Badge } from "@seed-design/react";
import { maskPII } from "@/lib/pii";
import { DEFAULT_SCORE_FIELDS, type OutputSchemaSnapshot, type SchemaField } from "@/lib/promptTypes";
import { fieldSource, fieldValueType } from "@/lib/outputSchema";
import type { MetricDetail, OverallSummary, ScoreDetail } from "@/lib/types";

const LEGACY_SCORE_LABELS = Object.fromEntries(DEFAULT_SCORE_FIELDS.map((f) => [f.key, f.label]));

function typeBadgeLabel(kind: "score" | "metric", detail?: MetricDetail | null): string {
  if (kind === "score") return "score";
  if (!detail) return "—";
  if (detail.source === "signal") return "signal";
  if (detail.valueType === "bool") return "bool";
  if (detail.valueType === "percent") return "percent";
  if (detail.valueType === "label") return "label";
  return detail.source === "llm" ? "llm" : "metric";
}

function EvalStatCard({
  label,
  value,
  badge,
  comment,
  title,
}: {
  label: string;
  value: ReactNode;
  badge: string;
  comment?: string | null;
  title?: string;
}) {
  return (
    <div
      className="flex min-h-[88px] flex-col rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-2 py-2"
      title={title || comment || undefined}
    >
      <div className="text-center text-[10px] font-medium leading-tight text-[var(--fg-tertiary)]">{label}</div>
      <div className="flex flex-1 items-center justify-center py-1">
        <div className="text-center text-[18px] font-extrabold leading-none tabular-nums">{value}</div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Badge size="medium" variant="weak" tone="neutral" className="shrink-0 uppercase">
          {badge}
        </Badge>
        {comment ? (
          <p className="line-clamp-2 text-center text-[10px] leading-snug text-[var(--fg-secondary)]">{comment}</p>
        ) : null}
      </div>
    </div>
  );
}

function scoreItems(
  scores: Record<string, ScoreDetail> | undefined,
  snapshot: OutputSchemaSnapshot | undefined,
): Array<{ key: string; label: string; detail: ScoreDetail | undefined }> {
  if (!scores && !snapshot?.scoreFields.length) return [];
  const byKey = scores ?? {};
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string; detail: ScoreDetail | undefined }> = [];
  const fields = (snapshot?.scoreFields?.length ? snapshot.scoreFields : []).filter(
    (f) => fieldSource(f) === "llm" && fieldValueType(f) === "score",
  );
  for (const f of [...fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    seen.add(f.key);
    out.push({ key: f.key, label: f.label || f.key, detail: byKey[f.key] });
  }
  for (const key of Object.keys(byKey)) {
    if (seen.has(key)) continue;
    out.push({
      key,
      label: LEGACY_SCORE_LABELS[key] ?? key,
      detail: byKey[key],
    });
  }
  if (!out.length && scores) {
    for (const key of Object.keys(scores)) {
      out.push({ key, label: LEGACY_SCORE_LABELS[key] ?? key, detail: scores[key] });
    }
  }
  return out;
}

function metricItems(
  metrics: Record<string, MetricDetail> | undefined,
  snapshot: OutputSchemaSnapshot | undefined,
): Array<{ key: string; label: string; detail: MetricDetail | undefined }> {
  const byKey = metrics ?? {};
  const fields = (snapshot?.scoreFields ?? []).filter((f) => fieldValueType(f) !== "score" || fieldSource(f) === "signal");
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string; detail: MetricDetail | undefined }> = [];
  for (const f of [...fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (fieldValueType(f) === "score" && fieldSource(f) === "llm") continue;
    seen.add(f.key);
    out.push({ key: f.key, label: f.label || f.key, detail: byKey[f.key] });
  }
  for (const key of Object.keys(byKey)) {
    if (seen.has(key)) continue;
    out.push({ key, label: key, detail: byKey[key] });
  }
  return out;
}

function formatMetricValue(d: MetricDetail | undefined): string {
  if (!d || d.value == null) return "—";
  if (d.valueType === "bool") return d.value === true ? "예" : "아니오";
  if (d.valueType === "percent") return `${d.value}%`;
  return String(d.value);
}

function summaryItems(
  overall: OverallSummary | undefined,
  snapshot: OutputSchemaSnapshot | undefined,
): Array<{ key: string; label: string; text: string }> {
  if (overall == null || overall === "") return [];
  if (typeof overall === "string") {
    const text = maskPII(overall).trim();
    return text ? [{ key: "summary", label: "총평", text }] : [];
  }
  const byKey = Object.fromEntries(
    Object.entries(overall).map(([k, v]) => [k, maskPII(String(v ?? "")).trim()]),
  );
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string; text: string }> = [];
  const fields: SchemaField[] = snapshot?.overallSummaryFields?.length
    ? [...snapshot.overallSummaryFields].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  for (const f of fields) {
    seen.add(f.key);
    const text = byKey[f.key] ?? "";
    if (!text) continue;
    out.push({ key: f.key, label: f.label || f.key, text });
  }
  for (const [key, text] of Object.entries(byKey)) {
    if (seen.has(key) || !text) continue;
    out.push({ key, label: key, text });
  }
  return out;
}

export function AiEvalBlock({
  scores,
  metrics,
  overallSummary,
  snapshot,
  highRiskFlags,
}: {
  scores?: Record<string, ScoreDetail> | null;
  metrics?: Record<string, MetricDetail> | null;
  overallSummary?: OverallSummary | null;
  snapshot?: OutputSchemaSnapshot | null;
  highRiskFlags?: Array<{ key: string; label: string; reason?: string }> | null;
}) {
  const items = useMemo(
    () =>
      scoreItems(
        scores
          ? Object.fromEntries(
              Object.entries(scores).map(([k, v]) => [
                k,
                { score: v?.score ?? 0, comment: maskPII(v?.comment ?? "") },
              ]),
            )
          : undefined,
        snapshot ?? undefined,
      ),
    [scores, snapshot],
  );
  const mets = useMemo(() => metricItems(metrics ?? undefined, snapshot ?? undefined), [metrics, snapshot]);
  const summaries = useMemo(
    () => summaryItems(overallSummary ?? undefined, snapshot ?? undefined),
    [overallSummary, snapshot],
  );
  const scoreAvg = useMemo(() => {
    const vals = items
      .map((s) => s.detail?.score)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [items]);

  if (!items.length && !mets.length && !summaries.length && !(highRiskFlags?.length)) return null;

  const cols = items.length <= 1 ? 1 : items.length === 2 ? 2 : 3;

  return (
    <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold text-[var(--fg-tertiary)]">AI 기본 평가 (점수·메트릭·총평)</div>
        {scoreAvg != null && (
          <div className="text-[12px] font-extrabold tabular-nums">
            평균 {scoreAvg.toFixed(1)}
            <span className="text-[10px] font-medium text-[var(--fg-tertiary)]">/5</span>
          </div>
        )}
      </div>
      {highRiskFlags && highRiskFlags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {highRiskFlags.map((f) => (
            <Badge
              key={f.key}
              size="medium"
              variant="weak"
              tone="critical"
              title={f.reason || f.label}
              className="shrink-0"
            >
              {f.label}
            </Badge>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div
          className={`grid gap-1.5 ${cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}
        >
          {items.map(({ key, label, detail }) => (
            <EvalStatCard
              key={key}
              label={label}
              badge={typeBadgeLabel("score")}
              comment={detail?.comment || null}
              title={detail?.comment || undefined}
              value={
                <>
                  {detail?.score ?? "—"}
                  <span className="text-[11px] font-medium text-[var(--fg-tertiary)]">/5</span>
                </>
              }
            />
          ))}
        </div>
      )}
      {mets.length > 0 && (
        <div className={`grid gap-1.5 ${mets.length === 1 ? "grid-cols-1" : mets.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {mets.map(({ key, label, detail }) => (
            <EvalStatCard
              key={key}
              label={label}
              badge={typeBadgeLabel("metric", detail)}
              comment={detail?.comment ? maskPII(detail.comment) : null}
              title={detail?.comment || undefined}
              value={formatMetricValue(detail)}
            />
          ))}
        </div>
      )}
      {summaries.map((s) => (
        <div key={s.key}>
          <div className="mb-1 text-[10px] font-semibold text-[var(--fg-tertiary)]">{s.label}</div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--fg-secondary)]">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { canonicalizeReviewNeededLabel } from "@/lib/resultParse";
import { REVIEW_NEEDED_LABEL, REVIEW_NOT_NEEDED_LABEL } from "@/lib/promptTypes";
import { displayReviewNeededLabel } from "@/lib/judgmentUi";

export type MetricMatrix = {
  labels: string[];
  counts: number[][];
  total: number;
  accuracy: number;
};

export type CriterionMetricRow = {
  id: number;
  label: string;
  category: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  detected: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  diffCount: number;
};

export type BinaryMetrics = {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  total: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
};

/** 검토필요 = positive class 기준 이진 분류 지표. cold/review_needed 모두 양성. */
export function binaryMetrics(matrix: MetricMatrix | null): BinaryMetrics | null {
  if (!matrix) return null;
  const li = matrix.labels.findIndex((l) => canonicalizeReviewNeededLabel(l) === REVIEW_NEEDED_LABEL);
  const hi = matrix.labels.findIndex((l) => canonicalizeReviewNeededLabel(l) === REVIEW_NOT_NEEDED_LABEL);
  if (li < 0 || hi < 0) return null;
  const tp = matrix.counts[li][li] ?? 0;
  const fn = matrix.counts[li][hi] ?? 0;
  const fp = matrix.counts[hi][li] ?? 0;
  const tn = matrix.counts[hi][hi] ?? 0;
  const total = tp + tn + fp + fn;
  const accuracy = total ? (tp + tn) / total : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, tn, fp, fn, total, accuracy, precision, recall, f1 };
}

export function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

/** 0–100% 축 색상. 임계: 20 / 50 / 70 / 90 */
export function scoreThresholdColor(ratio: number): string {
  const p = ratio * 100;
  if (p < 20) return "var(--danger)";
  if (p < 50) return "var(--warning)";
  if (p < 70) return "var(--c-amber-600, #CA8A04)";
  if (p < 90) return "var(--info)";
  return "var(--accent)";
}

export function ScorePctBar({ value, label }: { value: number; label?: string }) {
  const w = Math.min(100, Math.max(0, value * 100));
  const color = scoreThresholdColor(value);
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[10.5px] text-[var(--fg-tertiary)]">
        <span>{label ?? "0%"}</span>
        <span>100%</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--bg-muted)]">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: color }} />
        {[20, 50, 70, 90].map((t) => (
          <div
            key={t}
            className="absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--fg-primary)_28%,transparent)]"
            style={{ left: `${t}%` }}
            title={`${t}%`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9.5px] tabular-nums text-[var(--fg-tertiary)]">
        <span>20</span>
        <span>50</span>
        <span>70</span>
        <span>90</span>
      </div>
    </div>
  );
}

/** 최상단 KPI: Accuracy · Recall · Precision */
export function TopKpiRow({ metrics }: { metrics: BinaryMetrics | null }) {
  const cards: Array<{ key: string; label: string; value: number | null; hint: string }> = [
    { key: "acc", label: "Accuracy", value: metrics?.accuracy ?? null, hint: "(TP+TN) / All" },
    { key: "rec", label: "Recall", value: metrics?.recall ?? null, hint: "TP / (TP+FN)" },
    { key: "pre", label: "Precision", value: metrics?.precision ?? null, hint: "TP / (TP+FP)" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.key} className="qms-card p-4">
          <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">{c.label}</div>
          <div
            className="mt-1 text-[26px] font-extrabold tabular-nums"
            style={{ color: c.value != null ? scoreThresholdColor(c.value) : undefined }}
          >
            {c.value != null ? pct(c.value) : "—"}
          </div>
          <div className="mt-0.5 text-[10.5px] text-[var(--fg-tertiary)]">{c.hint}</div>
          {c.value != null ? <ScorePctBar value={c.value} /> : null}
        </div>
      ))}
    </div>
  );
}

/** 정확도 대시보드와 동일 순서: FN → FP → (선택 지표) */
export function FnFpScoreCards({
  metrics,
  showSecondary = true,
}: {
  metrics: BinaryMetrics | null;
  showSecondary?: boolean;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div className="rounded-[var(--radius-md)] bg-[var(--warning-subtle)] p-4">
        <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">False Negative (FN)</div>
        <div className="mt-1 text-[24px] font-extrabold">{metrics?.fn ?? 0}</div>
        <div className="text-[11px] text-[var(--fg-tertiary)]">미탐 · 수기 검토필요 · AI 검토불필요</div>
      </div>
      <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] p-4">
        <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">False Positive (FP)</div>
        <div className="mt-1 text-[24px] font-extrabold">{metrics?.fp ?? 0}</div>
        <div className="text-[11px] text-[var(--fg-tertiary)]">오탐 · 수기 검토불필요 · AI 검토필요</div>
      </div>
      {showSecondary ? (
        <>
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-3">
            <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">F1 Score</div>
            <div className="mt-0.5 text-[18px] font-extrabold tabular-nums">
              {metrics ? pct(metrics.f1) : "—"}
            </div>
            <div className="text-[10.5px] text-[var(--fg-tertiary)]">2·P·R / (P+R)</div>
          </div>
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-3">
            <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">n (콜)</div>
            <div className="mt-0.5 text-[18px] font-extrabold tabular-nums">{metrics?.total ?? 0}</div>
            <div className="text-[10.5px] text-[var(--fg-tertiary)]">TP {metrics?.tp ?? 0} · TN {metrics?.tn ?? 0}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ConfusionMatrixCard({
  matrix,
  metrics,
  loading,
  emptyText = "데이터 없음",
}: {
  matrix: MetricMatrix | null;
  metrics: BinaryMetrics | null;
  loading?: boolean;
  emptyText?: string;
}) {
  const maxCell = useMemo(() => (matrix ? Math.max(1, ...matrix.counts.flat()) : 1), [matrix]);
  if (loading && !matrix) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!matrix || matrix.total <= 0) {
    return <p className="py-8 text-center text-[13px] text-[var(--fg-tertiary)]">{emptyText}</p>;
  }
  return (
    <div className="mt-3 overflow-auto">
      <table className="text-[12px]">
        <thead>
          <tr>
            <th className="p-1 text-[var(--fg-tertiary)]">수기＼AI</th>
            {matrix.labels.map((l) => (
              <th key={l} className="p-1 font-semibold">
                {displayReviewNeededLabel(l)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.labels.map((h, hi) => (
            <tr key={h}>
              <td className="p-1 font-semibold">{displayReviewNeededLabel(h)}</td>
              {matrix.labels.map((a, ai) => {
                const n = matrix.counts[hi][ai];
                const intensity = n / maxCell;
                const hN = canonicalizeReviewNeededLabel(h);
                const aN = canonicalizeReviewNeededLabel(a);
                const cellLabel =
                  hN === REVIEW_NEEDED_LABEL && aN === REVIEW_NEEDED_LABEL
                    ? "TP"
                    : hN === REVIEW_NOT_NEEDED_LABEL && aN === REVIEW_NOT_NEEDED_LABEL
                      ? "TN"
                      : hN === REVIEW_NOT_NEEDED_LABEL && aN === REVIEW_NEEDED_LABEL
                        ? "FP"
                        : hN === REVIEW_NEEDED_LABEL && aN === REVIEW_NOT_NEEDED_LABEL
                          ? "FN"
                          : "";
                return (
                  <td key={a} className="p-1">
                    <div
                      className="flex h-12 w-12 flex-col items-center justify-center rounded-[var(--radius-md)]"
                      style={{
                        backgroundColor: `rgba(255, 111, 15, ${0.08 + intensity * 0.55})`,
                        color: intensity > 0.5 ? "#fff" : "var(--fg-primary)",
                      }}
                      title={cellLabel}
                    >
                      <span className="text-[13px] font-bold">{n}</span>
                      {cellLabel ? <span className="text-[9px] font-semibold opacity-80">{cellLabel}</span> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {metrics ? (
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[var(--fg-tertiary)]">
          <span>TP {metrics.tp}</span>
          <span>TN {metrics.tn}</span>
          <span>FP {metrics.fp}</span>
          <span>FN {metrics.fn}</span>
        </div>
      ) : null}
    </div>
  );
}

export function StackedDetectBar({ row }: { row: CriterionMetricRow }) {
  const { tp, fp, fn, detected } = row;
  if (!detected) return null;
  const w = (n: number) => `${(n / detected) * 100}%`;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]" title={`TP ${tp} · FP ${fp} · FN ${fn}`}>
      <div className="flex h-full w-full">
        {tp > 0 && <div style={{ width: w(tp), background: "var(--accent)" }} />}
        {fp > 0 && <div style={{ width: w(fp), background: "var(--danger)" }} />}
        {fn > 0 && <div style={{ width: w(fn), background: "var(--warning)" }} />}
      </div>
    </div>
  );
}

function CriterionList({ rows, empty }: { rows: CriterionMetricRow[]; empty: string }) {
  if (!rows.length) {
    return <p className="py-6 text-center text-[13px] text-[var(--fg-tertiary)]">{empty}</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{r.id}</span>{" "}
              <span className="text-[13px] font-semibold">{r.label}</span>
            </div>
            <div className="shrink-0 text-right text-[11px] tabular-nums text-[var(--fg-secondary)]">
              Acc {(r.accuracy * 100).toFixed(0)}% · F1 {(r.f1 * 100).toFixed(0)}% · Δ {r.diffCount}
            </div>
          </div>
          <StackedDetectBar row={r} />
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--fg-tertiary)]">
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} /> TP {r.tp}
            </span>
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--danger)" }} /> FP {r.fp}
            </span>
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--warning)" }} /> FN {r.fn}
            </span>
            <span>TN {r.tn}</span>
            <span>P {(r.precision * 100).toFixed(0)}%</span>
            <span>R {(r.recall * 100).toFixed(0)}%</span>
            <span>n={r.detected}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function WrongItemList({
  rows,
  empty,
  countKey,
}: {
  rows: CriterionMetricRow[];
  empty: string;
  countKey: "fp" | "fn";
}) {
  if (!rows.length) {
    return <p className="py-6 text-center text-[13px] text-[var(--fg-tertiary)]">{empty}</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{r.id}</span>{" "}
              <span className="text-[13px] font-semibold">{r.label}</span>
            </div>
            <div className="shrink-0 text-right text-[12px] font-bold tabular-nums">
              {countKey === "fp" ? `과검출 ${r.fp}` : `미검출 ${r.fn}`}
            </div>
          </div>
          <StackedDetectBar row={r} />
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--fg-tertiary)]">
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} /> TP {r.tp}
            </span>
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--danger)" }} /> FP {r.fp}
            </span>
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--warning)" }} /> FN {r.fn}
            </span>
            <span>Δ {r.diffCount}</span>
            <span>n={r.detected}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export type CriterionSectionMode = "wrong" | "compare";

/** 주로 틀리는 항목 ↔ 항목별 AI–수기 감지 비교 토글 섹션 */
export function CriterionToggleSection({
  byCriterion,
  overDetect,
  underDetect,
  loading,
  defaultMode = "wrong",
}: {
  byCriterion: CriterionMetricRow[];
  overDetect: CriterionMetricRow[];
  underDetect: CriterionMetricRow[];
  loading?: boolean;
  defaultMode?: CriterionSectionMode;
}) {
  const [mode, setMode] = useState<CriterionSectionMode>(defaultMode);
  const [sortMode, setSortMode] = useState<"diff" | "f1">("diff");
  const [categoryTab, setCategoryTab] = useState("all");

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of byCriterion) {
      const cat = r.category || "기타";
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [byCriterion]);

  useEffect(() => {
    if (categoryTab !== "all" && !categories.some((c) => c.name === categoryTab)) {
      setCategoryTab("all");
    }
  }, [categories, categoryTab]);

  const filteredCriteria = useMemo(() => {
    if (categoryTab === "all") return byCriterion;
    return byCriterion.filter((r) => (r.category || "기타") === categoryTab);
  }, [byCriterion, categoryTab]);

  const sortedCriteria = useMemo(() => {
    const list = [...filteredCriteria];
    if (sortMode === "f1") {
      list.sort((a, b) => b.f1 - a.f1 || b.detected - a.detected);
    } else {
      list.sort((a, b) => b.diffCount - a.diffCount || b.detected - a.detected);
    }
    return list;
  }, [filteredCriteria, sortMode]);

  const topDiff = sortedCriteria.filter((r) => r.diffCount > 0).slice(0, 12);
  const topF1 = useMemo(() => {
    return [...filteredCriteria]
      .filter((r) => r.tp >= 1 && r.detected >= 2)
      .sort((a, b) => b.f1 - a.f1 || b.tp - a.tp)
      .slice(0, 12);
  }, [filteredCriteria]);

  const totals = useMemo(() => {
    return filteredCriteria.reduce(
      (a, r) => {
        a.tp += r.tp;
        a.fp += r.fp;
        a.fn += r.fn;
        a.tn += r.tn;
        return a;
      },
      { tp: 0, fp: 0, fn: 0, tn: 0 },
    );
  }, [filteredCriteria]);

  // 토글용 over/under — 카테고리 필터 적용 시 재계산
  const filteredOverUnder = useMemo(() => {
    if (categoryTab === "all") return { overDetect, underDetect };
    const over = overDetect.filter((r) => (r.category || "기타") === categoryTab);
    const overIds = new Set(over.map((r) => r.id));
    const under = underDetect.filter((r) => (r.category || "기타") === categoryTab && !overIds.has(r.id));
    return { overDetect: over, underDetect: under };
  }, [categoryTab, overDetect, underDetect]);

  return (
    <section className="qms-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold">
            {mode === "wrong" ? "주로 틀리는 항목" : "항목별 AI–수기 감지 비교"}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
            {mode === "wrong"
              ? "과검출(FP) top · 미검출(FN) top · 겹치면 과검출에만 표시 · 누적 막대 = TP/FP/FN"
              : `위반 감지 기준 · TP/FP/FN/TN · 합계 TP ${totals.tp} · FP ${totals.fp} · FN ${totals.fn} · TN ${totals.tn}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={mode === "wrong" ? "qms-btn-primary !h-8" : "qms-btn-ghost !h-8"}
            onClick={() => setMode("wrong")}
          >
            주로 틀리는 항목
          </button>
          <button
            type="button"
            className={mode === "compare" ? "qms-btn-primary !h-8" : "qms-btn-ghost !h-8"}
            onClick={() => setMode("compare")}
          >
            항목별 비교
          </button>
        </div>
      </div>

      {mode === "compare" ? (
        <div className="mt-3 flex gap-1">
          <button
            type="button"
            className={sortMode === "diff" ? "qms-btn-primary" : "qms-btn-ghost"}
            onClick={() => setSortMode("diff")}
          >
            차이 큰 순
          </button>
          <button
            type="button"
            className={sortMode === "f1" ? "qms-btn-primary" : "qms-btn-ghost"}
            onClick={() => setSortMode("f1")}
          >
            F1 높은 순
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1">
        <button
          type="button"
          className={
            categoryTab === "all"
              ? "qms-btn-primary !h-7 !px-2.5 text-[11px]"
              : "qms-btn-ghost !h-7 !px-2.5 text-[11px]"
          }
          onClick={() => setCategoryTab("all")}
        >
          전체
          <span className="ml-1 opacity-70">{byCriterion.length}</span>
        </button>
        {categories.map((cat) => {
          const active = categoryTab === cat.name;
          return (
            <button
              key={cat.name}
              type="button"
              className={
                active ? "qms-btn-primary !h-7 !px-2.5 text-[11px]" : "qms-btn-ghost !h-7 !px-2.5 text-[11px]"
              }
              onClick={() => setCategoryTab(cat.name)}
            >
              {cat.name}
              <span className="ml-1 opacity-70">{cat.count}</span>
            </button>
          );
        })}
      </div>

      {loading && !byCriterion.length ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : mode === "wrong" ? (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-[12px] font-bold text-[var(--danger)]">과검출 top (오탐)</h3>
            <WrongItemList
              rows={filteredOverUnder.overDetect}
              empty="과검출 항목이 없어요"
              countKey="fp"
            />
          </div>
          <div>
            <h3 className="mb-3 text-[12px] font-bold text-[var(--warning)]">미검출 top (미탐)</h3>
            <WrongItemList
              rows={filteredOverUnder.underDetect}
              empty="미검출 항목이 없어요"
              countKey="fn"
            />
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-[12px] font-bold text-[var(--fg-secondary)]">
              {sortMode === "diff" ? "차이가 많은 항목" : "전체 (F1 순)"}
            </h3>
            <CriterionList
              rows={sortMode === "diff" ? topDiff : sortedCriteria.slice(0, 12)}
              empty="항목별 비교 데이터가 없어요"
            />
          </div>
          <div>
            <h3 className="mb-3 text-[12px] font-bold text-[var(--fg-secondary)]">F1이 높은 항목</h3>
            <CriterionList rows={topF1} empty="감지 케이스가 아직 부족해요 (TP≥1, n≥2)." />
          </div>
        </div>
      )}
    </section>
  );
}

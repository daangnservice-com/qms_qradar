"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@seed-design/react";
import { Loader2, RefreshCw } from "lucide-react";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { currentYearMonthKst } from "@/lib/reviewStatusPeriod";
import {
  buildReviewStatusDeepLink,
  saveReviewStatusCheckout,
} from "@/lib/reviewStatusCheckout";
import {
  displayReviewNeededLabel,
  finalJudgmentLabel,
  finalJudgmentTone,
  isReviewNeededRaw,
  reviewNeededTone,
} from "@/lib/judgmentUi";

import {
  CriterionToggleSection,
  ConfusionMatrixCard,
  FnFpScoreCards,
  TopKpiRow,
  binaryMetrics,
  pct,
  type CriterionMetricRow,
  type MetricMatrix,
} from "@/components/eval-metrics/AccuracyMetricsShared";

type EvalSetShare = {
  versionId: string;
  versionLabel: string;
  status: string | null;
  isProduction: boolean;
  caseCount: number;
  share: number;
  accuracy: number;
  precision: number;
  recall: number;
};

type CaseRow = {
  conversationId: string;
  phoneInquiryId: string | null;
  adminName: string;
  callDate: string;
  aiLabel: string;
  humanResult: string;
  humanFinalLabel?: string;
  match: boolean | null;
  reviewCompletedAt: string | null;
  reviewCompletedBy: string | null;
  promptVersionId: string | null;
  promptVersion: string | null;
  callKind: "fp" | "fn" | "match" | "other";
  humanReviewNeededCount?: number;
  aiReviewNeededCount?: number;
  reviewNeededDiff?: number;
  humanColdCount: number;
  aiColdCount: number;
  coldDiff: number;
};

type DashboardData = {
  matrix: MetricMatrix;
  byCriterion: CriterionMetricRow[];
  overDetect: CriterionMetricRow[];
  underDetect: CriterionMetricRow[];
  cases: CaseRow[];
};

type DashboardMetrics = Omit<DashboardData, "cases">;

type FilterMode = "month" | "custom";

function formatTs(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function ReviewNeededBadge({ label }: { label: string }) {
  const needed = isReviewNeededRaw(label);
  if (needed == null) return <span className="text-[var(--fg-tertiary)]">—</span>;
  return (
    <Badge size="medium" variant="weak" tone={reviewNeededTone(needed)}>
      {displayReviewNeededLabel(label)}
    </Badge>
  );
}

function FinalBadge({ label }: { label?: string }) {
  const n = String(label ?? "")
    .trim()
    .toLowerCase();
  if (n !== "cold" && n !== "hot" && n !== "hold") return <span className="text-[var(--fg-tertiary)]">—</span>;
  return (
    <Badge size="medium" variant="weak" tone={finalJudgmentTone(n)}>
      {finalJudgmentLabel(n)}
    </Badge>
  );
}

function reviewDiff(c: CaseRow): number {
  return c.reviewNeededDiff ?? c.coldDiff;
}

function judgmentLabel(c: CaseRow): { text: string; className: string } {
  const diff = reviewDiff(c);
  if (diff > 0) {
    return { text: `오탐(+${diff}개)`, className: "font-semibold text-[var(--danger)]" };
  }
  if (diff < 0) {
    return { text: `미탐(${diff}개)`, className: "font-semibold text-[var(--warning)]" };
  }
  if (c.callKind === "match" || diff === 0) {
    return { text: "일치", className: "text-[var(--fg-secondary)]" };
  }
  return { text: "—", className: "text-[var(--fg-tertiary)]" };
}

export default function ReviewStatusWorkbench() {
  const defaultMonth = currentYearMonthKst();
  const [mode, setMode] = useState<FilterMode>("month");
  const [month, setMonth] = useState(defaultMonth);
  const [startDate, setStartDate] = useState(`${defaultMonth}-01`);
  const [endDate, setEndDate] = useState(() => {
    const y = Number(defaultMonth.slice(0, 4));
    const m = Number(defaultMonth.slice(5, 7));
    const last = new Date(y, m, 0).getDate();
    return `${defaultMonth}-${String(last).padStart(2, "0")}`;
  });
  const [applied, setApplied] = useState({
    mode: "month" as FilterMode,
    month: defaultMonth,
    startDate: "",
    endDate: "",
  });
  const [listFilter, setListFilter] = useState<"all" | "fp" | "fn" | "match">("all");
  const [evalSetFilter, setEvalSetFilter] = useState<string | null>(null);

  const cacheKey =
    applied.mode === "month"
      ? `reviewStatus:v3:month:${applied.month}`
      : `reviewStatus:v3:range:${applied.startDate}:${applied.endDate}`;

  const returnHref = useMemo(() => {
    const sp = new URLSearchParams();
    if (applied.mode === "month") sp.set("month", applied.month);
    else {
      sp.set("startDate", applied.startDate);
      sp.set("endDate", applied.endDate);
    }
    const q = sp.toString();
    return q ? `/eval-ops/review-status?${q}` : "/eval-ops/review-status";
  }, [applied]);

  const { data, loading, validating, error, refresh } = useCachedFetch<{
    matrix: MetricMatrix;
    byCriterion: CriterionMetricRow[];
    overDetect: CriterionMetricRow[];
    underDetect: CriterionMetricRow[];
    evalSets: EvalSetShare[];
    cases: CaseRow[];
    evalSetReports: Record<string, DashboardMetrics>;
  }>({
    key: cacheKey,
    fetcher: async () => {
      const sp = new URLSearchParams();
      if (applied.mode === "month") sp.set("month", applied.month);
      else {
        sp.set("startDate", applied.startDate);
        sp.set("endDate", applied.endDate);
      }
      const r = await fetch(`/api/eval-ops/review-status?${sp}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "검수 현황 로드 실패");
      return {
        matrix: d.matrix,
        byCriterion: d.byCriterion ?? [],
        overDetect: d.overDetect ?? [],
        underDetect: d.underDetect ?? [],
        evalSets: d.evalSets ?? [],
        cases: d.cases ?? [],
        evalSetReports: d.evalSetReports ?? {},
      };
    },
  });

  const dashboard = useMemo<DashboardData | null>(() => {
    if (!data) return null;
    if (!evalSetFilter) return data;
    const selected = data.evalSetReports[evalSetFilter];
    if (!selected) return null;
    return {
      ...selected,
      cases: data.cases.filter(
        (c) => ((c.promptVersionId || "").trim() || "(없음)") === evalSetFilter,
      ),
    };
  }, [data, evalSetFilter]);
  const metrics = useMemo(() => binaryMetrics(dashboard?.matrix ?? null), [dashboard?.matrix]);

  const filteredCases = useMemo(() => {
    const list = dashboard?.cases ?? [];
    if (listFilter === "all") return list;
    if (listFilter === "fp") return list.filter((c) => reviewDiff(c) > 0 || c.callKind === "fp");
    if (listFilter === "fn") return list.filter((c) => reviewDiff(c) < 0 || c.callKind === "fn");
    return list.filter((c) => reviewDiff(c) === 0 && (c.callKind === "match" || c.callKind === "other"));
  }, [dashboard?.cases, listFilter]);

  const applyFilter = () => {
    if (mode === "month") {
      setApplied({ mode: "month", month, startDate: "", endDate: "" });
    } else {
      if (!startDate || !endDate || startDate > endDate) return;
      setApplied({ mode: "custom", month: "", startDate, endDate });
    }
  };

  const periodLabel =
    applied.mode === "month" ? `${applied.month}` : `${applied.startDate} ~ ${applied.endDate}`;

  const openCase = (c: CaseRow) => {
    saveReviewStatusCheckout({
      conversationId: c.conversationId,
      adminName: c.adminName,
      callDate: c.callDate,
      returnHref,
      openedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 운영</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">검수 현황</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-secondary)]">
            AI 검토필요 vs 수기 검토필요 · 오탐(FP)·미탐(FN) · 평가셋 비중 · 기간 {periodLabel}
            <span className="mt-0.5 block text-[12px] text-[var(--fg-tertiary)]">
              9월부터 매트릭스는 검토필요 일치입니다. 수기 Cold/Hot은 최종 감안 판정으로 따로 표시합니다. 8월 이전 검수는
              구 Cold/Hot 정의를 검토필요로 폴백합니다.
            </span>
          </p>
        </div>
        <button type="button" className="qms-btn-ghost inline-flex items-center" onClick={() => void refresh()}>
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${validating ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </header>

      <section className="qms-card flex flex-wrap items-end gap-3 p-4">
        <div className="flex gap-1">
          <button
            type="button"
            className={mode === "month" ? "qms-btn-primary !h-8" : "qms-btn-ghost !h-8"}
            onClick={() => setMode("month")}
          >
            월 선택
          </button>
          <button
            type="button"
            className={mode === "custom" ? "qms-btn-primary !h-8" : "qms-btn-ghost !h-8"}
            onClick={() => setMode("custom")}
          >
            기간 지정
          </button>
        </div>
        {mode === "month" ? (
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
            <span className="font-semibold">검수 월</span>
            <input
              type="month"
              className="qms-input !h-8 !py-0"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
            <label className="flex items-center gap-2">
              <span className="font-semibold">시작</span>
              <input
                type="date"
                className="qms-input !h-8 !py-0"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="font-semibold">종료</span>
              <input
                type="date"
                className="qms-input !h-8 !py-0"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
        )}
        <button type="button" className="qms-btn-primary !h-8" onClick={applyFilter}>
          적용
        </button>
        <p className="w-full text-[11px] text-[var(--fg-tertiary)]">
          지정 기간 안에 <strong>수기 검수 완료</strong>된 케이스만 집계합니다. (기본: 당월)
        </p>
      </section>

      {error && (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--fg-tertiary)]" />
        </div>
      ) : (
        <>
          <TopKpiRow metrics={metrics} />

          <div className="grid gap-4 md:grid-cols-2">
            <section className="qms-card p-4">
              <h2 className="text-[14px] font-bold">분류 지표 (검토필요 = positive)</h2>
              <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                FP = 위양성 (수기 검토불필요 · AI 검토필요) · FN = 위음성 (수기 검토필요 · AI 검토불필요)
              </p>
              <FnFpScoreCards metrics={metrics} />
            </section>

            <section className="qms-card p-4">
              <h2 className="text-[14px] font-bold">Confusion matrix</h2>
              <ConfusionMatrixCard
                matrix={dashboard?.matrix ?? null}
                metrics={metrics}
                emptyText="해당 기간에 검수 완료된 케이스가 없어요"
              />
            </section>
          </div>

          <section className="qms-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-bold">평가셋 비중</h2>
                <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
                  검수 완료 케이스에 사용된 AI 평가표(프롬프트 버전) 비율 · 항목을 클릭하면 전체 대시보드가 필터링됩니다
                </p>
              </div>
              {evalSetFilter ? (
                <button
                  type="button"
                  className="qms-btn-ghost !h-7 !px-2.5 text-[11px]"
                  onClick={() => setEvalSetFilter(null)}
                >
                  전체 평가셋 보기
                </button>
              ) : null}
            </div>
            {(data?.evalSets ?? []).length ? (
              <ul className="mt-3 space-y-2">
                {data!.evalSets.map((s) => (
                  <li key={s.versionId}>
                    <button
                      type="button"
                      aria-pressed={evalSetFilter === s.versionId}
                      className={`w-full rounded-[var(--radius-md)] p-2 text-left transition-colors ${
                        evalSetFilter === s.versionId
                          ? "bg-[var(--accent-subtle)] ring-1 ring-[var(--accent)]"
                          : "hover:bg-[var(--bg-muted)]"
                      }`}
                      onClick={() => setEvalSetFilter((current) => (current === s.versionId ? null : s.versionId))}
                    >
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[13px]">
                        <span className="min-w-0 truncate font-semibold">
                          {s.versionLabel}
                          {s.isProduction ? " (production)" : s.status ? ` (${s.status})` : ""}
                        </span>
                        <span className="shrink-0 tabular-nums text-[var(--fg-secondary)]">
                          {s.caseCount}건 · {pct(s.share)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-[var(--fg-secondary)]">
                        <span>Accuracy {pct(s.accuracy)}</span>
                        <span>Recall {pct(s.recall)}</span>
                        <span>Precision {pct(s.precision)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                        <div
                          className="h-full rounded-full bg-[var(--brand)]"
                          style={{ width: `${Math.min(100, s.share * 100)}%` }}
                        />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-[var(--fg-tertiary)]">평가셋 데이터 없음</p>
            )}
          </section>

          <CriterionToggleSection
            byCriterion={dashboard?.byCriterion ?? []}
            overDetect={dashboard?.overDetect ?? []}
            underDetect={dashboard?.underDetect ?? []}
            defaultMode="wrong"
          />

          <section className="qms-card p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-bold">검수 완료 케이스</h2>
                <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
                  {filteredCases.length}건
                  {listFilter !== "all" ? ` (필터: ${listFilter.toUpperCase()})` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", "전체"],
                    ["fp", "오탐"],
                    ["fn", "미탐"],
                    ["match", "일치"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={
                      listFilter === id
                        ? "qms-btn-primary !h-7 !px-2.5 text-[11px]"
                        : "qms-btn-ghost !h-7 !px-2.5 text-[11px]"
                    }
                    onClick={() => setListFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[980px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[11px] text-[var(--fg-tertiary)]">
                    <th className="px-2 py-2 font-semibold">케이스</th>
                    <th className="px-2 py-2 font-semibold">수기 검토</th>
                    <th className="px-2 py-2 font-semibold">AI 검토</th>
                    <th className="px-2 py-2 font-semibold">수기 최종</th>
                    <th className="px-2 py-2 font-semibold">수기 검토필요</th>
                    <th className="px-2 py-2 font-semibold">AI 검토필요</th>
                    <th className="px-2 py-2 font-semibold">판정</th>
                    <th className="px-2 py-2 font-semibold">평가셋</th>
                    <th className="px-2 py-2 font-semibold">검수 시각</th>
                    <th className="px-2 py-2 font-semibold">검수자</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-2 py-8 text-center text-[var(--fg-tertiary)]">
                        목록이 비어 있어요
                      </td>
                    </tr>
                  ) : (
                    filteredCases.map((c) => {
                      const j = judgmentLabel(c);
                      return (
                        <tr key={c.conversationId} className="border-b border-[var(--border-subtle)]">
                          <td className="px-2 py-2">
                            <Link
                              href={buildReviewStatusDeepLink(c.conversationId)}
                              onClick={() => openCase(c)}
                              className="block min-w-[140px] no-underline hover:opacity-80"
                            >
                              <div className="text-[13px] font-semibold text-[var(--fg-primary)]">
                                {c.adminName || "상담사 미상"}
                                {c.callDate ? (
                                  <span className="ml-1 font-normal text-[var(--fg-secondary)]">
                                    ({c.callDate})
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 font-mono text-[10.5px] text-[var(--fg-tertiary)]">
                                {c.conversationId}
                              </div>
                            </Link>
                          </td>
                          <td className="px-2 py-2">
                            <ReviewNeededBadge label={c.humanResult} />
                          </td>
                          <td className="px-2 py-2">
                            <ReviewNeededBadge label={c.aiLabel} />
                          </td>
                          <td className="px-2 py-2">
                            <FinalBadge label={c.humanFinalLabel} />
                          </td>
                          <td className="px-2 py-2 tabular-nums font-semibold">
                            {c.humanReviewNeededCount ?? c.humanColdCount}
                          </td>
                          <td className="px-2 py-2 tabular-nums font-semibold">
                            {c.aiReviewNeededCount ?? c.aiColdCount}
                          </td>
                          <td className={`px-2 py-2 ${j.className}`}>{j.text}</td>
                          <td className="max-w-[160px] truncate px-2 py-2 text-[var(--fg-secondary)]">
                            {c.promptVersion || c.promptVersionId?.slice(0, 8) || "—"}
                          </td>
                          <td className="px-2 py-2 tabular-nums text-[var(--fg-secondary)]">
                            {formatTs(c.reviewCompletedAt)}
                          </td>
                          <td className="max-w-[140px] truncate px-2 py-2 text-[var(--fg-tertiary)]">
                            {c.reviewCompletedBy || "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

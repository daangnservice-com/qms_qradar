"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { cacheInvalidate, cacheSet } from "@/lib/clientCache";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { splitOverUnderTops } from "@/lib/criterionTops";
import {
  CriterionToggleSection,
  ConfusionMatrixCard,
  FnFpScoreCards,
  TopKpiRow,
  binaryMetrics,
  type CriterionMetricRow,
  type MetricMatrix,
} from "@/components/eval-metrics/AccuracyMetricsShared";

type SheetOpt = {
  versionId: string;
  versionLabel: string;
  status: string | null;
  resultCount: number;
  isProduction: boolean;
};

const GATE = 0.9;

export default function AccuracyDashboard() {
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetOpt[]>([]);

  const cacheKey = sheetId ? `qaMatrix:v7:${sheetId}` : "qaMatrix:v7:auto";

  const { data, loading, validating, error, refresh } = useCachedFetch<{
    matrix: MetricMatrix | null;
    byCriterion: CriterionMetricRow[];
    sheets: SheetOpt[];
    selectedPromptVersionId: string | null;
    productionVersionId: string | null;
  }>({
    key: cacheKey,
    fetcher: async () => {
      const q = sheetId ? `?promptVersionId=${encodeURIComponent(sheetId)}` : "";
      const r = await fetch(`/api/qa/matrix${q}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "매트릭스 로드 실패");
      return {
        matrix: d.matrix ?? null,
        byCriterion: d.byCriterion ?? [],
        sheets: d.sheets ?? [],
        selectedPromptVersionId: d.selectedPromptVersionId ?? null,
        productionVersionId: d.productionVersionId ?? null,
      };
    },
  });

  useEffect(() => {
    if (data?.sheets?.length) setSheets(data.sheets);
  }, [data?.sheets]);

  useEffect(() => {
    if (sheetId == null && data?.selectedPromptVersionId) {
      const id = data.selectedPromptVersionId;
      cacheSet(`qaMatrix:v6:${id}`, data);
      setSheetId(id);
    }
  }, [data, sheetId]);

  useEffect(() => {
    if (!data?.selectedPromptVersionId) return;
    if (sheetId && data.selectedPromptVersionId !== sheetId) return;
    cacheSet(`qaMatrix:v6:${data.selectedPromptVersionId}`, data);
  }, [data, sheetId]);

  const activeSheetId = sheetId ?? data?.selectedPromptVersionId ?? "";
  const selectedSheet = sheets.find((s) => s.versionId === activeSheetId) ?? null;

  const dataAligned =
    data != null &&
    (sheetId == null || data.selectedPromptVersionId === sheetId || data.selectedPromptVersionId === activeSheetId);

  const matrix = dataAligned ? (data?.matrix ?? null) : null;
  const byCriterion = dataAligned ? (data?.byCriterion ?? []) : [];
  const metrics = useMemo(() => binaryMetrics(matrix), [matrix]);
  const { overDetect, underDetect } = useMemo(() => splitOverUnderTops(byCriterion), [byCriterion]);

  const showLoadingOverlay =
    (loading && !dataAligned) ||
    (sheetId != null && data != null && data.selectedPromptVersionId !== sheetId);

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">AI 평가 정확도 대시보드</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-secondary)]">
            콜 레벨 수기 vs AI · Gate {GATE * 100}% · 항목별 감지 비교 · 평가표별 비교
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
            <span className="shrink-0 whitespace-nowrap font-semibold">평가표</span>
            <select
              className="qms-input !h-8 min-w-[200px] !py-0 text-[12px]"
              value={activeSheetId}
              disabled={sheets.length === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (!v || v === sheetId) return;
                setSheetId(v);
              }}
            >
              {sheets.length === 0 ? <option value="">사용한 평가표 없음</option> : null}
              {sheets.map((s) => (
                <option key={s.versionId} value={s.versionId}>
                  {s.versionLabel || s.versionId.slice(0, 8)}
                  {s.isProduction ? " (production)" : s.status ? ` (${s.status})` : ""}
                  {` · ${s.resultCount}건`}
                </option>
              ))}
            </select>
            {validating ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--fg-tertiary)]" /> : null}
          </label>
          <Link
            href="/eval-design/compare"
            className="qms-btn-ghost inline-flex min-w-[9.5rem] items-center justify-center whitespace-nowrap no-underline !px-4"
          >
            AI 비교·개선 →
          </Link>
          <button
            type="button"
            className="qms-btn-ghost inline-flex items-center"
            onClick={() => {
              cacheInvalidate(cacheKey);
              cacheInvalidate("qaMatrix");
              void refresh();
            }}
          >
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${validating ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>
      </header>

      {selectedSheet && (
        <div className="text-[12px] text-[var(--fg-tertiary)]">
          선택한 평가표로 평가된 콜만 집계합니다. (conversation 기준 최신 1건)
          {selectedSheet.isProduction ? " · 현재 production" : null}
          {" · "}
          <code className="text-[11px]">{selectedSheet.versionId}</code>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="relative">
        {showLoadingOverlay ? (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--bg-canvas)_55%,transparent)] pt-24 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-2.5 text-[13px] font-semibold shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              평가셋 집계 중…
            </div>
          </div>
        ) : null}

        <div className={`space-y-4 transition-opacity ${showLoadingOverlay ? "pointer-events-none opacity-40" : ""}`}>
          <TopKpiRow metrics={metrics} />

          <div className="grid gap-4 md:grid-cols-2">
            <section className="qms-card p-4">
              <h2 className="text-[14px] font-bold">분류 지표 (검토필요 = positive)</h2>
              <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                FP = 위양성 (수기 검토불필요 · AI 검토필요) · FN = 위음성 (수기 검토필요 · AI 검토불필요)
                {metrics && metrics.total > 0
                  ? ` · Gate ${GATE * 100}% ${metrics.accuracy >= GATE ? "통과" : "미달"}`
                  : ""}
              </p>
              <FnFpScoreCards metrics={metrics} />
            </section>

            <section className="qms-card p-4">
              <h2 className="text-[14px] font-bold">Confusion matrix</h2>
              <ConfusionMatrixCard
                matrix={matrix}
                metrics={metrics}
                loading={loading}
                emptyText={
                  loading ? "집계 중…" : "선택한 평가표로 평가된 QA 결과가 없어요"
                }
              />
            </section>
          </div>

          <CriterionToggleSection
            byCriterion={byCriterion}
            overDetect={overDetect}
            underDetect={underDetect}
            loading={loading}
            defaultMode="compare"
          />
        </div>
      </div>
    </div>
  );
}

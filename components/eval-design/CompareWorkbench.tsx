"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import { cacheInvalidate } from "@/lib/clientCache";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { formatClock } from "@/lib/format";
import { coerceAtSec } from "@/lib/atSecNormalize";
import type { ChecklistEvidence, ChecklistResult, Evaluation } from "@/lib/types";
import { AiEvalBlock } from "@/components/AiEvalBlock";

type SampleRow = {
  conversationId: string;
  phoneInquiryId: string | null;
  humanResult: string;
  aiLabel: string | null;
  match: boolean | null;
  matchGrade: "full" | "partial_items" | "result_only" | "result_mismatch" | "unevaluated";
  matchGradeLabel: string;
  itemOverlap: number;
  humanItemCount: number;
  aiItemCount: number;
  hasQaResult: boolean;
  promptVersionId: string | null;
  promptVersionLabel: string | null;
  isCurrentSheet: boolean;
  isStaleSheet: boolean;
  analyzedAt: string | null;
  error: string | null;
};

type ActiveSheet = {
  templateKey: string;
  versionId: string;
  versionLabel: string;
  status: string;
  changeNote: string;
  createdAt: string;
  createdBy: string;
  criteriaCount: number;
};

type SheetOpt = {
  versionId: string;
  versionLabel: string;
  status: string;
  changeNote: string;
  createdAt: string;
  isProduction: boolean;
  criteriaCount: number;
};

type ComparePayload = {
  conversationId: string;
  humanResult: string | null;
  aiLabel: string | null;
  match: boolean | null;
  criterionCompare: Array<{
    id: number;
    label: string;
    humanViolated: boolean;
    aiViolated: boolean | null;
    status: string;
    aiReason?: string;
  }>;
  criterionSummary: { tp: number; fp: number; fn: number; tn: number };
  scoreDetailRaw: string;
  memoDetail?: string;
  checklist?: ChecklistResult[];
  result?: {
    evaluation?: Pick<Evaluation, "scores" | "overallSummary" | "outputSchemaSnapshot" | "error" | "csChecklist">;
  } | null;
  qa?: { promptVersionId?: string | null; analyzedAt?: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  tp: "둘 다 부적합",
  fp: "AI만 부적합",
  fn: "수기만 부적합",
  tn: "둘 다 적합",
  human_only: "수기만",
  ai_only: "AI만",
};

const GRADE_STYLE: Record<SampleRow["matchGrade"], string> = {
  full: "text-[var(--accent)]",
  partial_items: "text-[var(--info)]",
  result_only: "text-[var(--warning)]",
  result_mismatch: "text-[var(--brand)]",
  unevaluated: "text-[var(--fg-tertiary)]",
};

const GRADE_FILTERS: Array<{ key: SampleRow["matchGrade"] | "all"; label: string }> = [
  { key: "all", label: "전체" },
  { key: "full", label: "완전일치" },
  { key: "partial_items", label: "항목 부분일치" },
  { key: "result_only", label: "결과만 일치" },
  { key: "result_mismatch", label: "결과 미일치" },
  { key: "unevaluated", label: "미평가" },
];

function EvidenceList({ evidence }: { evidence: ChecklistEvidence[] }) {
  if (!evidence?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {evidence.map((e, i) => (
        <li key={i} className="text-[11px] leading-snug text-[var(--fg-secondary)]">
          <span className="font-mono text-[var(--info)]">{formatClock(coerceAtSec(e.atSec, { quote: e.quote }))}</span> “{e.quote}”
        </li>
      ))}
    </ul>
  );
}

export default function CompareWorkbench() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [keepAudio, setKeepAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<SampleRow["matchGrade"] | "all">("all");
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  /** 재평가에 사용할 평가표. null이면 로드 후 production으로 채움 */
  const [evalSheetId, setEvalSheetId] = useState<string | null>(null);

  const { data, loading, refresh } = useCachedFetch<{
    samples: SampleRow[];
    source: string;
    activeSheet: ActiveSheet | null;
    sheets: SheetOpt[];
    gradeCounts: Record<SampleRow["matchGrade"], number> | null;
  }>({
    key: "qaSamples:v6",
    fetcher: async () => {
      const r = await fetch("/api/qa/samples");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "샘플 로드 실패");
      return {
        samples: d.samples ?? [],
        source: d.source ?? "",
        activeSheet: d.activeSheet ?? null,
        sheets: d.sheets ?? [],
        gradeCounts: d.gradeCounts ?? null,
      };
    },
  });

  const samples = data?.samples ?? [];
  const activeSheet = data?.activeSheet ?? null;
  const sheets = data?.sheets ?? [];
  const gradeCounts = data?.gradeCounts ?? null;

  useEffect(() => {
    if (evalSheetId == null && activeSheet?.versionId) {
      setEvalSheetId(activeSheet.versionId);
    }
  }, [activeSheet?.versionId, evalSheetId]);

  const selectedEvalSheet =
    sheets.find((s) => s.versionId === evalSheetId) ??
    (activeSheet
      ? {
          versionId: activeSheet.versionId,
          versionLabel: activeSheet.versionLabel,
          status: activeSheet.status,
          changeNote: activeSheet.changeNote,
          createdAt: activeSheet.createdAt,
          isProduction: true,
          criteriaCount: activeSheet.criteriaCount,
        }
      : null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("hx:qa:bookmarks");
      if (raw) setBookmarks(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  const persistBookmarks = (ids: string[]) => {
    setBookmarks(ids);
    try {
      localStorage.setItem("hx:qa:bookmarks", JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    let list = samples;
    if (onlyMismatch) list = list.filter((s) => s.matchGrade === "result_mismatch");
    if (gradeFilter !== "all") list = list.filter((s) => s.matchGrade === gradeFilter);
    return list;
  }, [samples, onlyMismatch, gradeFilter]);

  const listGradeCounts = useMemo(() => {
    if (gradeCounts) return gradeCounts;
    const counts: Record<SampleRow["matchGrade"], number> = {
      full: 0,
      partial_items: 0,
      result_only: 0,
      result_mismatch: 0,
      unevaluated: 0,
    };
    for (const s of samples) counts[s.matchGrade] += 1;
    return counts;
  }, [samples, gradeCounts]);

  const loadCompare = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/qa/compare?conversationId=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "비교 로드 실패");
      setCompare(d);
      setExpandedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!selectedId && filtered[0]) setSelectedId(filtered[0].conversationId);
  }, [filtered, selectedId]);

  useEffect(() => {
    if (selectedId) void loadCompare(selectedId);
  }, [selectedId, loadCompare]);

  // filtered 변경 시 체크는 유지하되 목록에 없는 id 정리
  useEffect(() => {
    const visible = new Set(filtered.map((s) => s.conversationId));
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const checklistById = useMemo(() => {
    const list = compare?.checklist?.length
      ? compare.checklist
      : (compare?.result?.evaluation?.csChecklist ?? []);
    return new Map(list.map((c) => [c.id, c]));
  }, [compare]);

  const scores = compare?.result?.evaluation?.scores;
  const overallSummary = compare?.result?.evaluation?.overallSummary;
  const humanMemo = (compare?.memoDetail ?? "").trim();

  const toggleCheck = (id: string, on?: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const should = on ?? !next.has(id);
      if (should) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectIds = (ids: string[]) => setChecked(new Set(ids));

  const selectUnevaluated = () =>
    selectIds(filtered.filter((s) => s.matchGrade === "unevaluated").map((s) => s.conversationId));
  const selectMismatch = () =>
    selectIds(filtered.filter((s) => s.matchGrade === "result_mismatch").map((s) => s.conversationId));
  const selectStale = () =>
    selectIds(filtered.filter((s) => s.isStaleSheet).map((s) => s.conversationId));
  const clearChecked = () => setChecked(new Set());

  const allVisibleChecked =
    filtered.length > 0 && filtered.every((s) => checked.has(s.conversationId));
  const toggleAllVisible = () => {
    if (allVisibleChecked) clearChecked();
    else selectIds(filtered.map((s) => s.conversationId));
  };

  const runEval = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const r = await fetch("/api/qa/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationIds: ids,
          keepAudio,
          ...(evalSheetId ? { versionId: evalSheetId } : {}),
        }),
      });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "평가 실패");
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let doneCount = 0;
      let errCount = 0;
      let skipCount = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; message?: string };
          if (ev.type === "result") doneCount += 1;
          if (ev.type === "skipped") skipCount += 1;
          if (ev.type === "error") {
            errCount += 1;
            setError(ev.message ?? "평가 오류");
          }
        }
      }
      setOk(
        `완료 ${doneCount}건` +
          (skipCount ? ` · 중복 스킵 ${skipCount}건` : "") +
          (errCount ? ` · 실패 ${errCount}건` : ""),
      );
      cacheInvalidate("qaSamples");
      cacheInvalidate("qaSamples:v2");
      cacheInvalidate("qaSamples:v3");
      cacheInvalidate("qaSamples:v4");
      cacheInvalidate("qaSamples:v5");
      cacheInvalidate("qaSamples:v6");
      cacheInvalidate("qaMatrix");
      cacheInvalidate("promptImprove:mismatches");
      cacheInvalidate("qaMatrix:v2:default");
      cacheInvalidate("qaMatrix:v5:auto");
      if (evalSheetId) {
        cacheInvalidate(`qaMatrix:v2:${evalSheetId}`);
        cacheInvalidate(`qaMatrix:v5:${evalSheetId}`);
      }
      await refresh();
      if (selectedId) await loadCompare(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleBookmark = () => {
    if (!selectedId) return;
    if (bookmarks.includes(selectedId)) persistBookmarks(bookmarks.filter((x) => x !== selectedId));
    else persistBookmarks([...bookmarks, selectedId]);
  };

  const checkedCount = checked.size;
  const unevaluatedCount = filtered.filter((s) => s.matchGrade === "unevaluated").length;
  const mismatchCount = filtered.filter((s) => s.matchGrade === "result_mismatch").length;
  const staleCount = filtered.filter((s) => s.isStaleSheet).length;

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">AI 비교·개선</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-secondary)]">
            불일치 · 수기 memo · AI reason/evidence · 체크 재평가
            {data?.source ? (
              <>
                {" "}
                · <code className="text-[11px]">{data.source}</code>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
            <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
            오디오 보관
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--fg-secondary)]">
            <input type="checkbox" checked={onlyMismatch} onChange={(e) => setOnlyMismatch(e.target.checked)} />
            결과 미일치만
          </label>
          <button type="button" className="qms-btn-ghost" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading || busy ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>
      </header>

      {/* 평가에 사용할 평가표 */}
      <section className="qms-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold text-[var(--fg-tertiary)]">평가에 사용할 평가표</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className="qms-input !h-9 max-w-full text-[13px] font-semibold"
              value={evalSheetId ?? activeSheet?.versionId ?? ""}
              disabled={!sheets.length && !activeSheet}
              onChange={(e) => setEvalSheetId(e.target.value)}
            >
              {(sheets.length
                ? sheets
                : activeSheet
                  ? [
                      {
                        versionId: activeSheet.versionId,
                        versionLabel: activeSheet.versionLabel,
                        status: activeSheet.status,
                        isProduction: true,
                        criteriaCount: activeSheet.criteriaCount,
                        changeNote: activeSheet.changeNote,
                        createdAt: activeSheet.createdAt,
                      },
                    ]
                  : []
              ).map((s) => (
                <option key={s.versionId} value={s.versionId}>
                  {s.versionLabel || s.versionId.slice(0, 8)}
                  {s.isProduction || s.status === "production" ? " (production)" : ` (${s.status})`}
                </option>
              ))}
            </select>
            {selectedEvalSheet?.isProduction || selectedEvalSheet?.status === "production" ? (
              <span className="qms-chip-prod qms-chip">production</span>
            ) : selectedEvalSheet ? (
              <span className="qms-chip-draft qms-chip">{selectedEvalSheet.status}</span>
            ) : null}
          </div>
          {selectedEvalSheet ? (
            <>
              <div className="mt-1 text-[12px] text-[var(--fg-secondary)]">
                기준 {selectedEvalSheet.criteriaCount}개
                {" · "}
                {selectedEvalSheet.createdAt?.slice(0, 16) || "—"}
              </div>
              {selectedEvalSheet.changeNote ? (
                <div className="mt-1 text-[11.5px] text-[var(--fg-tertiary)]">{selectedEvalSheet.changeNote}</div>
              ) : null}
              <div className="mt-1 font-mono text-[10px] text-[var(--fg-tertiary)]">{selectedEvalSheet.versionId}</div>
              <div className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                「체크된 항목 재평가」 실행 시 이 평가표를 사용합니다
              </div>
            </>
          ) : (
            <div className="mt-1 text-[13px] text-[var(--fg-tertiary)]">평가표 정보를 불러오는 중…</div>
          )}
        </div>
        <a href="/eval-design/sheets" className="qms-btn-ghost no-underline">
          평가표 관리 →
        </a>
      </section>

      {/* 일치 등급 필터 */}
      <section className="flex flex-wrap items-center gap-1.5">
        {GRADE_FILTERS.map((g) => {
          const count =
            g.key === "all"
              ? Object.values(listGradeCounts).reduce((a, b) => a + b, 0)
              : (listGradeCounts[g.key] ?? 0);
          const active = gradeFilter === g.key;
          return (
            <button
              key={g.key}
              type="button"
              className={active ? "qms-btn-primary" : "qms-btn-ghost"}
              onClick={() => setGradeFilter(g.key)}
            >
              {g.label}
              <span className="ml-1 opacity-70">{count}</span>
            </button>
          );
        })}
      </section>

      {/* 일괄 선택 / 재평가 */}
      <section className="qms-card flex flex-wrap items-center gap-2 p-3">
        <span className="px-1 text-[12px] font-semibold text-[var(--fg-secondary)]">
          체크 {checkedCount}건
        </span>
        <button type="button" className="qms-btn-ghost" disabled={busy || !unevaluatedCount} onClick={selectUnevaluated}>
          미평가 전부 ({unevaluatedCount})
        </button>
        <button type="button" className="qms-btn-ghost" disabled={busy || !mismatchCount} onClick={selectMismatch}>
          불일치 전부 ({mismatchCount})
        </button>
        <button type="button" className="qms-btn-ghost" disabled={busy || !staleCount} onClick={selectStale}>
          과거 평가표 ({staleCount})
        </button>
        <button type="button" className="qms-btn-ghost" disabled={busy || !checkedCount} onClick={clearChecked}>
          선택 해제
        </button>
        <button
          type="button"
          className="qms-btn-primary ml-auto"
          disabled={busy || !checkedCount}
          onClick={() => void runEval([...checked])}
        >
          {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Play className="mr-1 inline h-3.5 w-3.5" />}
          체크된 항목 재평가 ({checkedCount})
        </button>
      </section>

      {error && (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">{error}</div>
      )}
      {ok && (
        <div className="rounded-[var(--radius-md)] bg-[var(--success-subtle)] px-3 py-2 text-[13px] text-[var(--c-green-600)]">{ok}</div>
      )}

      <div className="qms-layout-split">
        <section className="qms-card overflow-hidden">
          <table className="qms-table">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    aria-label="목록 전체 선택"
                  />
                </th>
                <th>conversation</th>
                <th>수기</th>
                <th>AI</th>
                <th>일치 등급</th>
                <th>평가표</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.conversationId}
                  className={selectedId === s.conversationId ? "qms-row-active" : ""}
                  onClick={() => setSelectedId(s.conversationId)}
                >
                  <td
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCheck(s.conversationId);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(s.conversationId)}
                      onChange={(e) => toggleCheck(s.conversationId, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${s.conversationId} 선택`}
                    />
                  </td>
                  <td className="font-mono text-[11px]">{s.conversationId.slice(0, 14)}…</td>
                  <td>{s.humanResult || "—"}</td>
                  <td>{s.aiLabel ?? "—"}</td>
                  <td>
                    <span
                      className={`font-semibold ${GRADE_STYLE[s.matchGrade] ?? ""}`}
                      title={`공통 ${s.itemOverlap} · 수기 ${s.humanItemCount} · AI ${s.aiItemCount}`}
                    >
                      {s.matchGradeLabel}
                    </span>
                    {bookmarks.includes(s.conversationId) ? " ★" : ""}
                  </td>
                  <td className="text-[11px]">
                    {!s.hasQaResult ? (
                      <span className="text-[var(--fg-tertiary)]">—</span>
                    ) : s.isCurrentSheet ? (
                      <span className="qms-chip-prod qms-chip" title={s.promptVersionId ?? ""}>
                        {s.promptVersionLabel ?? "현재"}
                      </span>
                    ) : (
                      <span className="qms-chip-draft qms-chip" title={s.promptVersionId ?? ""}>
                        {s.promptVersionLabel ?? "과거"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[var(--fg-tertiary)]">
                    {loading ? <Loader2 className="inline h-5 w-5 animate-spin" /> : "샘플 없음"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <aside className="qms-card sticky top-4 max-h-[calc(100vh-6rem)] space-y-3 overflow-y-auto p-4">
          {compare ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">케이스 상세</div>
                  <div className="break-all font-mono text-[11px] text-[var(--fg-secondary)]">{compare.conversationId}</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <Link
                    href={`/call-quality?conversationId=${encodeURIComponent(compare.conversationId)}`}
                    className="qms-btn-ghost inline-flex items-center gap-1 no-underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    상세 평가 보기
                  </Link>
                  <button type="button" className="qms-btn-ghost" onClick={toggleBookmark}>
                    {bookmarks.includes(compare.conversationId) ? "북마크 해제" : "재학습 북마크"}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-2">
                  <div className="text-[10px] text-[var(--fg-tertiary)]">수기</div>
                  <div className="font-bold">{compare.humanResult ?? "—"}</div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-2">
                  <div className="text-[10px] text-[var(--fg-tertiary)]">AI</div>
                  <div className="font-bold">{compare.aiLabel ?? "—"}</div>
                </div>
              </div>
              <div className="text-[12px]">
                {(() => {
                  const row = samples.find((s) => s.conversationId === compare.conversationId);
                  const grade = row?.matchGrade;
                  const label = row?.matchGradeLabel;
                  if (!grade || grade === "unevaluated") {
                    return <span className="text-[var(--fg-tertiary)]">미평가</span>;
                  }
                  return (
                    <span className={`font-semibold ${GRADE_STYLE[grade]}`}>
                      {label}
                      {row ? (
                        <span className="ml-2 font-normal text-[var(--fg-tertiary)]">
                          공통 {row.itemOverlap} · 수기 {row.humanItemCount} · AI {row.aiItemCount}
                        </span>
                      ) : null}
                    </span>
                  );
                })()}
                {compare.criterionSummary && (
                  <span className="ml-2 text-[var(--fg-tertiary)]">
                    TP {compare.criterionSummary.tp} · FP {compare.criterionSummary.fp} · FN{" "}
                    {compare.criterionSummary.fn} · TN {compare.criterionSummary.tn}
                  </span>
                )}
              </div>

              {/* 수기 memo_detail */}
              <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                <div className="mb-1 text-[11px] font-bold text-[var(--fg-tertiary)]">
                  수기 memo_detail
                </div>
                {humanMemo ? (
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--fg-secondary)]">
                    {humanMemo}
                  </p>
                ) : (
                  <p className="text-[12px] text-[var(--fg-tertiary)]">memo_detail 없음</p>
                )}
              </div>

              <AiEvalBlock
                scores={scores}
                overallSummary={overallSummary}
                snapshot={compare?.result?.evaluation?.outputSchemaSnapshot}
              />

              {/* 항목별 비교 + reason/evidence */}
              <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1.5 text-[11px] font-bold text-[var(--fg-tertiary)]">
                  항목 비교 · 클릭 시 AI reason/evidence
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="qms-table text-[11px]">
                    <thead>
                      <tr>
                        <th>id</th>
                        <th>라벨</th>
                        <th>수기</th>
                        <th>AI</th>
                        <th>판정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(compare.criterionCompare ?? [])
                        .filter((r) => r.humanViolated || r.aiViolated)
                        .map((r) => {
                          const ai = checklistById.get(r.id);
                          const reason = r.aiReason || ai?.reason || "";
                          const evidence = ai?.evidence ?? [];
                          const open = expandedId === r.id;
                          return (
                            <Fragment key={r.id}>
                              <tr
                                className={open ? "qms-row-active" : ""}
                                onClick={() => setExpandedId(open ? null : r.id)}
                              >
                                <td className="font-mono">{r.id}</td>
                                <td className="whitespace-normal break-words" title={r.label}>
                                  {r.label}
                                  {(reason || evidence.length > 0) && (
                                    <span className="ml-1 text-[10px] text-[var(--info)]">{open ? "▲" : "▼"}</span>
                                  )}
                                </td>
                                <td>{r.humanViolated ? "부적합" : "—"}</td>
                                <td>{r.aiViolated == null ? "—" : r.aiViolated ? "부적합" : "적합"}</td>
                                <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                              </tr>
                              {open && (
                                <tr className="cursor-default bg-[var(--bg-subtle)]">
                                  <td colSpan={5} className="!py-2">
                                    {reason ? (
                                      <p className="text-[11.5px] leading-relaxed text-[var(--fg-secondary)]">
                                        <span className="font-semibold text-[var(--fg-tertiary)]">reason </span>
                                        {reason}
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-[var(--fg-tertiary)]">reason 없음</p>
                                    )}
                                    {evidence.length > 0 ? (
                                      <div className="mt-1">
                                        <span className="text-[10px] font-semibold text-[var(--fg-tertiary)]">evidence</span>
                                        <EvidenceList evidence={evidence} />
                                      </div>
                                    ) : (
                                      <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">evidence 없음</p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                  {!(compare.criterionCompare ?? []).some((r) => r.humanViolated || r.aiViolated) && (
                    <p className="px-3 py-6 text-center text-[12px] text-[var(--fg-tertiary)]">표시할 항목 없음</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-[13px] text-[var(--fg-tertiary)]">케이스를 선택하세요</p>
          )}
        </aside>
      </div>
    </div>
  );
}

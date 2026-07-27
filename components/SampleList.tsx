"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, AlertCircle, RefreshCw, Phone, Clock, CheckCircle2, Eye, Calendar } from "lucide-react";
import type { EvaluateEvent, EvaluateStep, EvaluationResult, EvaluationSample, SampleFilters } from "@/lib/types";
import type { CallQualityOrg } from "@/lib/callQualityOrg";
import { describeApiError } from "@/lib/apiError";
import { readNdjson } from "@/lib/ndjson";
import { formatClock } from "@/lib/format";
import ThresholdSlider from "./ThresholdSlider";
import FilterPanel from "./FilterPanel";

// 분석 진행 단계 표시(서버가 흘려보내는 progress 이벤트 기준).
const STEP_LABEL: Record<EvaluateStep, string> = {
  genesys: "Genesys에서 녹취 확보 중",
  download: "녹취 내려받는 중",
  transcode: "오디오 변환 중",
  analyze: "전사·채점 중 (가장 오래 걸려요)",
  save: "결과 저장 중",
};

// 필터를 URL(?f=...)에 실어 새로고침·공유 시에도 유지한다.
function filtersActive(f: SampleFilters): boolean {
  return Boolean(
    f.callDateStart ||
      f.callDateEnd ||
      f.callLenMin != null ||
      f.callLenMax != null ||
      f.conversationIds?.length ||
      f.phoneInquiryIds?.length ||
      f.adminUserIds?.length ||
      f.teams?.length ||
      f.categories?.length ||
      f.adminNames?.length,
  );
}
function readFiltersFromUrl(): SampleFilters {
  if (typeof window === "undefined") return {};
  try {
    const f = new URLSearchParams(window.location.search).get("f");
    return f ? (JSON.parse(f) as SampleFilters) : {};
  } catch {
    return {};
  }
}
function writeFiltersToUrl(f: SampleFilters) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (filtersActive(f)) url.searchParams.set("f", JSON.stringify(f));
  else url.searchParams.delete("f");
  window.history.replaceState(null, "", url.toString());
}

export default function SampleList({
  org,
  onResult,
  evaluatedIds,
  onView,
}: {
  org: CallQualityOrg;
  onResult: (r: EvaluationResult) => void;
  evaluatedIds: Set<string>;
  onView: (conversationId: string) => void;
}) {
  const [samples, setSamples] = useState<EvaluationSample[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [minSilenceSec, setMinSilenceSec] = useState(3);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; sec: number } | null>(null);
  const [showDone, setShowDone] = useState(false);
  // 초기값은 SSR-안전(빈 필터). URL 복원은 마운트 후 useEffect에서(하이드레이션 불일치 방지).
  const [appliedFilters, setAppliedFilters] = useState<SampleFilters>({});
  const [restored, setRestored] = useState(false);
  const restoredInitial = useRef<SampleFilters>({});

  async function loadSamples(filters: SampleFilters = appliedFilters) {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/call-quality/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, org }),
      });
      if (!res.ok) throw new Error(await describeApiError(res));
      const data = (await res.json()) as { samples: EvaluationSample[] };
      setSamples(data.samples ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "샘플 목록을 불러오지 못했어요");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    const urlFilters = readFiltersFromUrl(); // 클라이언트에서만 URL 읽기
    restoredInitial.current = urlFilters;
    setAppliedFilters(urlFilters);
    setRestored(true);
    loadSamples(urlFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(f: SampleFilters) {
    setAppliedFilters(f);
    writeFiltersToUrl(f);
    loadSamples(f);
  }

  async function evaluate(sample: EvaluationSample) {
    if (evaluatingId) return;
    const conversationId = sample.conversationId;
    setEvaluatingId(conversationId);
    setEvalError(null);
    setProgress(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, phoneInquiryId: sample.phoneInquiryId, minSilenceSec, org }),
      });
      // 권한·입력 오류만 상태코드로 온다. 처리 중 실패는 스트림 안의 error 이벤트로 온다
      // (스트림은 200을 먼저 보내서 상태코드에 실패를 실을 수 없다).
      if (!res.ok) throw new Error(await describeApiError(res));

      let result: EvaluationResult | null = null;
      for await (const ev of readNdjson<EvaluateEvent>(res.body)) {
        if (ev.type === "progress")
          setProgress({ label: STEP_LABEL[ev.step] ?? "분석 중", sec: Math.round(ev.elapsedMs / 1000) });
        else if (ev.type === "heartbeat")
          setProgress((p) => (p ? { ...p, sec: Math.round(ev.elapsedMs / 1000) } : p));
        else if (ev.type === "error") throw new Error(ev.message);
        else if (ev.type === "result") result = ev.result;
      }
      // result 없이 스트림이 끝났다 = 연결이 중간에 끊김. 서버 처리는 끝났을 수 있어 결과 보기를 안내.
      if (!result) throw new Error("연결이 끊겨 결과를 받지 못했어요.\n잠시 후 새로고침하면 저장된 결과가 보일 수 있어요.");
      onResult(result);
      setShowDone(true);
      window.setTimeout(() => setShowDone(false), 2800);
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : "분석에 실패했어요");
    } finally {
      setEvaluatingId(null);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <ThresholdSlider value={minSilenceSec} onChange={setMinSilenceSec} disabled={!!evaluatingId} />

      {/* 복원 시 한 번만 remount해 초기값 반영(첫 렌더는 서버와 동일한 빈 필터). */}
      <FilterPanel
        key={restored ? "restored" : "initial"}
        initial={restored ? restoredInitial.current : {}}
        onApply={applyFilters}
        disabled={loadingList || !!evaluatingId}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          분석 샘플 {samples.length > 0 && <b className="text-navy">{samples.length}건</b>}
        </p>
        <button
          type="button"
          onClick={() => loadSamples()}
          disabled={loadingList || !!evaluatingId}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </div>

      {evalError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-line">{evalError}</span>
        </div>
      )}

      {loadingList ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          샘플 불러오는 중…
        </div>
      ) : listError ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-line">{listError}</span>
        </div>
      ) : samples.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-400">
          분석할 샘플이 없어요.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {samples.map((s) => {
            const busy = evaluatingId === s.conversationId;
            const done = s.analyzed || evaluatedIds.has(s.conversationId);
            return (
              <li key={s.conversationId} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-semibold text-gray-900">{s.adminName || "(상담사 미상)"}</span>
                    {s.team && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{s.team}</span>
                    )}
                    {done && (
                      <span className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        완료
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                    {s.callDate && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-gray-400" />
                        {s.callDate}
                      </span>
                    )}
                    {s.callDurationSec != null && (
                      <span className="inline-flex items-center gap-1 text-navy">
                        <Clock className="h-3 w-3" />
                        {formatClock(s.callDurationSec)}
                      </span>
                    )}
                    {s.category && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{s.category}</span>
                    )}
                  </div>
                  {s.contentSnippet && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{s.contentSnippet}</p>}
                  <p className="mt-1 truncate font-mono text-[10px] text-gray-400">
                    상담이력 {s.phoneInquiryId || "—"} · {s.conversationId}
                  </p>
                </div>
                {busy ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white opacity-80"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    분석 중…
                  </button>
                ) : done ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onView(s.conversationId)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-hover"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      결과 보기
                    </button>
                    <button
                      type="button"
                      onClick={() => evaluate(s)}
                      disabled={!!evaluatingId}
                      title="다시 분석 (최신 결과로 갱신)"
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      재분석
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => evaluate(s)}
                    disabled={!!evaluatingId}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    분석
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {evaluatingId && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
          <Phone className="h-3.5 w-3.5" />
          {progress ? (
            <>
              {progress.label}… <span className="tabular-nums text-gray-500">{progress.sec}초 경과</span>
            </>
          ) : (
            "Genesys에서 녹취를 받아 분석 중이에요 (통화 길이에 따라 수십 초~수 분)"
          )}
        </p>
      )}

      {showDone && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-green-200 bg-white px-4 py-3 text-sm font-semibold text-green-700 shadow-lg">
          <CheckCircle2 className="h-4 w-4" />
          분석 완료 — 오른쪽에서 결과를 확인하세요
        </div>
      )}
    </div>
  );
}

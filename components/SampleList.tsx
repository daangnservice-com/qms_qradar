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
      f.adminNames?.length ||
      f.analyzedOnly ||
      f.highRiskOnly,
  );
}
function readFiltersFromUrl(): SampleFilters {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  try {
    const f = sp.get("f");
    if (f) return JSON.parse(f) as SampleFilters;
  } catch {
    /* ignore */
  }
  // /call-quality?conversationId=… 또는 conversation_id=… → 해당 콜만 필터
  const cid = (sp.get("conversationId") || sp.get("conversation_id") || "").trim();
  if (cid) return { conversationIds: [cid] };
  return {};
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
  deepLinkConversationId,
}: {
  org: CallQualityOrg;
  onResult: (r: EvaluationResult) => void;
  evaluatedIds: Set<string>;
  onView: (conversationId: string) => void;
  /** URL deep-link 시 해당 conversation 필터·결과 열기용 */
  deepLinkConversationId?: string | null;
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
  const samplesInflight = useRef<{ key: string; promise: Promise<EvaluationSample[]> } | null>(null);

  async function loadSamples(filters: SampleFilters = appliedFilters) {
    const key = JSON.stringify({ filters, org });
    const inflight = samplesInflight.current;
    if (inflight?.key === key) return inflight.promise;

    setLoadingList(true);
    setListError(null);
    const promise = (async () => {
      try {
        const res = await fetch("/api/call-quality/samples", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters, org }),
        });
        if (!res.ok) throw new Error(await describeApiError(res));
        const data = (await res.json()) as { samples: EvaluationSample[] };
        const list = data.samples ?? [];
        setSamples(list);
        return list;
      } catch (e) {
        setListError(e instanceof Error ? e.message : "샘플 목록을 불러오지 못했어요");
        return [];
      } finally {
        setLoadingList(false);
        if (samplesInflight.current?.key === key) samplesInflight.current = null;
      }
    })();
    samplesInflight.current = { key, promise };
    return promise;
  }

  useEffect(() => {
    const urlFilters = readFiltersFromUrl(); // 클라이언트에서만 URL 읽기
    // deepLink prop이 있으면 conversationIds 필터를 보강
    const withDeep =
      deepLinkConversationId && !urlFilters.conversationIds?.includes(deepLinkConversationId)
        ? {
            ...urlFilters,
            conversationIds: [...(urlFilters.conversationIds ?? []), deepLinkConversationId],
          }
        : urlFilters;
    restoredInitial.current = withDeep;
    setAppliedFilters(withDeep);
    setRestored(true);
    writeFiltersToUrl(withDeep);
    loadSamples(withDeep);
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
        <p className="text-[13px] text-[var(--fg-secondary)]">
          분석 샘플 {samples.length > 0 && <b className="text-[var(--brand)]">{samples.length}건</b>}
        </p>
        <button
          type="button"
          onClick={() => loadSamples()}
          disabled={loadingList || !!evaluatingId}
          className="qms-btn-ghost !h-8 text-[12px]"
        >
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loadingList ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </div>

      {evalError && (
        <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--danger)]/30 bg-[var(--danger-subtle)] px-4 py-3 text-[13px] text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-line">{evalError}</span>
        </div>
      )}

      {loadingList ? (
        <div className="qms-card flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--fg-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          샘플 불러오는 중…
        </div>
      ) : listError ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--danger)]/30 bg-[var(--danger-subtle)] px-4 py-3 text-[13px] text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-line">{listError}</span>
        </div>
      ) : samples.length === 0 ? (
        <div className="qms-card py-16 text-center text-[13px] text-[var(--fg-tertiary)]">분석할 샘플이 없어요.</div>
      ) : (
        <ul className="qms-card divide-y divide-[var(--border-subtle)] overflow-hidden">
          {samples.map((s) => {
            const busy = evaluatingId === s.conversationId;
            const done = s.analyzed || evaluatedIds.has(s.conversationId);
            return (
              <li key={s.conversationId} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="font-semibold text-[var(--fg-primary)]">{s.adminName || "(상담사 미상)"}</span>
                    {s.team && <span className="qms-chip">{s.team}</span>}
                    {done && (
                      <span className="qms-chip-prod qms-chip inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        완료
                      </span>
                    )}
                    {(s.highRiskFlagKeys ?? []).map((k) => (
                      <span
                        key={k}
                        className="inline-flex items-center rounded-[var(--radius-sm)] bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                      >
                        {k === "long_call" ? "장콜" : k === "agitated" ? "격앙" : k === "agent_speak_high" ? "발화과다" : k}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--fg-secondary)]">
                    {s.callDate && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-[var(--fg-tertiary)]" />
                        {s.callDate}
                      </span>
                    )}
                    {s.callDurationSec != null && (
                      <span className="inline-flex items-center gap-1 text-[var(--brand)]">
                        <Clock className="h-3 w-3" />
                        {formatClock(s.callDurationSec)}
                      </span>
                    )}
                    {s.category && <span className="qms-chip">{s.category}</span>}
                  </div>
                  {s.contentSnippet && (
                    <p className="mt-1 line-clamp-2 text-[12px] text-[var(--fg-secondary)]">{s.contentSnippet}</p>
                  )}
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--fg-tertiary)]">
                    상담이력 {s.phoneInquiryId || "—"} · {s.conversationId}
                  </p>
                </div>
                {busy ? (
                  <button type="button" disabled className="qms-btn-primary !h-9 opacity-80">
                    <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                    {org === "growth" ? "평가 중…" : "분석 중…"}
                  </button>
                ) : done ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => onView(s.conversationId)} className="qms-btn-primary !h-9">
                      <Eye className="mr-1 inline h-3.5 w-3.5" />
                      {org === "growth" ? "케이스 상세" : "결과 보기"}
                    </button>
                    <button
                      type="button"
                      onClick={() => evaluate(s)}
                      disabled={!!evaluatingId}
                      title={org === "growth" ? "다시 평가 (최신 결과로 갱신)" : "다시 분석 (최신 결과로 갱신)"}
                      className="qms-btn-ghost !h-9"
                    >
                      <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
                      {org === "growth" ? "재평가" : "재분석"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => evaluate(s)}
                    disabled={!!evaluatingId}
                    className="qms-btn-primary !h-9 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                    {org === "growth" ? "평가" : "분석"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {evaluatingId && (
        <p className="flex items-center justify-center gap-1.5 text-[12px] text-[var(--fg-tertiary)]">
          <Phone className="h-3.5 w-3.5" />
          {progress ? (
            <>
              {progress.label}… <span className="tabular-nums text-[var(--fg-secondary)]">{progress.sec}초 경과</span>
            </>
          ) : (
            "Genesys에서 녹취를 받아 분석 중이에요 (통화 길이에 따라 수십 초~수 분)"
          )}
        </p>
      )}

      {showDone && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--success)]/30 bg-[var(--bg-canvas)] px-4 py-3 text-[13px] font-semibold text-[var(--success)] shadow-lg">
          <CheckCircle2 className="h-4 w-4" />
          평가 완료 — 오른쪽에서 케이스 상세를 확인하세요
        </div>
      )}
    </div>
  );
}

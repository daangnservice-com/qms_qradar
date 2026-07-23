"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, AlertCircle, RefreshCw, Phone } from "lucide-react";
import type { EvaluationResult, EvaluationSample } from "@/lib/types";
import { describeApiError } from "@/lib/apiError";
import ThresholdSlider from "./ThresholdSlider";

export default function SampleList({ onResult }: { onResult: (r: EvaluationResult) => void }) {
  const [samples, setSamples] = useState<EvaluationSample[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [minSilenceSec, setMinSilenceSec] = useState(3);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  async function loadSamples() {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/call-quality/samples");
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
    loadSamples();
  }, []);

  async function evaluate(conversationId: string) {
    if (evaluatingId) return;
    setEvaluatingId(conversationId);
    setEvalError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, minSilenceSec }),
      });
      if (!res.ok) throw new Error(await describeApiError(res));
      onResult((await res.json()) as EvaluationResult);
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : "평가에 실패했어요");
    } finally {
      setEvaluatingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <ThresholdSlider value={minSilenceSec} onChange={setMinSilenceSec} disabled={!!evaluatingId} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          평가 샘플 {samples.length > 0 && <b className="text-navy">{samples.length}건</b>}
        </p>
        <button
          type="button"
          onClick={loadSamples}
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
          평가할 샘플이 없어요.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {samples.map((s) => {
            const busy = evaluatingId === s.conversationId;
            return (
              <li key={s.conversationId} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-900">{s.phoneInquiryId || "(ID 없음)"}</span>
                    {s.yearMonth && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">{s.yearMonth}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-gray-400">{s.conversationId}</p>
                  {s.contentSnippet && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{s.contentSnippet}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => evaluate(s.conversationId)}
                  disabled={!!evaluatingId}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      평가 중…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      평가
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {evaluatingId && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
          <Phone className="h-3.5 w-3.5" />
          Genesys에서 녹취를 받아 평가 중이에요 (통화 길이에 따라 수십 초~수 분)
        </p>
      )}
    </div>
  );
}

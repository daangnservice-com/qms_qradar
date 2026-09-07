"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Inbox, Loader2, MessageSquareText, RefreshCw } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import type { FeedbackSample, FeedbackSampleFilters } from "@/lib/feedbackSamples";
import FeedbackFilterPanel from "./FeedbackFilterPanel";

type FeedbackMode = "all" | "high-risk" | "needs-review" | "mine";

const MODE_LABEL: Record<FeedbackMode, string> = {
  all: "전체 문의",
  "high-risk": "고위험군 문의",
  "needs-review": "수기 평가 필요",
  mine: "내 문의 평가",
};

type ListedFeedbackSample = FeedbackSample & {
  analyzed?: boolean;
  analysisId?: string | null;
  analyzedAt?: string | null;
  aiLabel?: string | null;
};

function formatElapsed(seconds: number | null): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export default function FeedbackQualityEval({ mode = "all" }: { mode?: FeedbackMode }) {
  const [samples, setSamples] = useState<ListedFeedbackSample[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, EvaluationResult>>({});
  const [loading, setLoading] = useState(true);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FeedbackSampleFilters>({});
  const [adminOptions, setAdminOptions] = useState<string[]>([]);

  const loadSamples = async (requestedFilters: FeedbackSampleFilters = filters) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/evaluations/feedback/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: requestedFilters, limit: 100 }),
      });
      if (!response.ok) throw new Error("문의 샘플을 불러오지 못했습니다.");
      const data = (await response.json()) as { samples?: ListedFeedbackSample[]; adminOptions?: string[] };
      const next = data.samples ?? [];
      setSamples(next);
      setAdminOptions((current) => [...new Set([...current, ...(data.adminOptions ?? [])])].sort((a, b) => a.localeCompare(b, "ko")));
      setSelectedId((current) => current && next.some((sample) => sample.sourceId === current) ? current : next[0]?.sourceId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "문의 샘플을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSamples({});
  }, []);

  const selected = useMemo(
    () => samples.find((sample) => sample.sourceId === selectedId) ?? null,
    [samples, selectedId],
  );
  const selectedResult = selected ? results[selected.sourceId] : undefined;

  const evaluateSelected = async () => {
    if (!selected) return;
    setEvaluatingId(selected.sourceId);
    setError(null);
    try {
      const response = await fetch("/api/evaluate/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: selected.sourceId }),
      });
      const data = (await response.json().catch(() => ({}))) as { result?: EvaluationResult; error?: string };
      if (!response.ok || !data.result) throw new Error(data.error ?? "문의 평가에 실패했습니다.");
      setResults((current) => ({ ...current, [selected.sourceId]: data.result! }));
      setSamples((current) =>
        current.map((sample) =>
          sample.sourceId === selected.sourceId ? { ...sample, analyzed: true, aiLabel: null } : sample,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "문의 평가에 실패했습니다.");
    } finally {
      setEvaluatingId(null);
    }
  };

  return (
    <div className="qms-page flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-extrabold tracking-tight text-[var(--fg-primary)]">
            <MessageSquareText className="h-5 w-5 text-[var(--brand)]" />
            {MODE_LABEL[mode]}
            <span className="rounded-full bg-[var(--brand-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-hover)]">
              문의
            </span>
          </h1>
          <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)]">
            인앱 문의와 상담사 답변 원문을 확인하고 텍스트 기반 AI 평가를 실행합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSamples()}
          disabled={loading}
          className="qms-btn-ghost flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12px] font-semibold"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </header>

      {error && (
        <div className="mx-5 mt-4 rounded-[10px] border border-[var(--danger)]/30 bg-[var(--danger-subtle)] px-3 py-2 text-[12px] text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="qms-page-body grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_340px] gap-3 p-3">
        <section className="qms-card flex min-h-0 flex-col overflow-hidden rounded-[14px] border">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-bold">
              <Inbox className="h-4 w-4 text-[var(--brand)]" />
              문의 목록
            </div>
            <span className="text-[11px] text-[var(--fg-tertiary)]">{samples.length}건</span>
          </div>
          <div className="border-b border-[var(--border-subtle)] p-2">
            <FeedbackFilterPanel
              adminOptions={adminOptions}
              initial={filters}
              disabled={loading}
              onApply={(nextFilters) => {
                setFilters(nextFilters);
                void loadSamples(nextFilters);
              }}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && !samples.length ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[var(--fg-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중
              </div>
            ) : samples.length ? (
              samples.map((sample) => (
                <button
                  key={sample.sourceId}
                  type="button"
                  onClick={() => setSelectedId(sample.sourceId)}
                  className={`mb-1 w-full rounded-[10px] px-3 py-2.5 text-left transition ${
                    selectedId === sample.sourceId
                      ? "bg-[var(--brand-subtle)]"
                      : "hover:bg-[var(--bg-muted)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--fg-tertiary)]">{sample.feedbackDate}</span>
                    {sample.analyzed && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] font-semibold text-[var(--fg-primary)]">
                    {sample.contentSnippet || "(문의 내용 없음)"}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-[var(--fg-tertiary)]">
                    {sample.category || "분류 없음"} · {sample.team || "팀 미지정"}
                  </p>
                </button>
              ))
            ) : (
          <div className="py-10 text-center text-[12px] text-[var(--fg-tertiary)]">표시할 문의가 없습니다.</div>
            )}
          </div>
        </section>

        <section className="qms-card flex min-h-0 flex-col overflow-hidden rounded-[14px] border">
          {selected ? (
            <>
              <div className="border-b border-[var(--border-subtle)] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-[var(--fg-tertiary)]">THREAD #{selected.threadId}</p>
                    <h2 className="mt-1 text-[16px] font-bold text-[var(--fg-primary)]">
                      {selected.category || "분류 없음"}
                    </h2>
                  </div>
                  <div className="text-right text-[11px] text-[var(--fg-tertiary)]">
                    <p>{selected.team || "팀 미지정"}</p>
                    <p>{selected.adminName || "상담사 미지정"}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-4 text-[11px] text-[var(--fg-secondary)]">
                  <span>문의 {selected.feedbackCount}건</span>
                  <span>답변 {selected.replyCount}건</span>
                  <span>첫 답변 {formatElapsed(selected.responseTimeSec)}</span>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                {selected.turns.map((turn) => (
                  <article key={turn.turnId} className={`flex ${turn.speaker === "agent" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] ${turn.speaker === "agent" ? "items-end" : "items-start"}`}>
                      <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
                        <span className="font-bold">{turn.speakerLabel}</span>
                        {turn.occurredAt && <span>{turn.occurredAt}</span>}
                      </div>
                      <div className={`whitespace-pre-wrap rounded-[12px] px-3.5 py-3 text-[12.5px] leading-6 ${
                        turn.speaker === "agent"
                          ? "bg-[var(--brand-subtle)] text-[var(--fg-primary)]"
                          : "bg-[var(--bg-muted)] text-[var(--fg-primary)]"
                      }`}>
                        {turn.text}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--fg-tertiary)]">문의 스레드를 선택하세요.</div>
          )}
        </section>

        <section className="qms-card flex min-h-0 flex-col overflow-hidden rounded-[14px] border">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3 text-[13px] font-bold">
            <Bot className="h-4 w-4 text-[var(--brand)]" />
            AI 평가
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selected && (
              <button
                type="button"
                onClick={() => void evaluateSelected()}
                disabled={evaluatingId === selected.sourceId}
                className="qms-btn-primary mb-4 flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-[12px] font-bold text-white disabled:opacity-60"
              >
                {evaluatingId === selected.sourceId && <Loader2 className="h-4 w-4 animate-spin" />}
                {evaluatingId === selected.sourceId ? "평가 중..." : selected.analyzed ? "다시 평가하기" : "AI 평가 실행"}
              </button>
            )}
            {selectedResult ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(selectedResult.evaluation.scores ?? {}).map(([key, score]) => (
                    <div key={key} className="rounded-[10px] bg-[var(--bg-muted)] p-3">
                      <p className="text-[10px] text-[var(--fg-tertiary)]">{key}</p>
                      <p className="mt-1 text-[20px] font-extrabold text-[var(--brand)]">{score.score}</p>
                      <p className="mt-1 text-[11px] leading-5 text-[var(--fg-secondary)]">{score.comment}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className="text-[11px] font-bold text-[var(--fg-tertiary)]">총평</h3>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[var(--fg-secondary)]">
                    {typeof selectedResult.evaluation.overallSummary === "string"
                      ? selectedResult.evaluation.overallSummary
                      : Object.values(selectedResult.evaluation.overallSummary).join("\n")}
                  </p>
                </div>
                {!!selectedResult.evaluation.csChecklist?.length && (
                  <div>
                    <h3 className="text-[11px] font-bold text-[var(--fg-tertiary)]">체크리스트</h3>
                    <div className="mt-2 space-y-2">
                      {selectedResult.evaluation.csChecklist.map((criterion) => (
                        <div key={criterion.id} className="rounded-[9px] border border-[var(--border-subtle)] p-2.5">
                          <p className="text-[11px] font-semibold">
                            <span className={criterion.violated ? "text-[var(--danger)]" : "text-[var(--success)]"}>
                              {criterion.violated ? "위반" : "정상"}
                            </span>{" "}
                            #{criterion.id}
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-[var(--fg-secondary)]">{criterion.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[180px] items-center justify-center text-center text-[12px] leading-5 text-[var(--fg-tertiary)]">
                AI 평가를 실행하면<br />이 영역에 결과가 표시됩니다.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

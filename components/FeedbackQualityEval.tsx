"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@seed-design/react";
import { Bot, Loader2, MessageSquareText, RefreshCw } from "lucide-react";
import type { EvaluationTurn } from "@/lib/evaluationChannel";
import type { EvaluationResult, HighRiskFlagHit } from "@/lib/types";
import type { FeedbackListFilters, FeedbackSample, FeedbackSampleFilters } from "@/lib/feedbackSamples";
import { replyAdminNamesForDisplay } from "@/lib/feedbackAdmins";
import type { HighRiskFlagRule } from "@/lib/highRiskFlags";
import CsatPanel, { CsatRateBadge } from "./CsatPanel";
import EvalCaseDetail from "./EvalCaseDetail";
import FeedbackFilterPanel from "./FeedbackFilterPanel";
import QmsLoadingOverlay from "./QmsLoadingOverlay";
import SampleListQuickFilters, { type HighRiskFlagOption } from "./SampleListQuickFilters";

type FeedbackMode = "all" | "high-risk" | "needs-review" | "mine";

const MODE_LABEL: Record<FeedbackMode, string> = {
  all: "전체 문의",
  "high-risk": "고위험군",
  "needs-review": "미검수건",
  mine: "내 문의 평가",
};

type ListedFeedbackSample = FeedbackSample & {
  analyzed?: boolean;
  analysisId?: string | null;
  analyzedAt?: string | null;
  aiLabel?: string | null;
  highRiskFlags?: HighRiskFlagHit[];
};

type FeedbackResultMeta = {
  analysisId?: string | null;
  purpose?: string | null;
  promptVersionId?: string | null;
  promptVersion?: string | null;
  promptVersionStatus?: "draft" | "production" | "archived" | null;
  aiLabel?: string | null;
  analyzedAt?: string | null;
  analyzedBy?: string | null;
};

function formatElapsed(seconds: number | null): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

/**
 * 목록에 보여줄 스레드 처리 시각. 뷰에 「해결」 컬럼이 없어서 마지막 답변,
 * 답변이 없으면 마지막 이벤트를 쓴다. 값은 이미 KST라 파싱 없이 자른다.
 */
function formatThreadTime(sample: FeedbackSample): string {
  const raw = (sample.lastReplyAt || sample.lastEventAt || sample.firstFeedbackAt || "").replace("T", " ");
  if (!raw) return "-";
  const [date = "", time = ""] = raw.split(" ");
  return `${date.slice(5)} ${time.slice(0, 5)}`.trim();
}

/** 답변 어드민 이름. 마지막 답변자를 앞에 두고, 여럿이면 +나머지. */
function replyAdminLabel(sample: FeedbackSample): string {
  const names = replyAdminNamesForDisplay(sample);
  if (!names.length) return "";
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

/** 녹취 선정 1행과 같은 「이름 (팀)」. 답변 어드민 기준, 여럿이면 +나머지. */
function agentLine(sample: FeedbackSample): { title: string; names: string } {
  const names = replyAdminNamesForDisplay(sample);
  const label = replyAdminLabel(sample) || "(미상)";
  const team = sample.team ? ` (${sample.team})` : "";
  return { title: `${label}${team}`, names: names.join(", ") };
}

/** 인앱 문의 한 건의 CS 어드민 워크스페이스. 답변(reply) 딥링크는 아직 없다. */
const FEEDBACK_WORKSPACE_URL = "https://cs.kr.wekarrot.net/admin/feedback_workspaces";

function TurnSourceId({ turn }: { turn: EvaluationTurn }) {
  const id = turn.sourceId?.trim();
  if (!id) return null;
  if (turn.speaker === "customer") {
    return (
      <a
        href={`${FEEDBACK_WORKSPACE_URL}/${id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[var(--info)] hover:underline"
        title="CS 어드민에서 이 문의 열기"
      >
        {id}
      </a>
    );
  }
  return (
    <span className="font-mono" title="답변 ID">
      {id}
    </span>
  );
}

/** 문의 / 답변 건수. 문의는 파랑, 답변은 빨강. 전화 목록의 STT 뱃지 자리에 둔다. */
function CountPair({ feedbackCount, replyCount }: { feedbackCount: number; replyCount: number }) {
  return (
    <span
      className="shrink-0 text-[11px] font-bold tabular-nums"
      title={`문의 ${feedbackCount}건 / 답변 ${replyCount}건`}
    >
      <span className="text-[var(--info)]">{feedbackCount}</span>
      <span className="mx-0.5 font-normal text-[var(--fg-tertiary)]">/</span>
      <span className="text-[var(--danger)]">{replyCount}</span>
    </span>
  );
}

/** 칩을 연달아 누를 때 매번 조회하지 않도록 (콜 품질 녹취 선정과 같은 간격) */
const QUICK_FILTER_DEBOUNCE_MS = 400;

/** 답변이 아직 없는 스레드는 평가할 게 없어서 기본으로 제외한다. */
const DEFAULT_FIELD_FILTERS: FeedbackSampleFilters = { replyCountMin: 1, humanCountMin: 1 };

/** 아코디언 밖 상시 노출 필터. 인앱 문의에 값이 있는 것만 쓴다. */
type QuickFilters = Pick<
  FeedbackListFilters,
  "analyzedOnly" | "csatRates" | "csatIncludeNone" | "highRiskOnly" | "highRiskFlagKeys"
>;

export default function FeedbackQualityEval({ mode = "all" }: { mode?: FeedbackMode }) {
  const [samples, setSamples] = useState<ListedFeedbackSample[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, EvaluationResult>>({});
  const [resultMeta, setResultMeta] = useState<Record<string, FeedbackResultMeta>>({});
  const [loading, setLoading] = useState(true);
  const [loadingResult, setLoadingResult] = useState(false);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldFilters, setFieldFilters] = useState<FeedbackSampleFilters>(DEFAULT_FIELD_FILTERS);
  const [quickFilters, setQuickFilters] = useState<QuickFilters>(() =>
    mode === "high-risk" ? { highRiskOnly: true } : {},
  );
  const [highRiskOptions, setHighRiskOptions] = useState<HighRiskFlagOption[]>([]);
  const appliedFilters = useRef<FeedbackListFilters>({
    ...DEFAULT_FIELD_FILTERS,
    ...(mode === "high-risk" ? { highRiskOnly: true } : {}),
  });
  const quickFilterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSamples = async (requestedFilters: FeedbackListFilters = appliedFilters.current) => {
    appliedFilters.current = requestedFilters;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/evaluations/feedback/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: requestedFilters, limit: 100 }),
      });
      if (!response.ok) throw new Error("문의 샘플을 불러오지 못했습니다.");
      const data = (await response.json()) as {
        samples?: ListedFeedbackSample[];
        rules?: HighRiskFlagRule[];
      };
      const next = data.samples ?? [];
      setSamples(next);
      setHighRiskOptions(
        (data.rules ?? []).filter((rule) => rule.enabled).map((rule) => ({ key: rule.key, label: rule.label })),
      );
      setSelectedId((current) => current && next.some((sample) => sample.sourceId === current) ? current : next[0]?.sourceId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "문의 샘플을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSamples({
      ...DEFAULT_FIELD_FILTERS,
      ...(mode === "high-risk" ? { highRiskOnly: true } : {}),
    });
    return () => {
      if (quickFilterTimer.current) clearTimeout(quickFilterTimer.current);
    };
  }, [mode]);

  const patchQuickFilters = (patch: {
    analyzedOnly?: boolean;
    csatRates?: number[];
    csatIncludeNone?: boolean;
    highRiskOnly?: boolean;
    highRiskFlagKeys?: string[];
  }) => {
    setQuickFilters((prev) => {
      const next: QuickFilters = { ...prev };
      if (patch.analyzedOnly !== undefined) next.analyzedOnly = patch.analyzedOnly || undefined;
      if (patch.csatRates !== undefined) {
        next.csatRates = patch.csatRates.length ? [...patch.csatRates].sort((a, b) => a - b) : undefined;
      }
      if (patch.csatIncludeNone !== undefined) next.csatIncludeNone = patch.csatIncludeNone || undefined;
      if (patch.highRiskOnly !== undefined) next.highRiskOnly = patch.highRiskOnly || undefined;
      if (patch.highRiskFlagKeys !== undefined) {
        next.highRiskFlagKeys = patch.highRiskFlagKeys.length ? patch.highRiskFlagKeys : undefined;
      }

      if (quickFilterTimer.current) clearTimeout(quickFilterTimer.current);
      quickFilterTimer.current = setTimeout(() => {
        // 아코디언에서 적용한 필드 필터는 그대로 두고 빠른 필터만 덮어쓴다.
        void loadSamples({ ...appliedFilters.current, ...next });
      }, QUICK_FILTER_DEBOUNCE_MS);

      return next;
    });
  };

  const selected = useMemo(
    () => samples.find((sample) => sample.sourceId === selectedId) ?? null,
    [samples, selectedId],
  );
  const selectedResult = selected ? results[selected.sourceId] : undefined;
  const selectedMeta = selected ? resultMeta[selected.sourceId] : undefined;

  const fetchResult = useCallback(async (sourceId: string): Promise<EvaluationResult | null> => {
    try {
      const response = await fetch(`/api/evaluations/feedback/results?sourceId=${encodeURIComponent(sourceId)}`);
      if (response.status === 404) return null;
      const data = (await response.json().catch(() => ({}))) as {
        result?: EvaluationResult;
        meta?: FeedbackResultMeta;
        error?: string;
      };
      if (!response.ok || !data.result) throw new Error(data.error ?? "저장된 평가 결과를 불러오지 못했습니다.");
      const withId = { ...data.result, sourceId, analysisId: data.meta?.analysisId ?? data.result.analysisId };
      setResults((current) => ({ ...current, [sourceId]: withId }));
      if (data.meta) {
        setResultMeta((current) => ({ ...current, [sourceId]: data.meta! }));
        setSamples((current) =>
          current.map((sample) =>
            sample.sourceId === sourceId
              ? {
                  ...sample,
                  analyzed: true,
                  analysisId: data.meta?.analysisId ?? sample.analysisId,
                  analyzedAt: data.meta?.analyzedAt ?? sample.analyzedAt,
                  aiLabel: data.meta?.aiLabel ?? sample.aiLabel,
                }
              : sample,
          ),
        );
      }
      return withId;
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장된 평가 결과를 불러오지 못했습니다.");
      return null;
    }
  }, []);

  const resultsRef = useRef(results);
  resultsRef.current = results;

  useEffect(() => {
    if (!selectedId || resultsRef.current[selectedId]) return;
    const sample = samples.find((row) => row.sourceId === selectedId);
    if (sample && !sample.analyzed) return;
    let cancelled = false;
    setLoadingResult(true);
    void fetchResult(selectedId).finally(() => {
      if (!cancelled) setLoadingResult(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, fetchResult, samples]);

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
      const data = (await response.json().catch(() => ({}))) as {
        result?: EvaluationResult;
        analysisId?: string;
        error?: string;
      };
      if (!response.ok || !data.result) throw new Error(data.error ?? "문의 평가에 실패했습니다.");
      setResults((current) => ({ ...current, [selected.sourceId]: data.result! }));
      setResultMeta((current) => ({
        ...current,
        [selected.sourceId]: {
          analysisId: data.analysisId ?? data.result?.analysisId,
          purpose: "text_eval",
          promptVersionId: data.result?.promptConfig?.version.versionId,
          promptVersion: data.result?.promptConfig?.version.versionLabel,
          promptVersionStatus: data.result?.promptConfig?.version.status ?? null,
          analyzedAt: new Date().toISOString(),
        },
      }));
      setSamples((current) =>
        current.map((sample) =>
          sample.sourceId === selected.sourceId
            ? { ...sample, analyzed: true, analysisId: data.analysisId ?? sample.analysisId, aiLabel: null }
            : sample,
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
      </header>

      {error && (
        <div className="mx-5 mt-4 rounded-[10px] border border-[var(--danger)]/30 bg-[var(--danger-subtle)] px-3 py-2 text-[12px] text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="qms-layout-run min-h-0 flex-1 p-4">
        <aside className="qms-run-panel relative">
          <div className="space-y-2 border-b border-[var(--border-subtle)] px-3 py-3">
            <div className="text-[14px] font-bold">문의 목록</div>
            <SampleListQuickFilters
              sections={["analyzed", "highRisk", "csat"]}
              analyzedOnly={Boolean(quickFilters.analyzedOnly)}
              highRiskOnly={Boolean(quickFilters.highRiskOnly)}
              highRiskFlagKeys={quickFilters.highRiskFlagKeys ?? []}
              highRiskOptions={highRiskOptions}
              csatRates={quickFilters.csatRates ?? []}
              csatIncludeNone={Boolean(quickFilters.csatIncludeNone)}
              disabled={Boolean(evaluatingId) || Boolean(fieldFilters.sourceIds?.length)}
              onChange={patchQuickFilters}
            />
            <FeedbackFilterPanel
              initial={fieldFilters}
              defaults={DEFAULT_FIELD_FILTERS}
              disabled={loading || Boolean(evaluatingId)}
              onApply={(nextFilters) => {
                const lookup = Boolean(nextFilters.sourceIds?.length);
                if (lookup) setQuickFilters({});
                setFieldFilters(nextFilters);
                void loadSamples(lookup ? nextFilters : { ...nextFilters, ...quickFilters });
              }}
            />
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-[11px] text-[var(--fg-tertiary)]">
            <span>
              {samples.length > 0 ? (
                <>
                  <b className="text-[var(--fg-secondary)]">{samples.length}</b>건
                </>
              ) : (
                "—"
              )}
            </span>
            <button
              type="button"
              className="qms-btn-ghost !h-7 !px-2 text-[11px]"
              disabled={loading || Boolean(evaluatingId)}
              onClick={() => void loadSamples()}
            >
              <RefreshCw className={`mr-1 inline h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              새로고침
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
            {loading && !samples.length ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[var(--fg-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중
              </div>
            ) : samples.length ? (
              samples.map((sample) => {
                const active = selectedId === sample.sourceId;
                const busy = evaluatingId === sample.sourceId;
                const agent = agentLine(sample);
                return (
                  <button
                    key={sample.sourceId}
                    type="button"
                    onClick={() => setSelectedId(sample.sourceId)}
                    className={`flex w-full items-start rounded-[var(--radius-lg)] border px-2 py-2 text-left transition ${
                      active
                        ? "border-[var(--brand)] bg-[var(--brand-subtle)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-muted)]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-bold" title={agent.names || undefined}>
                          {agent.title}
                        </span>
                        <CountPair feedbackCount={sample.feedbackCount} replyCount={sample.replyCount} />
                        <CsatRateBadge rate={sample.csat.rate} className="shrink-0" />
                        {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--brand)]" />}
                      </div>
                      {sample.analyzed && !busy && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge size="medium" variant="weak" tone="neutral" className="shrink-0">
                            AI 평가 완료
                          </Badge>
                        </div>
                      )}
                      {!!sample.highRiskFlags?.length && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {sample.highRiskFlags.map((hit) => (
                            <Badge
                              key={hit.key}
                              size="medium"
                              variant="weak"
                              tone="critical"
                              className="shrink-0"
                              title={hit.reason}
                            >
                              {hit.label}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[10.5px] tabular-nums text-[var(--fg-secondary)]">
                        <span className="whitespace-nowrap">{formatThreadTime(sample)}</span>
                        {sample.category ? <span>· {sample.category}</span> : null}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[9.5px] text-[var(--fg-tertiary)]">
                        thread {sample.threadId}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-8 text-center text-[12px] text-[var(--fg-tertiary)]">표시할 문의가 없습니다.</p>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
          {selected ? (
            <>
              <CsatPanel csatId={selected.csat.id} inquiryLabel="문의" />
              <div className="qms-run-panel">
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
                      <p>{replyAdminLabel(selected) || "어드민 미지정"}</p>
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
                          <TurnSourceId turn={turn} />
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
              </div>
            </>
          ) : (
            <div className="qms-run-panel flex flex-1 items-center justify-center text-[12px] text-[var(--fg-tertiary)]">
              문의 스레드를 선택하세요.
            </div>
          )}
        </section>

        <section className="qms-run-panel relative">
          <QmsLoadingOverlay
            show={loadingResult && !selectedResult}
            label="결과 불러오는 중…"
          />
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
            {selectedMeta?.promptVersion && (
              <p className="mb-3 text-[11px] text-[var(--fg-tertiary)]">
                평가셋 {selectedMeta.promptVersion}
                {selectedMeta.promptVersionStatus === "draft"
                  ? " · 초안"
                  : selectedMeta.promptVersionStatus === "production"
                    ? " · 운영"
                    : selectedMeta.promptVersionStatus === "archived"
                      ? " · 아카이브"
                      : ""}
              </p>
            )}
            {selectedResult ? (
              <EvalCaseDetail result={selectedResult} compactHeader />
            ) : (
              <div className="flex h-full min-h-[180px] items-center justify-center text-center text-[12px] leading-5 text-[var(--fg-tertiary)]">
                {selected?.analyzed
                  ? "저장된 평가 결과를 찾지 못했습니다."
                  : <>AI 평가를 실행하면<br />이 영역에 결과가 표시됩니다.</>}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

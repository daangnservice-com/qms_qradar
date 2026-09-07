"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@seed-design/react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Headphones,
  Loader2,
  Play,
  RefreshCw,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import type {
  EvaluateEvent,
  EvaluateStep,
  EvaluationResult,
  EvaluationSample,
  SampleFilters,
} from "@/lib/types";
import type { CallQualityOrg } from "@/lib/callQualityOrg";
import { describeApiError } from "@/lib/apiError";
import { readNdjson } from "@/lib/ndjson";
import { formatClock } from "@/lib/format";
import { deriveEvalLabel, labelsMatch } from "@/lib/resultParse";
import { deriveHumanReviewNeededLabel, deriveHumanResultLabel } from "@/lib/humanResultDerive";
import { estimateEvalMs, formatProgressWithEta, recordEvalEta } from "@/lib/evalEta";
import {
  displayReviewNeededLabel,
  hotColdLabel,
  hotColdTone,
  isReviewNeededRaw,
  reviewNeededLabel,
  reviewNeededTone,
  SOURCE_AI_TONE,
  SOURCE_HUMAN_TONE,
} from "@/lib/judgmentUi";
import FilterPanel from "@/components/FilterPanel";
import SampleListQuickFilters, { type ReviewFilterState, type SttFilterState } from "@/components/SampleListQuickFilters";
import EvalCaseDetail from "@/components/EvalCaseDetail";
import CallPlaybackBar, { type PlaybackMarker } from "@/components/CallPlaybackBar";
import SttReviewPanel from "@/components/SttReviewPanel";
import QmsLoadingOverlay from "@/components/QmsLoadingOverlay";
import { ActionButton } from "seed-design/ui/action-button";
import { buildSttChecklistBadges } from "@/lib/sttChecklistBadges";
import { resolveCriterionLabel } from "@/lib/criterionLabel";
import type { EvalReviewAnnotation } from "@/lib/evalReviewTypes";
import { annotationReviewNeeded } from "@/lib/evalReviewTypes";
import { bestMarkLabel } from "@/lib/evalReviewTypes";
import PromptImproveCheckoutWidget from "@/components/PromptImproveCheckoutWidget";
import ReviewStatusCheckoutWidget from "@/components/ReviewStatusCheckoutWidget";
import { buildHighRiskFlagLabelMap, resolveHighRiskFlagLabel } from "@/lib/highRiskFlagLabels";
import { buildCallQualityObserveDeepLink, readCallQualityDeepLink } from "@/lib/callQualityDeepLink";
import { copyTextToClipboard } from "@/lib/clipboard";
import { handleOf, sameEmail } from "@/lib/evalReviewClaim";
import type { HighRiskFlagRule } from "@/lib/highRiskFlags";
import {
  overlapsToOverlays,
  parseAgitatedSpansFromComment,
  sentimentSpansToOverlays,
  silencesToOverlays,
  type WaveformOverlay,
} from "@/lib/waveformOverlays";

const QUICK_FILTER_DEBOUNCE_MS = 1500;

const STEP_LABEL: Record<EvaluateStep, string> = {
  genesys: "Genesys에서 녹취 확보 중",
  download: "녹취 내려받는 중",
  transcode: "오디오 변환 중",
  analyze: "전사·채점 중 (가장 오래 걸려요)",
  save: "결과 저장 중",
};

function promptVersionBadgeMeta(status: string | null | undefined): {
  label: string;
  tone: "brand" | "informative" | "neutral";
} {
  if (status === "production") return { label: "운영 버전", tone: "brand" };
  if (status === "archived") return { label: "아카이브된 구버전", tone: "informative" };
  return { label: "초안 버전", tone: "neutral" };
}

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
      f.highRiskOnly ||
      f.reviewStatus ||
      f.sttStatus ||
      f.mineOnly,
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
  const cid = (sp.get("conversationId") || sp.get("conversation_id") || "").trim();
  if (cid) return { conversationIds: [cid] };
  return {};
}

function writeFiltersToUrl(f: SampleFilters) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (filtersActive(f)) url.searchParams.set("f", JSON.stringify(f));
  else url.searchParams.delete("f");
  // conversationId / autoEval 은 딥링크용으로 유지(필터 f와 병행)
  window.history.replaceState(null, "", url.toString());
}

function readDeepLink(): { conversationId: string | null; autoEval: boolean } {
  const { conversationId, autoEval } = readCallQualityDeepLink();
  return { conversationId, autoEval };
}

function quickFilterSlice(
  f: SampleFilters,
): Pick<SampleFilters, "analyzedOnly" | "highRiskOnly" | "reviewStatus" | "sttStatus"> {
  return {
    analyzedOnly: f.analyzedOnly,
    highRiskOnly: f.highRiskOnly,
    reviewStatus: f.reviewStatus,
    sttStatus: f.sttStatus,
  };
}

function reviewFilterState(f: SampleFilters): ReviewFilterState {
  return f.reviewStatus === "completed" || f.reviewStatus === "incomplete" ? f.reviewStatus : "";
}

function sttFilterState(f: SampleFilters): SttFilterState {
  return f.sttStatus === "present" || f.sttStatus === "absent" ? f.sttStatus : "";
}

export default function EvalProgressWorkbench({
  org,
  defaultFilters,
}: {
  org: CallQualityOrg;
  /** 고위험군 평가 등 — URL에 필터가 없을 때 기본값 */
  defaultFilters?: SampleFilters;
}) {
  const [samples, setSamples] = useState<EvaluationSample[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<SampleFilters>({});
  const [draftQuickFilters, setDraftQuickFilters] = useState<
    Pick<SampleFilters, "analyzedOnly" | "highRiskOnly" | "reviewStatus" | "sttStatus">
  >({});
  const [restored, setRestored] = useState(false);
  const restoredInitial = useRef<SampleFilters>({});
  const appliedFiltersRef = useRef<SampleFilters>({});
  const quickFilterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const samplesInflight = useRef<{ key: string; promise: Promise<EvaluationSample[]> } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, EvaluationResult>>({});
  const [resultMeta, setResultMeta] = useState<
    Record<
      string,
      {
        analysisId?: string | null;
        purpose?: string | null;
        promptVersionId?: string | null;
        promptVersion?: string | null;
        promptVersionStatus?: "draft" | "production" | "archived" | null;
        humanResult?: string | null;
        humanFinalLabel?: string | null;
        aiLabel?: string | null;
        match?: boolean | null;
        reviewCompletedAt?: string | null;
        reviewCompletedBy?: string | null;
      }
    >
  >({});
  const [loadingResult, setLoadingResult] = useState(false);
  const [reviewCompleteBusy, setReviewCompleteBusy] = useState(false);
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const { data: session } = useSession();
  const myEmail = session?.user?.email ?? "";

  const [minSilenceSec, setMinSilenceSec] = useState(3);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; sec: number; etaSec: number | null } | null>(null);

  const [reviews, setReviews] = useState<EvalReviewAnnotation[]>([]);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [observeLinkCopied, setObserveLinkCopied] = useState(false);
  const observeLinkCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highRiskFlagLabels, setHighRiskFlagLabels] = useState<Map<string, string>>(() =>
    buildHighRiskFlagLabelMap([]),
  );

  const seekRef = useRef<(sec: number) => void>(() => {});
  const centerScrollRef = useRef<HTMLElement | null>(null);
  const autoEvalTried = useRef(false);

  useEffect(() => {
    fetch("/api/eval-design/high-risk-flags")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { rules?: HighRiskFlagRule[] }) => {
        setHighRiskFlagLabels(buildHighRiskFlagLabelMap(d.rules));
      })
      .catch(() => {
        /* fallback labels only */
      });
  }, []);

  const loadReviews = useCallback(async (conversationId: string) => {
    try {
      const r = await fetch(
        `/api/call-quality/reviews?conversationId=${encodeURIComponent(conversationId)}`,
      );
      if (!r.ok) return;
      const d = (await r.json()) as { reviews?: EvalReviewAnnotation[] };
      setReviews(d.reviews ?? []);
    } catch {
      setReviews([]);
    }
  }, []);

  const saveReview = useCallback(
    async (
      input: Omit<EvalReviewAnnotation, "annotationId" | "updatedAt" | "updatedBy"> & {
        annotationId?: string;
      },
    ) => {
      setReviewBusy(true);
      try {
        const r = await fetch("/api/call-quality/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "수기 저장 실패");
        if (input.conversationId) await loadReviews(input.conversationId);
      } finally {
        setReviewBusy(false);
      }
    },
    [loadReviews],
  );

  const deleteReview = useCallback(
    async (annotationId: string) => {
      if (!selectedId) return;
      setReviewBusy(true);
      try {
        const r = await fetch("/api/call-quality/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            delete: true,
            annotationId,
            conversationId: selectedId,
          }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? "삭제 실패");
        }
        await loadReviews(selectedId);
      } finally {
        setReviewBusy(false);
      }
    },
    [loadReviews, selectedId],
  );

  const loadSamples = useCallback(
    async (filters: SampleFilters) => {
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
    },
    [org],
  );

  const fetchResult = useCallback(
    async (id: string): Promise<EvaluationResult | null> => {
      try {
        const r = await fetch(
          `/api/call-quality/results?conversationId=${encodeURIComponent(id)}&org=${org}`,
        );
        if (!r.ok) return null;
        const data = (await r.json()) as {
          result: EvaluationResult;
          meta?: {
            analysisId?: string | null;
            purpose?: string | null;
            promptVersionId?: string | null;
            promptVersion?: string | null;
            promptVersionStatus?: "draft" | "production" | "archived" | null;
            humanResult?: string | null;
            humanFinalLabel?: string | null;
            aiLabel?: string | null;
            match?: boolean | null;
            reviewCompletedAt?: string | null;
            reviewCompletedBy?: string | null;
          };
        };
        if (!data?.result) return null;
        const withId = {
          ...data.result,
          conversationId: id,
          analysisId: data.meta?.analysisId ?? data.result.analysisId,
        };
        setResults((prev) => ({ ...prev, [id]: withId }));
        if (data.meta) {
          setResultMeta((prev) => ({ ...prev, [id]: data.meta! }));
          setSamples((prev) =>
            prev.map((s) =>
              s.conversationId === id
                ? {
                    ...s,
                    analyzed: true,
                    reviewCompleted: Boolean(data.meta?.reviewCompletedAt) || s.reviewCompleted,
                    aiLabel: data.meta?.aiLabel ?? s.aiLabel ?? null,
                    humanResult: data.meta?.humanResult ?? s.humanResult ?? null,
                  }
                : s,
            ),
          );
        }
        return withId;
      } catch {
        return null;
      }
    },
    [org],
  );

  const completeReview = useCallback(async () => {
    if (!selectedId || reviewCompleteBusy) return;
    setReviewCompleteBusy(true);
    setEvalError(null);
    try {
      const r = await fetch("/api/call-quality/reviews/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedId, org }),
      });
      const data = (await r.json()) as {
        error?: string;
        analysisId?: string;
        promptVersionId?: string | null;
        promptVersion?: string | null;
        promptVersionStatus?: "draft" | "production" | "archived" | null;
        humanResult?: string;
        humanFinalLabel?: string | null;
        aiLabel?: string;
        match?: boolean | null;
        reviewCompletedAt?: string | null;
        reviewCompletedBy?: string | null;
      };
      if (!r.ok) throw new Error(data.error ?? "수기 검수 완료에 실패했습니다");
      setResultMeta((prev) => ({
        ...prev,
        [selectedId]: {
          analysisId: data.analysisId,
          promptVersionId: data.promptVersionId ?? prev[selectedId]?.promptVersionId ?? null,
          promptVersion: data.promptVersion ?? prev[selectedId]?.promptVersion ?? null,
          promptVersionStatus: data.promptVersionStatus ?? prev[selectedId]?.promptVersionStatus ?? null,
          humanResult: data.humanResult,
          humanFinalLabel: data.humanFinalLabel ?? null,
          aiLabel: data.aiLabel,
          match: data.match,
          reviewCompletedAt: data.reviewCompletedAt,
          reviewCompletedBy: data.reviewCompletedBy,
        },
      }));
      setResults((prev) => {
        const cur = prev[selectedId];
        if (!cur) return prev;
        return { ...prev, [selectedId]: { ...cur, analysisId: data.analysisId ?? cur.analysisId } };
      });
      setSamples((prev) =>
        prev.map((s) =>
          s.conversationId === selectedId
            ? {
                ...s,
                analyzed: true,
                reviewCompleted: true,
                aiLabel: data.aiLabel ?? s.aiLabel ?? null,
                humanResult: data.humanResult ?? s.humanResult ?? null,
                reviewClaimedBy: null,
                reviewClaimedAt: null,
              }
            : s,
        ),
      );
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : "수기 검수 완료에 실패했습니다");
    } finally {
      setReviewCompleteBusy(false);
    }
  }, [selectedId, reviewCompleteBusy, org]);

  const toggleClaim = useCallback(
    async (conversationId: string) => {
      if (!conversationId || claimBusyId || !!evaluatingId) return;
      const sample = samples.find((s) => s.conversationId === conversationId);
      if (sample?.reviewCompleted) return;
      const claimedBy = sample?.reviewClaimedBy ?? null;
      if (claimedBy && !sameEmail(claimedBy, myEmail)) return;
      setClaimBusyId(conversationId);
      setEvalError(null);
      try {
        const r = await fetch("/api/call-quality/reviews/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, release: sameEmail(claimedBy, myEmail) }),
        });
        const d = (await r.json()) as {
          error?: string;
          claim?: { claimedBy?: string; claimedAt?: string } | null;
        };
        if (!r.ok) throw new Error(d.error ?? "검수 찜하기에 실패했습니다");
        const nextBy = d.claim?.claimedBy ?? null;
        const nextAt = d.claim?.claimedAt ?? null;
        setSamples((prev) =>
          prev.map((s) =>
            s.conversationId === conversationId
              ? { ...s, reviewClaimedBy: nextBy, reviewClaimedAt: nextAt }
              : s,
          ),
        );
      } catch (e) {
        setEvalError(e instanceof Error ? e.message : "검수 찜하기에 실패했습니다");
      } finally {
        setClaimBusyId(null);
      }
    },
    [claimBusyId, evaluatingId, samples, myEmail],
  );

  const evaluate = useCallback(
    async (sample: EvaluationSample) => {
      if (evaluatingId) return;
      const conversationId = sample.conversationId;
      setEvaluatingId(conversationId);
      setEvalError(null);
      const etaSec = Math.round(estimateEvalMs(sample.callDurationSec) / 1000);
      setProgress({ label: "평가 준비 중", sec: 0, etaSec });
      setSelectedId(conversationId);
      const tWall0 = Date.now();
      try {
        const res = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            phoneInquiryId: sample.phoneInquiryId,
            minSilenceSec,
            org,
          }),
        });
        if (!res.ok) throw new Error(await describeApiError(res));

        let result: EvaluationResult | null = null;
        for await (const ev of readNdjson<EvaluateEvent>(res.body)) {
          if (ev.type === "progress")
            setProgress({
              label: STEP_LABEL[ev.step] ?? "평가 중",
              sec: Math.round(ev.elapsedMs / 1000),
              etaSec,
            });
          else if (ev.type === "heartbeat")
            setProgress((p) => (p ? { ...p, sec: Math.round(ev.elapsedMs / 1000) } : p));
          else if (ev.type === "error") throw new Error(ev.message);
          else if (ev.type === "result") result = ev.result;
        }
        if (!result) throw new Error("연결이 끊겨 결과를 받지 못했어요.\n잠시 후 새로고침하면 저장된 결과가 보일 수 있어요.");
        const withId = { ...result, conversationId };
        const nextAiLabel = deriveEvalLabel({ csChecklist: result.evaluation?.csChecklist });
        setResults((prev) => ({ ...prev, [conversationId]: withId }));
        setResultMeta((prev) => {
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
        setSamples((prev) =>
          prev.map((s) =>
            s.conversationId === conversationId
              ? {
                  ...s,
                  analyzed: true,
                  reviewCompleted: false,
                  aiLabel: nextAiLabel,
                  humanResult: null,
                  hasStt: Boolean((result.evaluation?.transcript ?? []).some((t) => (t.text ?? "").trim())),
                  sttSource: result.sttSource ?? s.sttSource ?? null,
                }
              : s,
          ),
        );
        recordEvalEta({
          totalMs: Date.now() - tWall0,
          callDurationSec: result.durationSec ?? sample.callDurationSec,
        });
      } catch (e) {
        setEvalError(e instanceof Error ? e.message : "평가에 실패했어요");
      } finally {
        setEvaluatingId(null);
        setProgress(null);
      }
    },
    [evaluatingId, minSilenceSec, org],
  );

  const selectCall = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setEvalError(null);
      void loadReviews(id);
      if (results[id]) return;
      setLoadingResult(true);
      await fetchResult(id);
      setLoadingResult(false);
    },
    [fetchResult, loadReviews, results],
  );

  // 초기 로드 + 딥링크
  useEffect(() => {
    const deep = readDeepLink();
    const urlFilters = readFiltersFromUrl();
    const merged: SampleFilters = { ...(defaultFilters ?? {}), ...urlFilters };
    const withDeep =
      deep.conversationId && !merged.conversationIds?.includes(deep.conversationId)
        ? { ...merged, conversationIds: [...(merged.conversationIds ?? []), deep.conversationId] }
        : merged;
    restoredInitial.current = withDeep;
    setAppliedFilters(withDeep);
    setDraftQuickFilters(quickFilterSlice(withDeep));
    setRestored(true);
    writeFiltersToUrl(withDeep);

    void (async () => {
      const list = await loadSamples(withDeep);
      const prefer = deep.conversationId || list[0]?.conversationId || null;
      if (!prefer) return;
      setSelectedId(prefer);
      void loadReviews(prefer);
      const existing = await fetchResult(prefer);
      if (!existing && deep.autoEval && !autoEvalTried.current) {
        autoEvalTried.current = true;
        const sample = list.find((s) => s.conversationId === prefer);
        if (sample) void evaluate(sample);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (f: SampleFilters) => {
    const next = defaultFilters?.mineOnly ? { ...f, mineOnly: true } : f;
    setAppliedFilters(next);
    setDraftQuickFilters(quickFilterSlice(next));
    writeFiltersToUrl(next);
    void loadSamples(next).then((list) => {
      if (!list.length) {
        setSelectedId(null);
        return;
      }
      if (!selectedId || !list.some((s) => s.conversationId === selectedId)) {
        void selectCall(list[0].conversationId);
      }
    });
  };

  const applyFieldFilters = (fields: SampleFilters) => {
    applyFilters({ ...quickFilterSlice(draftQuickFilters), ...fields });
  };

  useEffect(() => {
    appliedFiltersRef.current = appliedFilters;
  }, [appliedFilters]);

  useEffect(() => {
    return () => {
      if (quickFilterTimer.current) clearTimeout(quickFilterTimer.current);
      if (observeLinkCopiedTimer.current) clearTimeout(observeLinkCopiedTimer.current);
    };
  }, []);

  const patchQuickFilters = (patch: {
    analyzedOnly?: boolean;
    highRiskOnly?: boolean;
    reviewStatus?: ReviewFilterState;
    sttStatus?: SttFilterState;
  }) => {
    setDraftQuickFilters((prev) => {
      const next: Pick<SampleFilters, "analyzedOnly" | "highRiskOnly" | "reviewStatus" | "sttStatus"> = { ...prev };
      if (patch.analyzedOnly !== undefined) {
        next.analyzedOnly = patch.analyzedOnly || undefined;
      }
      if (patch.highRiskOnly !== undefined) {
        next.highRiskOnly = patch.highRiskOnly || undefined;
      }
      if (patch.reviewStatus !== undefined) {
        next.reviewStatus =
          patch.reviewStatus === "completed" || patch.reviewStatus === "incomplete"
            ? patch.reviewStatus
            : undefined;
      }
      if (patch.sttStatus !== undefined) {
        next.sttStatus =
          patch.sttStatus === "present" || patch.sttStatus === "absent" ? patch.sttStatus : undefined;
      }

      if (quickFilterTimer.current) clearTimeout(quickFilterTimer.current);
      quickFilterTimer.current = setTimeout(() => {
        const base = appliedFiltersRef.current;
        const merged: SampleFilters = {
          ...base,
          analyzedOnly: next.analyzedOnly,
          highRiskOnly: next.highRiskOnly,
          reviewStatus: next.reviewStatus,
          sttStatus: next.sttStatus,
        };
        applyFilters(merged);
      }, QUICK_FILTER_DEBOUNCE_MS);

      return next;
    });
  };

  const selected = samples.find((s) => s.conversationId === selectedId) ?? null;
  const activeResult = selectedId ? results[selectedId] ?? null : null;
  const activeMeta = selectedId ? resultMeta[selectedId] ?? null : null;
  const promptVersionInfo = activeMeta?.promptVersion || activeResult?.promptConfig?.version?.versionLabel || null;
  const promptVersionId = activeMeta?.promptVersionId || activeResult?.promptConfig?.version?.versionId || null;
  const promptVersionStatus =
    activeMeta?.promptVersionStatus || activeResult?.promptConfig?.version?.status || null;
  const promptBadge = promptVersionBadgeMeta(promptVersionStatus);
  const segments = activeResult?.evaluation?.transcript ?? [];
  const isEvaluating = evaluatingId === selectedId;
  const done = Boolean(selected?.analyzed || (selectedId && results[selectedId]));
  const reviewDone = Boolean(activeMeta?.reviewCompletedAt);
  const claimedBy = selected?.reviewClaimedBy ?? null;
  const claimedByMe = sameEmail(claimedBy, myEmail);
  const claimedByOther = Boolean(claimedBy && myEmail) && !claimedByMe;
  const reviewInProgress = Boolean(claimedBy) && !reviewDone;
  const aiLabel = activeResult?.evaluation?.csChecklist
    ? deriveEvalLabel({ csChecklist: activeResult.evaluation.csChecklist })
    : activeMeta?.aiLabel ?? null;
  const liveHumanResult = reviewDone
    ? activeResult?.evaluation?.csChecklist
      ? deriveHumanReviewNeededLabel(activeResult.evaluation.csChecklist, reviews)
      : activeMeta?.humanResult ?? null
    : null;
  const liveHumanFinal = reviewDone
    ? activeResult?.evaluation?.csChecklist
      ? deriveHumanResultLabel(activeResult.evaluation.csChecklist, reviews)
      : activeMeta?.humanFinalLabel ?? null
    : null;
  const liveMatch =
    liveHumanResult && (aiLabel || activeMeta?.aiLabel)
      ? labelsMatch(liveHumanResult, aiLabel || activeMeta?.aiLabel || "")
      : reviewDone
        ? (activeMeta?.match ?? null)
        : null;

  const playbackMarkers = useMemo<PlaybackMarker[]>(() => {
    const marks: PlaybackMarker[] = [];
    const criteria = activeResult?.promptConfig?.criteria;
    const ai = buildSttChecklistBadges(segments, activeResult?.evaluation?.csChecklist, criteria);
    for (const b of ai) {
      const tone = b.violated ? ("cold" as const) : ("hot" as const);
      const quote = b.quote ? `“${b.quote.slice(0, 120)}”` : null;
      marks.push({
        key: `ai-${b.key}`,
        atSec: b.evidenceAtSec,
        tone,
        source: "ai",
        criterionId: b.criterionId,
        label: b.label,
        body: quote,
        tip: `AI · [${b.criterionId}] ${b.label} · ${b.violated ? "검토 필요" : "검토 불필요"}${quote ? `\n${quote}` : ""}`,
      });
    }
    for (const r of reviews) {
      if (r.judgment === "best") {
        const label = bestMarkLabel(r.bestCategory);
        const body = r.comment ? r.comment.slice(0, 120) : null;
        marks.push({
          key: `rev-${r.annotationId}`,
          atSec: r.atSec,
          tone: "best",
          source: "best",
          label,
          body,
          tip: `Best · ${label}${body ? `\n${body}` : ""}`,
        });
        continue;
      }
      const label = resolveCriterionLabel(r.criterionId, criteria);
      const needed = annotationReviewNeeded(r);
      const tone = r.judgment === "cold" ? ("cold" as const) : ("hot" as const);
      const body = r.comment ? r.comment.slice(0, 120) : null;
      const final = needed ? (r.judgment === "cold" ? "Cold" : "Hot") : null;
      marks.push({
        key: `rev-${r.annotationId}`,
        atSec: r.atSec,
        tone,
        source: "human",
        criterionId: r.criterionId,
        label,
        body,
        tip: `수기 · [${r.criterionId}] ${label} · ${needed ? "검토 필요" : "검토 불필요"}${final ? ` · 최종 ${final}` : ""}${body ? `\n${body}` : ""}`,
      });
    }
    return marks;
  }, [segments, activeResult?.evaluation?.csChecklist, activeResult?.promptConfig?.criteria, reviews]);

  const waveformOverlays = useMemo<WaveformOverlay[]>(() => {
    if (!activeResult) return [];
    const agitated = activeResult.evaluation?.metrics?.agitated;
    const sentimentSpans =
      agitated?.value === true
        ? parseAgitatedSpansFromComment(agitated.comment)
        : [];
    return [
      ...overlapsToOverlays(activeResult.overlaps ?? []),
      ...silencesToOverlays(activeResult.silences ?? []),
      ...sentimentSpansToOverlays(sentimentSpans),
    ];
  }, [activeResult]);

  const seekToEvidence = useCallback(
    (sec: number) => {
      seekRef.current(sec);
      if (!segments.length) return;

      let targetIndex = 0;
      let targetDistance = Infinity;
      for (let i = 0; i < segments.length; i++) {
        const distance = Math.abs(segments[i].atSec - sec);
        if (distance < targetDistance) {
          targetDistance = distance;
          targetIndex = i;
        }
      }

      centerScrollRef.current
        ?.querySelector<HTMLElement>(`[data-stt-segment-index="${targetIndex}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    },
    [segments],
  );

  const copyObserveDeepLink = useCallback(async () => {
    if (!selectedId) return;
    const path = buildCallQualityObserveDeepLink(
      {
        conversationId: selectedId,
        ...(selected?.phoneInquiryId ? { inquiryId: selected.phoneInquiryId } : {}),
      },
      { autoStt: true },
    );
    const url = `${window.location.origin}${path}`;
    const ok = await copyTextToClipboard(url);
    if (observeLinkCopiedTimer.current) clearTimeout(observeLinkCopiedTimer.current);
    if (ok) {
      setObserveLinkCopied(true);
      observeLinkCopiedTimer.current = setTimeout(() => setObserveLinkCopied(false), 1600);
    }
  }, [selectedId, selected?.phoneInquiryId]);

  return (
    <div className="qms-page flex min-h-0 flex-1 flex-col">
      <PromptImproveCheckoutWidget />
      <ReviewStatusCheckoutWidget />
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 진행</div>
          <h1 className="mt-0.5 text-[20px] font-extrabold tracking-tight">
            {defaultFilters?.mineOnly
              ? "내 평가"
              : defaultFilters?.reviewStatus === "incomplete" && defaultFilters?.analyzedOnly
                ? "수기 평가 필요"
                : defaultFilters?.highRiskOnly
                  ? "고위험군 평가"
                  : "전체 평가"}
          </h1>
          <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)]">
            {defaultFilters?.mineOnly
              ? "내가 수기 검수를 남겼거나 검수 찜한, 아직 완료되지 않은 케이스 · 찜하면 검수 진행중 · 찜 없이 완료해도 내가 검수한 것으로 기록"
              : defaultFilters?.reviewStatus === "incomplete" && defaultFilters?.analyzedOnly
                ? "AI 평가가 끝났고 수기 검수가 아직인 콜만 모았어요 · STT에서 검토 필요/최종 Cold·Hot 검수 후 수기 검수 완료"
                : "테스트 샘플 AI 평가 · STT 수기 검수(검토 필요·최종 Cold/Hot·Best) · 수기 검수 완료로 확정 · 재생바 기준선=뱃지 시점 · Space 재생/일시정지"}
            <span className="text-[var(--fg-tertiary)]">
              {" "}
              · <code className="text-[11px]">?conversationId=&amp;autoEval=1</code>
              {" · "}
              <code className="text-[11px]">?conversationId=&amp;observe=1&amp;autoStt=1</code>
            </span>
          </p>
        </div>
        {aiLabel && (
          <div className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-[12px]">
            <span className="text-[var(--fg-tertiary)]">AI 검토</span>
            <Badge
              size="large"
              variant="solid"
              tone={reviewNeededTone(isReviewNeededRaw(aiLabel) !== false)}
            >
              {displayReviewNeededLabel(aiLabel)}
            </Badge>
            {liveHumanResult ? (
              <>
                <span className="text-[var(--fg-tertiary)]">수기</span>
                <Badge size="large" variant="solid" tone={reviewNeededTone(isReviewNeededRaw(liveHumanResult) !== false)}>
                  {displayReviewNeededLabel(liveHumanResult)}
                </Badge>
                {liveHumanFinal ? (
                  <Badge
                    size="large"
                    variant="solid"
                    tone={hotColdTone(liveHumanFinal === "cold" ? "cold" : "hot")}
                  >
                    최종 {hotColdLabel(liveHumanFinal === "cold" ? "cold" : "hot")}
                  </Badge>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </header>

      <div className="qms-layout-run min-h-0 flex-1 p-4">
        {/* 좌: 녹취 리스트 */}
        <aside className="qms-run-panel relative">
          <QmsLoadingOverlay show={loadingList} label="녹취 목록 불러오는 중…" />
          <div className="space-y-2 border-b border-[var(--border-subtle)] px-3 py-3">
            <div className="text-[14px] font-bold">녹취 선정</div>
            <SampleListQuickFilters
              analyzedOnly={Boolean(draftQuickFilters.analyzedOnly)}
              highRiskOnly={Boolean(draftQuickFilters.highRiskOnly)}
              sttStatus={sttFilterState(draftQuickFilters)}
              reviewStatus={reviewFilterState(draftQuickFilters)}
              disabled={!!evaluatingId}
              onChange={patchQuickFilters}
            />
            <FilterPanel
              key={restored ? "restored" : "initial"}
              fieldsOnly
              initial={restored ? restoredInitial.current : appliedFilters}
              onApply={applyFieldFilters}
              disabled={loadingList || !!evaluatingId}
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
              disabled={loadingList || !!evaluatingId}
              onClick={() => void loadSamples(appliedFilters)}
            >
              <RefreshCw className={`mr-1 inline h-3 w-3 ${loadingList ? "animate-spin" : ""}`} />
              새로고침
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
            {listError ? (
              <div className="m-1 rounded-[var(--radius-md)] border border-[var(--danger)]/30 bg-[var(--danger-subtle)] p-2 text-[11px] text-[var(--danger)]">
                {listError}
              </div>
            ) : !loadingList && samples.length === 0 ? (
              <p className="px-2 py-8 text-center text-[12px] text-[var(--fg-tertiary)]">
                {defaultFilters?.mineOnly
                  ? "내가 남긴 수기 검수나 검수 찜한 미완료 케이스가 없어요"
                  : "샘플이 없어요"}
              </p>
            ) : (
              samples.map((s) => {
                const active = s.conversationId === selectedId;
                const finished = s.analyzed || Boolean(results[s.conversationId]);
                const busy = evaluatingId === s.conversationId;
                const meta = resultMeta[s.conversationId];
                const liveAi =
                  results[s.conversationId]?.evaluation?.csChecklist != null
                    ? deriveEvalLabel({
                        csChecklist: results[s.conversationId]!.evaluation!.csChecklist,
                      })
                    : null;
                const aiLabelRaw = (s.aiLabel || meta?.aiLabel || liveAi || "").trim();
                const humanLabelRaw = (
                  (s.conversationId === selectedId && liveHumanResult) ||
                  s.humanResult ||
                  meta?.humanResult ||
                  ""
                ).trim();
                const aiNeeded = isReviewNeededRaw(aiLabelRaw);
                const humanNeeded = isReviewNeededRaw(humanLabelRaw);
                return (
                  <div
                    key={s.conversationId}
                    className={`flex w-full items-start gap-1 rounded-[var(--radius-lg)] border px-2 py-2 transition ${
                      active
                        ? "border-[var(--brand)] bg-[var(--brand-subtle)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:bg-[var(--bg-muted)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void selectCall(s.conversationId)}
                      className="min-w-0 flex-1 text-left"
                    >
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-bold">
                        {s.adminName || "(미상)"}
                      </span>
                      {s.hasStt ? (
                        <Badge
                          size="medium"
                          variant="weak"
                          tone={s.sttSource === "local" ? "brand" : "neutral"}
                          className="shrink-0"
                          title={
                            s.sttSource === "local"
                              ? "로컬 배치 STT"
                              : s.sttSource === "gcp"
                                ? "GCP Speech-to-Text"
                                : "STT 전사 있음"
                          }
                        >
                          {s.sttSource === "local" ? "로컬 STT" : s.sttSource === "gcp" ? "GCP STT" : "STT"}
                        </Badge>
                      ) : (
                        <Badge size="medium" variant="weak" tone="neutral" className="shrink-0">
                          STT 없음
                        </Badge>
                      )}
                      {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--brand)]" />}
                    </div>
                    {!busy &&
                      (finished ||
                        s.reviewCompleted ||
                        aiNeeded != null ||
                        humanNeeded != null ||
                        Boolean(s.reviewClaimedBy)) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {finished &&
                          (aiNeeded != null ? (
                            <>
                              <Badge size="medium" variant="solid" tone={SOURCE_AI_TONE} className="shrink-0">
                                AI
                              </Badge>
                              <Badge
                                size="medium"
                                variant="solid"
                                tone={reviewNeededTone(aiNeeded)}
                                className="shrink-0"
                              >
                                {reviewNeededLabel(aiNeeded)}
                              </Badge>
                            </>
                          ) : (
                            <Badge size="medium" variant="weak" tone="neutral" className="shrink-0">
                              AI 평가 완료
                            </Badge>
                          ))}
                        {!s.reviewCompleted && finished && !s.reviewClaimedBy && (
                          <Badge size="medium" variant="weak" tone="neutral" className="shrink-0">
                            대기중
                          </Badge>
                        )}
                        {!s.reviewCompleted && s.reviewClaimedBy && (
                          <Badge size="medium" variant="weak" tone="brand" className="shrink-0">
                            검수 진행중
                            {sameEmail(s.reviewClaimedBy, myEmail) ? "" : ` · ${handleOf(s.reviewClaimedBy)}`}
                          </Badge>
                        )}
                        {s.reviewCompleted &&
                          (humanNeeded != null ? (
                            <>
                              <Badge size="medium" variant="solid" tone={SOURCE_HUMAN_TONE} className="shrink-0">
                                수기
                              </Badge>
                              <Badge
                                size="medium"
                                variant="solid"
                                tone={reviewNeededTone(humanNeeded)}
                                className="shrink-0"
                              >
                                {reviewNeededLabel(humanNeeded)}
                              </Badge>
                            </>
                          ) : (
                            <Badge size="medium" variant="weak" tone="brand" className="shrink-0">
                              수기 검수 완료
                            </Badge>
                          ))}
                      </div>
                    )}
                    {(s.highRiskFlagKeys ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(s.highRiskFlagKeys ?? []).map((key) => (
                          <Badge key={key} size="medium" variant="weak" tone="critical" className="shrink-0">
                            {resolveHighRiskFlagLabel(key, highRiskFlagLabels)}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[10.5px] tabular-nums text-[var(--fg-secondary)]">
                      {s.callDate && <span>{s.callDate}</span>}
                      {s.callDurationSec != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {formatClock(s.callDurationSec)}
                        </span>
                      )}
                      {s.category && <span>· {s.category}</span>}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[9.5px] text-[var(--fg-tertiary)]">
                      {s.conversationId}
                    </div>
                    </button>
                    <button
                      type="button"
                      title={
                        s.reviewCompleted
                          ? "검수 완료됨"
                          : s.reviewClaimedBy && !sameEmail(s.reviewClaimedBy, myEmail)
                            ? `${handleOf(s.reviewClaimedBy)}님이 검수 진행 중`
                            : sameEmail(s.reviewClaimedBy, myEmail)
                              ? "검수 진행 취소"
                              : "검수 찜하기"
                      }
                      aria-pressed={sameEmail(s.reviewClaimedBy, myEmail)}
                      disabled={
                        s.reviewCompleted ||
                        Boolean(s.reviewClaimedBy && !sameEmail(s.reviewClaimedBy, myEmail)) ||
                        claimBusyId === s.conversationId ||
                        !!evaluatingId ||
                        !myEmail
                      }
                      onClick={() => void toggleClaim(s.conversationId)}
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition ${
                        sameEmail(s.reviewClaimedBy, myEmail)
                          ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                          : "text-[var(--fg-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)] disabled:opacity-40"
                      }`}
                    >
                      {claimBusyId === s.conversationId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShoppingCart
                          className="h-3.5 w-3.5"
                          strokeWidth={s.reviewClaimedBy ? 2.4 : 1.8}
                          fill={sameEmail(s.reviewClaimedBy, myEmail) ? "currentColor" : "none"}
                        />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* 중: 재생 + STT (통째로 스크롤 → 상단 재생바 가림 시 하단 위젯) */}
        <section ref={centerScrollRef} className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
          {selectedId ? (
            <>
              <CallPlaybackBar
                conversationId={selectedId}
                org={org}
                durationSec={activeResult?.durationSec ?? selected?.callDurationSec}
                markers={playbackMarkers}
                overlays={waveformOverlays}
                onSeekReady={(fn) => {
                  seekRef.current = fn;
                }}
              />
              <SttReviewPanel
                conversationId={selectedId}
                segments={segments}
                checklist={activeResult?.evaluation?.csChecklist}
                criteria={activeResult?.promptConfig?.criteria}
                reviews={reviews}
                onSeek={seekToEvidence}
                evaluating={isEvaluating}
                sttSource={activeResult?.sttSource}
                progressLabel={
                  progress
                    ? formatProgressWithEta(progress.label, progress.sec, progress.etaSec)
                    : isEvaluating
                      ? "평가 중…"
                      : null
                }
                onSaveReview={saveReview}
                onDeleteReview={deleteReview}
                busy={reviewBusy}
              />
            </>
          ) : (
            <div className="qms-run-panel flex flex-1 items-center justify-center text-[13px] text-[var(--fg-tertiary)]">
              좌측에서 녹취를 선택하세요
            </div>
          )}
        </section>

        {/* 우: AI 결과 */}
        <aside className="qms-run-panel relative sticky top-4 h-full">
          <QmsLoadingOverlay show={loadingResult && !activeResult} label="결과 불러오는 중…" />
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold">케이스 상세</div>
              <div className="text-[11px] text-[var(--fg-tertiary)]">AI 평가 결과</div>
            </div>
            {selectedId && (
              <button
                type="button"
                title="STT·녹취 청취 링크 복사 (observe=1, autoStt=1)"
                className="qms-btn-ghost !h-8 shrink-0 !px-2 text-[11px]"
                onClick={() => void copyObserveDeepLink()}
              >
                {observeLinkCopied ? (
                  <>
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-[var(--accent)]" />
                    복사됨
                  </>
                ) : (
                  <>
                    <Headphones className="mr-1 inline h-3.5 w-3.5" />
                    청취 링크
                  </>
                )}
              </button>
            )}
            {selected && (
              <button
                type="button"
                className="qms-btn-primary !h-8 !px-3 text-[12px]"
                disabled={!!evaluatingId}
                onClick={() => void evaluate(selected)}
              >
                {isEvaluating ? (
                  <>
                    <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                    평가 중
                  </>
                ) : done ? (
                  <>
                    <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
                    재평가
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                    평가
                  </>
                )}
              </button>
            )}
          </div>
          {selected && done && (
            <div className="space-y-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-3">
              <div className="grid grid-cols-2 gap-1.5">
                <ActionButton
                  variant={claimedByMe ? "neutralSolid" : "neutralWeak"}
                  size="large"
                  className="w-full !justify-center !text-[13px]"
                  disabled={
                    reviewDone ||
                    claimedByOther ||
                    reviewCompleteBusy ||
                    !!evaluatingId ||
                    claimBusyId === selectedId ||
                    !myEmail
                  }
                  loading={claimBusyId === selectedId}
                  onClick={() => selectedId && void toggleClaim(selectedId)}
                >
                  <ShoppingCart className="mr-1 inline h-3.5 w-3.5" />
                  {claimedByMe || claimedByOther ? "검수 진행중" : "검수 찜하기"}
                </ActionButton>
                {reviewDone ? (
                  <ActionButton variant="neutralWeak" size="large" disabled className="w-full !justify-center">
                    <CheckCircle2 className="mr-1 inline h-4 w-4 text-[var(--accent)]" />
                    수기 검수 완료됨
                  </ActionButton>
                ) : (
                  <ActionButton
                    variant="brandSolid"
                    size="large"
                    className="w-full !justify-center !text-[13px] !font-extrabold"
                    disabled={reviewCompleteBusy || !!evaluatingId}
                    loading={reviewCompleteBusy}
                    onClick={() => void completeReview()}
                  >
                    수기 검수 완료
                  </ActionButton>
                )}
              </div>
              {reviewInProgress && !reviewDone && (
                <p className="text-center text-[11px] text-[var(--fg-tertiary)]">
                  {claimedByMe
                    ? "다시 누르면 진행 취소"
                    : `${handleOf(claimedBy ?? "")}님이 검수 진행 중`}
                </p>
              )}
              {reviewDone && (
                <p className="text-center text-[11px] text-[var(--fg-tertiary)]">
                  {activeMeta?.reviewCompletedBy ?? ""}
                  {activeMeta?.reviewCompletedAt
                    ? ` · ${new Date(activeMeta.reviewCompletedAt).toLocaleString("ko-KR")}`
                    : ""}
                </p>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {evalError && (
              <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--danger)]/30 bg-[var(--danger-subtle)] p-2 text-[11.5px] text-[var(--danger)]">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-pre-line">{evalError}</span>
              </div>
            )}
            {loadingResult && !activeResult ? (
              <div className="py-16" />
            ) : activeResult ? (
              <>
                {(promptVersionInfo || promptVersionStatus) && (
                  <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                      평가셋
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {promptVersionInfo ? (
                        <Badge size="medium" variant="weak" tone="neutral" title={promptVersionId ?? ""}>
                          {promptVersionInfo}
                        </Badge>
                      ) : null}
                      {(promptVersionStatus || promptVersionInfo) && (
                        <Badge size="medium" variant="weak" tone={promptBadge.tone}>
                          {promptBadge.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
                <EvalCaseDetail
                  result={activeResult}
                  compactHeader
                  humanResult={liveHumanResult}
                  humanFinalLabel={liveHumanFinal}
                  match={liveMatch}
                  reviews={reviews}
                  onSeek={seekToEvidence}
                />
                {reviews.length > 0 && (
                  <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                    <div className="mb-2 text-[11px] font-bold text-[var(--fg-tertiary)]">
                      수기 검수 {reviews.length}건
                    </div>
                    <ul className="space-y-2">
                      {reviews.map((r) => {
                        if (r.judgment === "best") {
                          return (
                            <li key={r.annotationId} className="text-[11.5px] leading-snug">
                              <span className="font-semibold text-[var(--fg-tertiary)]">
                                Best · {formatClock(r.atSec)}
                              </span>
                              <div className="font-semibold">
                                {bestMarkLabel(r.bestCategory)} ·{" "}
                                <Badge size="medium" variant="solid" tone="warning">
                                  Best
                                </Badge>
                              </div>
                              {r.comment ? (
                                <p className="text-[var(--fg-secondary)]">{r.comment}</p>
                              ) : null}
                            </li>
                          );
                        }
                        const label = resolveCriterionLabel(
                          r.criterionId,
                          activeResult?.promptConfig?.criteria,
                        );
                        return (
                          <li key={r.annotationId} className="text-[11.5px] leading-snug">
                            <div className="mb-0.5 flex flex-wrap items-center gap-1">
                              <Badge
                                size="medium"
                                variant="solid"
                                tone={r.source === "ai" ? SOURCE_AI_TONE : SOURCE_HUMAN_TONE}
                              >
                                {r.source === "ai" ? "AI" : "수기"}
                              </Badge>
                              <span className="font-semibold text-[var(--fg-tertiary)]">
                                {formatClock(r.atSec)}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 font-semibold">
                              [{r.criterionId}] {label} ·{" "}
                              <Badge
                                size="medium"
                                variant="solid"
                                tone={reviewNeededTone(annotationReviewNeeded(r))}
                              >
                                {reviewNeededLabel(annotationReviewNeeded(r))}
                              </Badge>
                              {annotationReviewNeeded(r) ? (
                                <Badge
                                  size="medium"
                                  variant="solid"
                                  tone={hotColdTone(r.judgment === "cold" ? "cold" : "hot")}
                                >
                                  최종 {hotColdLabel(r.judgment === "cold" ? "cold" : "hot")}
                                </Badge>
                              ) : null}
                            </div>
                            {r.comment ? (
                              <p className="text-[var(--fg-secondary)]">{r.comment}</p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            ) : selected ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Play className="h-8 w-8 text-[var(--fg-tertiary)]" />
                <p className="text-[13px] text-[var(--fg-secondary)]">아직 평가 결과가 없어요</p>
                <button
                  type="button"
                  className="qms-btn-primary"
                  disabled={!!evaluatingId}
                  onClick={() => void evaluate(selected)}
                >
                  <Sparkles className="mr-1.5 inline h-4 w-4" />
                  지금 평가 실행
                </button>
              </div>
            ) : (
              <p className="py-16 text-center text-[12px] text-[var(--fg-tertiary)]">녹취를 선택하세요</p>
            )}
          </div>
          {done && activeResult && (
            <div className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--accent)]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              AI 평가 완료
              {activeResult.analysisId && (
                <a
                  className="ml-auto text-[var(--info)] underline"
                  href={`/call-quality/result/${activeResult.analysisId}`}
                >
                  전체 화면
                </a>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

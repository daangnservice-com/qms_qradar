"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Headphones, Loader2, Sparkles } from "lucide-react";
import type { CallQualityOrg } from "@/lib/callQualityOrg";
import type { ObserveSttEvent, ObserveSttStep } from "@/lib/observeStt";
import type { SttSource, TranscriptSegment } from "@/lib/types";
import { describeApiError } from "@/lib/apiError";
import { readCallQualityDeepLink, type CallQualityDeepLink } from "@/lib/callQualityDeepLink";
import { readNdjson } from "@/lib/ndjson";
import { formatProgressWithEta } from "@/lib/evalEta";
import CallPlaybackBar from "@/components/CallPlaybackBar";
import SttReviewPanel from "@/components/SttReviewPanel";
import QmsLoadingOverlay from "@/components/QmsLoadingOverlay";

type ObservePayload = {
  conversationId: string;
  phoneInquiryId?: string | null;
  durationSec: number;
  transcript: TranscriptSegment[];
  sttSource: SttSource | null;
};

function observeApiQuery(deep: CallQualityDeepLink, org: CallQualityOrg): string {
  const q = new URLSearchParams({ org });
  if (deep.conversationId) q.set("conversationId", deep.conversationId);
  if (deep.inquiryId) q.set("inquiry_id", deep.inquiryId);
  return q.toString();
}

const STT_STEP_LABEL: Record<ObserveSttStep, string> = {
  genesys: "Genesys에서 녹취 확보 중",
  download: "녹취 내려받는 중",
  transcode: "오디오 변환 중",
  transcribe: "전사(STT) 중 (가장 오래 걸려요)",
  save: "전사 저장 중",
};

export default function CallObserveWorkbench({ org }: { org: CallQualityOrg }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [phoneInquiryId, setPhoneInquiryId] = useState<string | null>(null);
  const [payload, setPayload] = useState<ObservePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sttBusy, setSttBusy] = useState(false);
  const [sttProgress, setSttProgress] = useState<{ label: string; sec: number } | null>(null);

  const seekRef = useRef<(sec: number) => void>(() => {});
  const centerScrollRef = useRef<HTMLElement | null>(null);
  const autoSttTried = useRef(false);
  const sttBusyRef = useRef(false);

  const seekToSegment = useCallback(
    (sec: number) => {
      seekRef.current(sec);
      const segments = payload?.transcript ?? [];
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
    [payload?.transcript],
  );

  const applyPayload = useCallback((data: ObservePayload) => {
    setPayload(data);
    setError(null);
  }, []);

  const loadObserve = useCallback(
    async (
      deep: CallQualityDeepLink,
    ): Promise<{ status: "ok" | "missing" | "error"; conversationId?: string }> => {
      try {
        const r = await fetch(`/api/call-quality/observe?${observeApiQuery(deep, org)}`);
        const body = (await r.json().catch(() => ({}))) as ObservePayload & { error?: string };
        if (r.status === 404) {
          if (body.error?.includes("상담이력")) {
            setPayload(null);
            setConversationId(null);
            setPhoneInquiryId(null);
            setError(body.error);
            return { status: "error" };
          }
          if (body.conversationId) {
            setConversationId(body.conversationId);
            setPhoneInquiryId(body.phoneInquiryId ?? deep.inquiryId ?? null);
          }
          setPayload(null);
          return { status: "missing", conversationId: body.conversationId };
        }
        if (!r.ok) throw new Error(body.error ?? (await describeApiError(r)));
        setConversationId(body.conversationId);
        setPhoneInquiryId(body.phoneInquiryId ?? deep.inquiryId ?? null);
        applyPayload(body);
        return { status: "ok", conversationId: body.conversationId };
      } catch (e) {
        setPayload(null);
        setError(e instanceof Error ? e.message : "STT를 불러오지 못했어요");
        return { status: "error" };
      }
    },
    [applyPayload, org],
  );

  const runStt = useCallback(
    async (cid: string) => {
      if (sttBusyRef.current) return;
      sttBusyRef.current = true;
      setSttBusy(true);
      setError(null);
      setSttProgress({ label: "STT 준비 중", sec: 0 });
      try {
        const res = await fetch("/api/call-quality/observe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: cid, org }),
        });
        if (!res.ok) throw new Error(await describeApiError(res));

        let result: ObservePayload | null = null;
        for await (const ev of readNdjson<ObserveSttEvent>(res.body)) {
          if (ev.type === "progress") {
            setSttProgress({
              label: STT_STEP_LABEL[ev.step] ?? "STT 중",
              sec: Math.round(ev.elapsedMs / 1000),
            });
          } else if (ev.type === "heartbeat") {
            setSttProgress((p) => (p ? { ...p, sec: Math.round(ev.elapsedMs / 1000) } : p));
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          } else if (ev.type === "result") {
            result = {
              conversationId: ev.result.conversationId,
              durationSec: ev.result.durationSec,
              transcript: ev.result.transcript,
              sttSource: ev.result.sttSource,
            };
          }
        }
        if (!result) {
          throw new Error("연결이 끊겨 STT 결과를 받지 못했어요.\n잠시 후 새로고침해 보세요.");
        }
        applyPayload(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "STT 실행에 실패했어요");
      } finally {
        sttBusyRef.current = false;
        setSttBusy(false);
        setSttProgress(null);
      }
    },
    [applyPayload, org],
  );

  useEffect(() => {
    const deep = readCallQualityDeepLink();
    if (!deep.conversationId && !deep.inquiryId) {
      setLoading(false);
      setError("conversationId 또는 inquiry_id가 필요합니다.");
      return;
    }

    void (async () => {
      setLoading(true);
      setError(null);
      const result = await loadObserve(deep);
      setLoading(false);
      if (result.status === "missing" && deep.autoStt && !autoSttTried.current && result.conversationId) {
        autoSttTried.current = true;
        void runStt(result.conversationId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const segments = payload?.transcript ?? [];
  const hasStt = segments.length > 0;
  const showBlockingOverlay = loading || (sttBusy && !hasStt);

  return (
    <div className="qms-page flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">
          <Headphones className="h-3.5 w-3.5" />
          통화 청취
        </div>
        <h1 className="mt-0.5 text-[20px] font-extrabold tracking-tight">STT · 녹취</h1>
        <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)]">
          평가·검수 없이 녹취와 STT만 확인합니다. STT 구간을 클릭하면 해당 시점으로 이동해요.
          <span className="text-[var(--fg-tertiary)]">
            {" "}
            · <code className="text-[11px]">?conversationId=&amp;observe=1&amp;autoStt=1</code>
            {" · "}
            <code className="text-[11px]">?inquiry_id=&amp;observe=1&amp;autoStt=1</code>
          </span>
        </p>
        {conversationId || phoneInquiryId ? (
          <div className="mt-2 space-y-0.5 font-mono text-[11px] text-[var(--fg-tertiary)]">
            {conversationId ? <p>{conversationId}</p> : null}
            {phoneInquiryId ? <p>상담이력 {phoneInquiryId}</p> : null}
          </div>
        ) : null}
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col p-4">
        <QmsLoadingOverlay
          show={showBlockingOverlay}
          label={
            sttProgress
              ? formatProgressWithEta(sttProgress.label, sttProgress.sec, null)
              : loading
                ? "STT 불러오는 중…"
                : "STT 실행 중…"
          }
        />
        {error && !showBlockingOverlay ? (
          <div className="qms-run-panel flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-[13px] text-[var(--danger)]">{error}</p>
            {conversationId && !sttBusy ? (
              <button type="button" className="qms-btn-primary" onClick={() => void runStt(conversationId)}>
                <Sparkles className="mr-1.5 inline h-4 w-4" />
                STT 다시 실행
              </button>
            ) : null}
          </div>
        ) : conversationId || phoneInquiryId ? (
          <section
            ref={centerScrollRef}
            className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          >
            <CallPlaybackBar
              conversationId={conversationId}
              org={org}
              durationSec={payload?.durationSec}
              markers={[]}
              overlays={[]}
              onSeekReady={(fn) => {
                seekRef.current = fn;
              }}
            />
            {!hasStt && !sttBusy && !loading ? (
              <div className="qms-run-panel flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <AudioLines className="h-8 w-8 text-[var(--fg-tertiary)]" />
                <p className="text-[13px] text-[var(--fg-secondary)]">이 통화의 STT 전사가 아직 없어요.</p>
                <button type="button" className="qms-btn-primary" onClick={() => void runStt(conversationId)}>
                  <Sparkles className="mr-1.5 inline h-4 w-4" />
                  STT 실행
                </button>
              </div>
            ) : (
              <SttReviewPanel
                conversationId={conversationId}
                segments={segments}
                reviews={[]}
                onSeek={seekToSegment}
                sttSource={payload?.sttSource}
                evaluating={sttBusy}
                progressLabel={
                  sttProgress
                    ? formatProgressWithEta(sttProgress.label, sttProgress.sec, null)
                    : sttBusy
                      ? "STT 중…"
                      : null
                }
                observeMode
              />
            )}
          </section>
        ) : (
          <div className="qms-run-panel flex flex-1 items-center justify-center text-[13px] text-[var(--fg-tertiary)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            준비 중…
          </div>
        )}
      </div>
    </div>
  );
}

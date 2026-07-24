"use client";

import { useRef, useState } from "react";
import { MessageSquareText, ChevronDown } from "lucide-react";
import { formatClock } from "@/lib/format";
import { maskPII } from "@/lib/pii";
import type { TranscriptSegment } from "@/lib/types";

export default function Transcript({
  segments,
  conversationId,
  org,
}: {
  segments: TranscriptSegment[];
  conversationId?: string;
  org?: string;
}) {
  const [open, setOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  if (segments.length === 0) return null;

  const audioSrc =
    conversationId && org
      ? `/api/call-quality/audio?conversationId=${encodeURIComponent(conversationId)}&org=${encodeURIComponent(org)}`
      : null;

  // 해당 시각으로 이동 후 재생. 아직 로드 전이면 메타데이터 로드 후 seek.
  function seekTo(sec: number) {
    const a = audioRef.current;
    if (!a) return;
    const doSeek = () => {
      try {
        a.currentTime = sec;
      } catch {
        /* ignore */
      }
      a.play().catch(() => {});
    };
    if (a.readyState >= 1) doSeek();
    else {
      a.addEventListener("loadedmetadata", doSeek, { once: true });
      a.load();
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <MessageSquareText className="h-4 w-4 text-navy" />
          전체 대화 스크립트
          <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-gray-500">{segments.length}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {audioSrc && (
        <div className="border-t border-gray-100 px-5 py-3">
          {/* preload=none: 실제 재생/이동 전까지 Genesys에서 받아오지 않음. controlsList=nodownload: 다운로드 버튼 숨김(임시 재생만) */}
          <audio
            ref={audioRef}
            controls
            controlsList="nodownload"
            onContextMenu={(e) => e.preventDefault()}
            preload="none"
            src={audioSrc}
            className="h-9 w-full"
          />
          <p className="mt-1 text-[11px] text-gray-400">재생 버튼 또는 아래 스크립트의 시각을 눌러 해당 구간을 들어보세요.</p>
        </div>
      )}

      {open && (
        <div className="max-h-96 space-y-3 overflow-y-auto border-t border-gray-100 px-5 py-4">
          {segments.map((s, i) => {
            const isAgent = s.speaker.includes("상담");
            return (
              <div key={i} className="flex gap-3">
                {audioSrc ? (
                  <button
                    type="button"
                    onClick={() => seekTo(s.atSec)}
                    title="이 시각으로 재생"
                    className="mt-0.5 w-11 shrink-0 text-left font-mono text-xs text-navy transition hover:underline"
                  >
                    {formatClock(s.atSec)}
                  </button>
                ) : (
                  <span className="mt-0.5 w-11 shrink-0 font-mono text-xs text-gray-400">{formatClock(s.atSec)}</span>
                )}
                <div className="min-w-0">
                  {s.speaker && (
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                        isAgent ? "bg-navy/10 text-navy" : "bg-brand/10 text-brand"
                      }`}
                    >
                      {s.speaker}
                    </span>
                  )}
                  {/* maskPII: 멱등 — 신규 저장분(이미 마스킹됨)은 그대로, 기존 원본 저장분은 여기서 가려짐 */}
                  <p className={`text-sm leading-relaxed text-gray-700 ${s.speaker ? "mt-1" : ""}`}>{maskPII(s.text)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

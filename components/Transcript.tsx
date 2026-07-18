"use client";

import { useState } from "react";
import { MessageSquareText, ChevronDown } from "lucide-react";
import { formatClock } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/types";

export default function Transcript({ segments }: { segments: TranscriptSegment[] }) {
  const [open, setOpen] = useState(false);
  if (segments.length === 0) return null;

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
          <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-gray-500">
            {segments.length}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="max-h-96 space-y-3 overflow-y-auto border-t border-gray-100 px-5 py-4">
          {segments.map((s, i) => {
            const isAgent = s.speaker.includes("상담");
            return (
              <div key={i} className="flex gap-3">
                <span className="mt-0.5 w-11 shrink-0 font-mono text-xs text-gray-400">
                  {formatClock(s.atSec)}
                </span>
                <div className="min-w-0">
                  <span
                    className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                      isAgent ? "bg-navy/10 text-navy" : "bg-brand/10 text-brand"
                    }`}
                  >
                    {s.speaker}
                  </span>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700">{s.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

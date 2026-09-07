"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X, ClipboardCheck, ExternalLink, Loader2 } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import ResultView from "./ResultView";

/** 분석 결과 우측 슬라이드 패널 — AI 비교·개선 케이스 상세와 동일 톤 */
export default function ResultDrawer({
  open,
  result,
  loading,
  org,
  onClose,
}: {
  open: boolean;
  result: EvaluationResult | null;
  loading?: boolean;
  org?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="케이스 상세"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-canvas)] shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[13px] font-bold tracking-tight text-[var(--fg-primary)]">
              <ClipboardCheck className="h-4 w-4 text-[var(--accent)]" />
              케이스 상세
            </h2>
            {result?.conversationId && (
              <p className="truncate font-mono text-[11px] text-[var(--fg-tertiary)]">{result.conversationId}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {result?.analysisId && (
              <Link
                href={`/call-quality/result/${result.analysisId}`}
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-[var(--fg-tertiary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                전체 화면
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="rounded-[var(--radius-md)] p-1.5 text-[var(--fg-tertiary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3">
          {result ? (
            <ResultView result={result} org={org} compactHeader />
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-[var(--fg-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              결과 불러오는 중…
            </div>
          ) : (
            <p className="py-16 text-center text-[13px] text-[var(--fg-tertiary)]">결과가 없어요</p>
          )}
        </div>
      </aside>
    </>
  );
}

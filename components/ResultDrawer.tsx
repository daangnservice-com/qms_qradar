"use client";

import { useEffect } from "react";
import { X, ClipboardCheck } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import ResultView from "./ResultView";

// 평가 결과를 오른쪽에서 슬라이드로 여는 패널. 목록은 그대로 두고 결과만 옆 창에서 확인.
export default function ResultDrawer({
  open,
  result,
  onClose,
}: {
  open: boolean;
  result: EvaluationResult | null;
  onClose: () => void;
}) {
  // ESC로 닫기
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
        aria-label="평가 결과"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-100 px-5">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-gray-900">
            <ClipboardCheck className="h-4 w-4 text-green-600" />
            평가 결과
            {result?.conversationId && (
              <span className="truncate font-mono text-[11px] font-normal text-gray-400">{result.conversationId}</span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-navy"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
          {result ? <ResultView result={result} /> : null}
        </div>
      </aside>
    </>
  );
}

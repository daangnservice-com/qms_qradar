"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GripVertical, X } from "lucide-react";
import { PROMPT_IMPROVE_KIND_LABEL } from "@/lib/promptImproveTypes";
import {
  clearPromptImproveCheckout,
  loadPromptImproveCheckout,
  type PromptImproveCheckout,
} from "@/lib/promptImproveSession";

type Pos = { x: number; y: number };

/**
 * 프롬프트 개선 → 평가 진행 딥링크 시 불일치 사례 컨텍스트 위젯.
 * 드래그 이동 · 프롬프트 개선으로 복귀.
 */
export default function PromptImproveCheckoutWidget() {
  const router = useRouter();
  const [checkout, setCheckout] = useState<PromptImproveCheckout | null>(null);
  const [pos, setPos] = useState<Pos>({ x: 24, y: 96 });
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);

  useEffect(() => {
    setCheckout(loadPromptImproveCheckout());
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("button,a")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
    },
    [pos.x, pos.y],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const nx = Math.max(8, d.px + (e.clientX - d.ox));
    const ny = Math.max(8, d.py + (e.clientY - d.oy));
    setPos({ x: nx, y: ny });
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    drag.current = null;
  }, []);

  if (!checkout) return null;
  const ex = checkout.example;

  return (
    <div
      className="fixed z-[80] w-[min(360px,calc(100vw-24px))] select-none rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-canvas)] shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex cursor-grab items-center gap-1.5 border-b border-[var(--border-subtle)] px-2.5 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-[var(--fg-tertiary)]" />
        <div className="min-w-0 flex-1 text-[12px] font-bold">불일치 더블체크</div>
        <button
          type="button"
          className="rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
          title="위젯 닫기"
          onClick={() => {
            clearPromptImproveCheckout();
            setCheckout(null);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2 px-3 py-2.5 text-[12px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="qms-chip !px-2 !py-0.5 text-[10.5px]">{PROMPT_IMPROVE_KIND_LABEL[ex.kind]}</span>
          <span className="font-mono text-[10.5px] text-[var(--fg-tertiary)]">{ex.criterionId}</span>
          <span className="font-semibold">{ex.criterionLabel}</span>
        </div>
        {ex.category ? <div className="text-[11px] text-[var(--fg-tertiary)]">{ex.category}</div> : null}
        <div>
          <div className="text-[10.5px] font-bold text-[var(--fg-tertiary)]">수기</div>
          <div className="text-[var(--fg-primary)]">{ex.humanNote}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-bold text-[var(--fg-tertiary)]">AI</div>
          <div className="text-[var(--fg-secondary)]">{ex.aiNote}</div>
        </div>
        {ex.quote ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-2 py-1.5 text-[11px] italic text-[var(--fg-secondary)]">
            “{ex.quote}”
            {ex.atSec != null ? (
              <span className="ml-1 not-italic text-[var(--fg-tertiary)]">@{Math.floor(ex.atSec)}s</span>
            ) : null}
          </div>
        ) : null}
        <code className="block break-all text-[10px] text-[var(--fg-tertiary)]">{ex.conversationId}</code>
      </div>

      <div className="border-t border-[var(--border-subtle)] px-2.5 py-2">
        <button
          type="button"
          className="qms-btn-primary inline-flex w-full items-center justify-center gap-1.5 !h-8 text-[12px]"
          onClick={() => {
            // draft는 세션에 유지 · checkout만 정리 후 복귀
            clearPromptImproveCheckout();
            router.push("/eval-design/prompt-improve");
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          프롬프트 개선으로 돌아가기
        </button>
      </div>
    </div>
  );
}

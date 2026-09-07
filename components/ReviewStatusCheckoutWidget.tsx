"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GripVertical, X } from "lucide-react";
import {
  clearReviewStatusCheckout,
  loadReviewStatusCheckout,
  type ReviewStatusCheckout,
} from "@/lib/reviewStatusCheckout";

type Pos = { x: number; y: number };

/** 검수 현황 → 평가 진행 딥링크 시 복귀 위젯 */
export default function ReviewStatusCheckoutWidget() {
  const router = useRouter();
  const [checkout, setCheckout] = useState<ReviewStatusCheckout | null>(null);
  const [pos, setPos] = useState<Pos>({ x: 24, y: 96 });
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);

  useEffect(() => {
    setCheckout(loadReviewStatusCheckout());
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
        <div className="min-w-0 flex-1 text-[12px] font-bold">검수 현황에서 열림</div>
        <button
          type="button"
          className="rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
          title="위젯 닫기"
          onClick={() => {
            clearReviewStatusCheckout();
            setCheckout(null);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2 px-3 py-2.5 text-[12px]">
        <div className="font-semibold">
          {checkout.adminName || "상담사"}
          {checkout.callDate ? (
            <span className="ml-1 font-normal text-[var(--fg-secondary)]">({checkout.callDate})</span>
          ) : null}
        </div>
        <code className="block break-all text-[10px] text-[var(--fg-tertiary)]">{checkout.conversationId}</code>
      </div>

      <div className="border-t border-[var(--border-subtle)] px-2.5 py-2">
        <button
          type="button"
          className="qms-btn-primary inline-flex w-full items-center justify-center gap-1.5 !h-8 text-[12px]"
          onClick={() => {
            clearReviewStatusCheckout();
            router.push(checkout.returnHref || "/eval-ops/review-status");
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          검수 현황으로 돌아가기
        </button>
      </div>
    </div>
  );
}

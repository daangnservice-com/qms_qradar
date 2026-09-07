"use client";

import { ProgressCircle } from "seed-design/ui/progress-circle";

/** 패널/화면 로딩용 오버레이 — 진행도와 무관한 indeterminate 표시 */
export default function QmsLoadingOverlay({
  show,
  label = "불러오는 중…",
}: {
  show: boolean;
  label?: string;
}) {
  if (!show) return null;

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[var(--bg-canvas)]/75 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--brand)]/25" />
        <span className="absolute inset-1 animate-pulse rounded-full bg-[var(--brand-subtle)]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon.png"
          alt=""
          width={40}
          height={40}
          className="relative z-[1] h-10 w-10 rounded-[10px] shadow-sm"
        />
      </div>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--fg-secondary)]">
        <ProgressCircle size="24" tone="brand" />
        <span>{label}</span>
      </div>
    </div>
  );
}

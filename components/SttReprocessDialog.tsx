"use client";

import { Cloud, Server } from "lucide-react";
import { DialogBody, DialogContent, DialogFooter, DialogRoot } from "seed-design/ui/dialog";
import { ActionButton } from "seed-design/ui/action-button";

export type SttReprocessTarget = "gcp" | "local";

export default function SttReprocessDialog({
  open,
  busy,
  onClose,
  onChoose,
}: {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onChoose: (target: SttReprocessTarget) => void;
}) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        const nextOpen = typeof next === "boolean" ? next : Boolean((next as { open?: boolean }).open);
        if (!nextOpen && !busy) onClose();
      }}
      closeOnInteractOutside={!busy}
      size="medium"
    >
      <DialogContent
        title="STT 재처리"
        description="기존 전사를 덮어씁니다. 지금 실행 중인 로컬 STT는 끊지 않고, 그 다음 순서로 넣습니다."
      >
        <DialogBody>
          <div className="grid gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose("gcp")}
              className="flex w-full items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-3 text-left hover:border-[var(--brand)] hover:bg-[var(--brand-subtle)] disabled:opacity-50"
            >
              <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-[var(--fg-secondary)]" />
              <span>
                <span className="block text-[13px] font-bold">GCP로 재처리</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--fg-secondary)]">
                  이 화면에서 바로 돌아옵니다. 수 분 안에 끝나지만 Google Speech-to-Text 종량제입니다.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose("local")}
              className="flex w-full items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-3 text-left hover:border-[var(--brand)] hover:bg-[var(--brand-subtle)] disabled:opacity-50"
            >
              <Server className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand)]" />
              <span>
                <span className="block text-[13px] font-bold">로컬 배치 서버에 넣기</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--fg-secondary)]">
                  무료 GPU 큐의 맨 앞(현재 작업 다음)입니다. 오프피크가 아니면 창이 열릴 때까지 기다릴 수 있고,
                  끝나면 이 화면에 자동으로 반영됩니다.
                </span>
              </span>
            </button>
          </div>
        </DialogBody>
        <DialogFooter>
          <ActionButton variant="neutralWeak" disabled={busy} onClick={onClose}>
            취소
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}

"use client";

import { useState } from "react";
import { DialogBody, DialogContent, DialogFooter, DialogRoot } from "seed-design/ui/dialog";
import { ActionButton } from "seed-design/ui/action-button";
import { STT_ISSUE_TYPES, type SttIssueTypeId } from "@/lib/sttIssueTypes";

export default function SttIssueReportDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: { issueType: SttIssueTypeId; comment: string }) => Promise<void> | void;
}) {
  const [issueType, setIssueType] = useState<SttIssueTypeId>("missing_speech");
  const [comment, setComment] = useState("");

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
        title="STT 이슈 리포팅"
        description="누락·화자 혼동 같은 이상만 모아 두었다가 따로 확인할 수 있어요. 지금 보이는 전사 원문이 함께 저장됩니다."
      >
        <DialogBody>
          <div className="grid gap-1.5">
            {STT_ISSUE_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => setIssueType(t.id)}
                className={`rounded-[var(--radius-md)] px-3 py-2 text-left ${
                  issueType === t.id
                    ? "bg-[var(--brand-subtle)] ring-1 ring-[var(--brand)]/40"
                    : "bg-[var(--bg-muted)]"
                }`}
              >
                <span className="block text-[13px] font-bold">{t.label}</span>
                <span className="block text-[11.5px] text-[var(--fg-tertiary)]">{t.hint}</span>
              </button>
            ))}
          </div>
          <label className="mt-3 block text-[11px] font-semibold text-[var(--fg-tertiary)]">코멘트 (선택)</label>
          <textarea
            className="qms-textarea mt-1 !min-h-[72px] text-[12px]"
            value={comment}
            disabled={busy}
            placeholder="어디가 빠졌는지, 몇 분대인지 짧게"
            onChange={(e) => setComment(e.target.value)}
          />
        </DialogBody>
        <DialogFooter>
          <ActionButton variant="neutralWeak" disabled={busy} onClick={onClose}>
            취소
          </ActionButton>
          <ActionButton
            variant="brandSolid"
            loading={busy}
            disabled={busy}
            onClick={() => void onSubmit({ issueType, comment })}
          >
            리포팅
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}

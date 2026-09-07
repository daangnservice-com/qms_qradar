"use client";

import { PERSONAL_COLOR_PRESETS } from "@/lib/evalOpsSchedule";
import type { EvalOpsPersonalEvent } from "@/lib/evalOpsScheduleStore";

type Props = {
  open: boolean;
  month: string;
  editing: EvalOpsPersonalEvent | null;
  defaultDate: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: {
    id?: string;
    title: string;
    startDate: string;
    endDate: string;
    color: string;
  }) => void;
  onDelete?: (id: string) => void;
};

export default function SchedulePersonalModal({
  open,
  editing,
  defaultDate,
  saving,
  onClose,
  onSave,
  onDelete,
}: Props) {
  if (!open) return null;

  const isEdit = !!editing?.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="w-full max-w-md rounded-[16px] border border-[var(--border-subtle)] bg-white p-5 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const title = String(fd.get("title") || "").trim();
          const startDate = String(fd.get("startDate") || "");
          const endDate = String(fd.get("endDate") || startDate);
          const color = String(fd.get("color") || "#4d82d6");
          if (!title || !startDate) return;
          onSave({
            id: editing?.id,
            title,
            startDate,
            endDate: endDate || startDate,
            color,
          });
        }}
      >
        <h3 className="text-[16px] font-bold text-[var(--fg-primary)]">
          {isEdit ? "내 일정 수정" : "내 일정 추가"}
        </h3>

        <label className="mt-4 block text-[12px] font-semibold text-[var(--fg-tertiary)]">제목 *</label>
        <input
          name="title"
          required
          defaultValue={editing?.title ?? ""}
          className="qms-input mt-1 w-full"
          placeholder="일정 제목"
        />

        <label className="mt-3 block text-[12px] font-semibold text-[var(--fg-tertiary)]">시작일 *</label>
        <input
          name="startDate"
          type="date"
          required
          defaultValue={editing?.startDate ?? defaultDate ?? ""}
          className="qms-input mt-1 w-full"
        />

        <label className="mt-3 block text-[12px] font-semibold text-[var(--fg-tertiary)]">종료일</label>
        <input
          name="endDate"
          type="date"
          defaultValue={editing?.endDate ?? editing?.startDate ?? defaultDate ?? ""}
          className="qms-input mt-1 w-full"
        />

        <label className="mt-3 block text-[12px] font-semibold text-[var(--fg-tertiary)]">색상</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            name="color"
            type="color"
            id="personal-color"
            defaultValue={editing?.color ?? "#4d82d6"}
            className="h-9 w-12 cursor-pointer rounded border border-[var(--border-subtle)]"
          />
          <div className="flex flex-wrap gap-1.5">
            {PERSONAL_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className="h-6 w-6 rounded-full border border-black/10"
                style={{ background: c }}
                onClick={() => {
                  const el = document.getElementById("personal-color") as HTMLInputElement | null;
                  if (el) el.value = c;
                }}
              />
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {isEdit && onDelete && (
            <button
              type="button"
              className="qms-btn-ghost mr-auto text-red-600"
              disabled={saving}
              onClick={() => {
                if (editing?.id && confirm("이 개인일정을 삭제할까요?")) onDelete(editing.id);
              }}
            >
              삭제
            </button>
          )}
          <button type="button" className="qms-btn-secondary" disabled={saving} onClick={onClose}>
            취소
          </button>
          <button type="submit" className="qms-btn-primary" disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

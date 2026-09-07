"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import MultiSelect from "./MultiSelect";
import type { FeedbackSampleFilters } from "@/lib/feedbackSamples";

type Raw = {
  adminNames: string[];
  feedbackCountMin: string;
  feedbackCountMax: string;
  replyCountMin: string;
  replyCountMax: string;
};

function fromFilters(filters: FeedbackSampleFilters): Raw {
  return {
    adminNames: filters.adminNames ?? [],
    feedbackCountMin: filters.feedbackCountMin == null ? "" : String(filters.feedbackCountMin),
    feedbackCountMax: filters.feedbackCountMax == null ? "" : String(filters.feedbackCountMax),
    replyCountMin: filters.replyCountMin == null ? "" : String(filters.replyCountMin),
    replyCountMax: filters.replyCountMax == null ? "" : String(filters.replyCountMax),
  };
}

function toFilters(raw: Raw): FeedbackSampleFilters {
  const numberOrNull = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
  };
  return {
    adminNames: raw.adminNames,
    feedbackCountMin: numberOrNull(raw.feedbackCountMin),
    feedbackCountMax: numberOrNull(raw.feedbackCountMax),
    replyCountMin: numberOrNull(raw.replyCountMin),
    replyCountMax: numberOrNull(raw.replyCountMax),
  };
}

export default function FeedbackFilterPanel({
  adminOptions,
  initial = {},
  disabled,
  onApply,
}: {
  adminOptions: string[];
  initial?: FeedbackSampleFilters;
  disabled?: boolean;
  onApply: (filters: FeedbackSampleFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<Raw>(() => fromFilters(initial));
  const active = useMemo(
    () =>
      raw.adminNames.length +
      Number(Boolean(raw.feedbackCountMin.trim() || raw.feedbackCountMax.trim())) +
      Number(Boolean(raw.replyCountMin.trim() || raw.replyCountMax.trim())),
    [raw],
  );

  const setCount = (key: keyof Pick<Raw, "feedbackCountMin" | "feedbackCountMax" | "replyCountMin" | "replyCountMax">) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setRaw((current) => ({ ...current, [key]: event.target.value.replace(/[^\d]/g, "") }));

  const reset = () => {
    const empty = fromFilters({});
    setRaw(empty);
    onApply(toFilters(empty));
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] transition hover:bg-[var(--bg-muted)]"
      >
        <span className="inline-flex items-center gap-2 font-semibold text-[var(--fg-primary)]">
          <Filter className="h-4 w-4 text-[var(--brand)]" />
          문의 필터
          {active > 0 && (
            <span className="rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-bold text-white">{active}</span>
          )}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-[var(--fg-tertiary)]" /> : <ChevronDown className="h-4 w-4 text-[var(--fg-tertiary)]" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] px-3.5 py-3.5">
          <div>
            <span className="mb-1 block text-[11px] font-medium text-[var(--fg-tertiary)]">참여한 어드민</span>
            <MultiSelect
              options={adminOptions}
              selected={raw.adminNames}
              onChange={(adminNames) => setRaw((current) => ({ ...current, adminNames }))}
              placeholder="어드민 여러 명 선택"
              disabled={disabled}
            />
            <p className="mt-1 text-[10.5px] text-[var(--fg-tertiary)]">스레드에 참여한 어드민 중 한 명이라도 포함되면 표시합니다.</p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <RangeField
              label="문의 개수"
              minValue={raw.feedbackCountMin}
              maxValue={raw.feedbackCountMax}
              onMinChange={setCount("feedbackCountMin")}
              onMaxChange={setCount("feedbackCountMax")}
              disabled={disabled}
            />
            <RangeField
              label="답변 개수"
              minValue={raw.replyCountMin}
              maxValue={raw.replyCountMax}
              onMinChange={setCount("replyCountMin")}
              onMaxChange={setCount("replyCountMax")}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={reset} disabled={disabled} className="qms-btn-ghost !h-8 text-[12px]">
              <X className="mr-1 inline h-3.5 w-3.5" />
              초기화
            </button>
            <button type="button" onClick={() => onApply(toFilters(raw))} disabled={disabled} className="qms-btn-primary !h-8 text-[12px]">
              필터 적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeField({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  disabled,
}: {
  label: string;
  minValue: string;
  maxValue: string;
  onMinChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onMaxChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-[var(--fg-tertiary)]">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          value={minValue}
          onChange={onMinChange}
          disabled={disabled}
          placeholder="최소"
          className="qms-input min-w-0 flex-1 !py-1.5 text-[12px]"
        />
        <span className="text-[11px] text-[var(--fg-tertiary)]">~</span>
        <input
          type="number"
          min={0}
          value={maxValue}
          onChange={onMaxChange}
          disabled={disabled}
          placeholder="최대"
          className="qms-input min-w-0 flex-1 !py-1.5 text-[12px]"
        />
      </div>
    </div>
  );
}

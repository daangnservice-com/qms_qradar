"use client";

import { Chip } from "seed-design/ui/chip";

export type ReviewFilterState = "" | "completed" | "incomplete";
export type SttFilterState = "" | "present" | "absent";

function ToggleSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2.5 py-2 text-left transition hover:bg-[var(--bg-canvas)] disabled:opacity-50"
    >
      <span className="truncate text-[11px] font-semibold text-[var(--fg-primary)]">{label}</span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${
          checked ? "bg-[var(--brand)]" : "bg-[var(--border-strong)]"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition ${
            checked ? "translate-x-3" : ""
          }`}
        />
      </span>
    </button>
  );
}

/** 녹취 선정 패널 상단 — AI평가·고위험군·STT·수기검수 (필터 아코디언 밖 상시 노출) */
export default function SampleListQuickFilters({
  analyzedOnly,
  highRiskOnly,
  sttStatus,
  reviewStatus,
  disabled,
  onChange,
}: {
  analyzedOnly: boolean;
  highRiskOnly: boolean;
  sttStatus: SttFilterState;
  reviewStatus: ReviewFilterState;
  disabled?: boolean;
  onChange: (patch: {
    analyzedOnly?: boolean;
    highRiskOnly?: boolean;
    sttStatus?: SttFilterState;
    reviewStatus?: ReviewFilterState;
  }) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <ToggleSwitch
          label="AI평가"
          checked={analyzedOnly}
          disabled={disabled}
          onChange={(v) => onChange({ analyzedOnly: v })}
        />
        <ToggleSwitch
          label="고위험군"
          checked={highRiskOnly}
          disabled={disabled}
          onChange={(v) => onChange({ highRiskOnly: v })}
        />
      </div>
      <div className="space-y-1">
        <span className="block text-[10px] font-medium text-[var(--fg-tertiary)]">STT</span>
        <Chip.RadioRoot
          value={sttStatus || "all"}
          aria-label="STT 존재 여부 필터"
          disabled={disabled}
          onValueChange={(v) =>
            onChange({
              sttStatus: v === "present" || v === "absent" ? v : "",
            })
          }
        >
          <div className="grid grid-cols-3 gap-1">
            <Chip.RadioItem value="all" size="small" variant="outlineStrong" className="!justify-center">
              <Chip.Label>전체</Chip.Label>
            </Chip.RadioItem>
            <Chip.RadioItem value="present" size="small" variant="outlineStrong" className="!justify-center">
              <Chip.Label>있음</Chip.Label>
            </Chip.RadioItem>
            <Chip.RadioItem value="absent" size="small" variant="outlineStrong" className="!justify-center">
              <Chip.Label>없음</Chip.Label>
            </Chip.RadioItem>
          </div>
        </Chip.RadioRoot>
      </div>
      <div className="space-y-1">
        <span className="block text-[10px] font-medium text-[var(--fg-tertiary)]">수기검수</span>
        <Chip.RadioRoot
          value={reviewStatus || "all"}
          aria-label="수기검수 필터"
          disabled={disabled}
          onValueChange={(v) =>
            onChange({
              reviewStatus: v === "completed" || v === "incomplete" ? v : "",
            })
          }
        >
          <div className="grid grid-cols-3 gap-1">
            <Chip.RadioItem value="all" size="small" variant="outlineStrong" className="!justify-center">
              <Chip.Label>전체</Chip.Label>
            </Chip.RadioItem>
            <Chip.RadioItem value="completed" size="small" variant="outlineStrong" className="!justify-center">
              <Chip.Label>완료</Chip.Label>
            </Chip.RadioItem>
            <Chip.RadioItem value="incomplete" size="small" variant="outlineStrong" className="!justify-center">
              <Chip.Label>미완료</Chip.Label>
            </Chip.RadioItem>
          </div>
        </Chip.RadioRoot>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Chip } from "seed-design/ui/chip";

export type ReviewFilterState = "" | "completed" | "incomplete";
export type SttFilterState = "" | "present" | "absent";

/** 고위험군 펼침 목록에 쓸 규칙(평가 설계에서 관리) */
export type HighRiskFlagOption = { key: string; label: string };

export const CSAT_RATE_VALUES = [1, 2, 3, 4, 5] as const;

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

/** 다중 선택 칩 — 누른 것 중 하나라도 해당하면 통과(OR). */
function MultiChip({
  label,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`truncate rounded-full border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
        selected
          ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand-hover)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
      }`}
    >
      {label}
    </button>
  );
}

/** 녹취 선정 패널 상단 — AI평가·고위험군·CSAT·STT·수기검수 (필터 아코디언 밖 상시 노출) */
export default function SampleListQuickFilters({
  analyzedOnly,
  highRiskOnly,
  highRiskFlagKeys,
  highRiskOptions,
  csatRates,
  csatIncludeNone,
  sttStatus,
  reviewStatus,
  disabled,
  onChange,
}: {
  analyzedOnly: boolean;
  highRiskOnly: boolean;
  /** 개별 선택된 플래그 키. 비면 「전체 고위험군」 */
  highRiskFlagKeys: string[];
  highRiskOptions: HighRiskFlagOption[];
  csatRates: number[];
  csatIncludeNone: boolean;
  sttStatus: SttFilterState;
  reviewStatus: ReviewFilterState;
  disabled?: boolean;
  onChange: (patch: {
    analyzedOnly?: boolean;
    highRiskOnly?: boolean;
    highRiskFlagKeys?: string[];
    csatRates?: number[];
    csatIncludeNone?: boolean;
    sttStatus?: SttFilterState;
    reviewStatus?: ReviewFilterState;
  }) => void;
}) {
  const highRiskActive = highRiskOnly || highRiskFlagKeys.length > 0;
  // 개별 선택이 있으면 항목이 보이도록 펼친 채로 시작한다.
  const [open, setOpen] = useState(highRiskFlagKeys.length > 0);

  const toggleFlagKey = (key: string) => {
    const next = highRiskFlagKeys.includes(key)
      ? highRiskFlagKeys.filter((k) => k !== key)
      : [...highRiskFlagKeys, key];
    // 개별 선택이 하나라도 있으면 그게 곧 고위험군 필터 — 전체 토글은 끈다.
    onChange({ highRiskFlagKeys: next, highRiskOnly: next.length === 0 ? highRiskOnly : false });
  };

  const toggleRate = (rate: number) => {
    const next = csatRates.includes(rate) ? csatRates.filter((r) => r !== rate) : [...csatRates, rate];
    onChange({ csatRates: next });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <ToggleSwitch
          label="AI평가"
          checked={analyzedOnly}
          disabled={disabled}
          onChange={(v) => onChange({ analyzedOnly: v })}
        />
        <div className="flex min-w-0 flex-1 items-stretch gap-1">
          <ToggleSwitch
            label="고위험군"
            checked={highRiskActive}
            disabled={disabled}
            onChange={(v) =>
              // 끄면 개별 선택도 함께 해제한다.
              onChange(v ? { highRiskOnly: true } : { highRiskOnly: false, highRiskFlagKeys: [] })
            }
          />
          <button
            type="button"
            aria-expanded={open}
            aria-label="고위험군 항목 펼치기"
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            className="flex w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--fg-tertiary)] transition hover:bg-[var(--bg-canvas)] hover:text-[var(--fg-primary)] disabled:opacity-50"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2">
          <span className="block text-[10px] font-medium text-[var(--fg-tertiary)]">
            고위험군 항목 {highRiskFlagKeys.length > 0 ? "(선택 중 하나라도)" : "(전체)"}
          </span>
          {highRiskOptions.length === 0 ? (
            <p className="py-1 text-[11px] text-[var(--fg-tertiary)]">설정된 고위험군 항목이 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {highRiskOptions.map((o) => (
                <MultiChip
                  key={o.key}
                  label={o.label}
                  selected={highRiskFlagKeys.includes(o.key)}
                  disabled={disabled}
                  onToggle={() => toggleFlagKey(o.key)}
                />
              ))}
            </div>
          )}
          {highRiskFlagKeys.length > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ highRiskFlagKeys: [], highRiskOnly: true })}
              className="text-[10.5px] font-semibold text-[var(--brand)] disabled:opacity-50"
            >
              전체 고위험군으로 되돌리기
            </button>
          )}
        </div>
      )}

      <div className="space-y-1">
        <span className="block text-[10px] font-medium text-[var(--fg-tertiary)]">CSAT</span>
        <div className="flex flex-wrap gap-1">
          {CSAT_RATE_VALUES.map((r) => (
            <MultiChip
              key={r}
              label={`${r}점`}
              selected={csatRates.includes(r)}
              disabled={disabled}
              onToggle={() => toggleRate(r)}
            />
          ))}
          <MultiChip
            label="미참여"
            selected={csatIncludeNone}
            disabled={disabled}
            onToggle={() => onChange({ csatIncludeNone: !csatIncludeNone })}
          />
        </div>
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

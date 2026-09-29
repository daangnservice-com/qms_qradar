"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import MultiSelect from "./MultiSelect";
import type { FeedbackSampleFilters } from "@/lib/feedbackSamples";

// 콜 품질 FilterPanel과 같은 구성. 전화 전용 칸(통화 시간·상담이력 ID·Conversation ID)은 빼고,
// 인앱 문의에만 있는 문의/답변 개수를 그 자리에 둔다.
type Raw = {
  dateStart: string;
  dateEnd: string;
  feedbackCountMin: string;
  feedbackCountMax: string;
  replyCountMin: string;
  replyCountMax: string;
  humanCountMin: string;
  humanCountMax: string;
  teams: string[];
  adminNames: string[];
  categories: string[];
  adminIds: string;
  sourceIds: string;
};

const TEXT_KEYS = ["adminIds", "sourceIds"] as const;

const splitVals = (s: string): string[] =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

const sortKo = (a: string[]) => [...a].sort((x, y) => x.localeCompare(y, "ko"));

const numberOrEmpty = (value: number | null | undefined) => (value == null ? "" : String(value));

function fromFilters(filters: FeedbackSampleFilters | undefined): Raw {
  const g = filters ?? {};
  return {
    dateStart: g.dateStart ?? "",
    dateEnd: g.dateEnd ?? "",
    feedbackCountMin: numberOrEmpty(g.feedbackCountMin),
    feedbackCountMax: numberOrEmpty(g.feedbackCountMax),
    replyCountMin: numberOrEmpty(g.replyCountMin),
    replyCountMax: numberOrEmpty(g.replyCountMax),
    humanCountMin: numberOrEmpty(g.humanCountMin),
    humanCountMax: numberOrEmpty(g.humanCountMax),
    teams: g.teams ?? [],
    adminNames: g.adminNames ?? [],
    categories: g.categories ?? [],
    adminIds: (g.adminIds ?? []).join(", "),
    sourceIds: (g.sourceIds ?? []).join(", "),
  };
}

function toFilters(raw: Raw): FeedbackSampleFilters {
  const numberOrNull = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
  };
  const sourceIds = splitVals(raw.sourceIds);
  if (sourceIds.length) return { sourceIds };
  return {
    dateStart: raw.dateStart || null,
    dateEnd: raw.dateEnd || null,
    feedbackCountMin: numberOrNull(raw.feedbackCountMin),
    feedbackCountMax: numberOrNull(raw.feedbackCountMax),
    replyCountMin: numberOrNull(raw.replyCountMin),
    replyCountMax: numberOrNull(raw.replyCountMax),
    humanCountMin: numberOrNull(raw.humanCountMin),
    humanCountMax: numberOrNull(raw.humanCountMax),
    teams: raw.teams,
    adminNames: raw.adminNames,
    categories: raw.categories,
    adminIds: splitVals(raw.adminIds),
    sourceIds,
  };
}

function countActive(raw: Raw): number {
  let n = 0;
  if (raw.dateStart || raw.dateEnd) n++;
  if (raw.feedbackCountMin.trim() || raw.feedbackCountMax.trim()) n++;
  if (raw.replyCountMin.trim() || raw.replyCountMax.trim()) n++;
  if (raw.humanCountMin.trim() || raw.humanCountMax.trim()) n++;
  for (const key of TEXT_KEYS) if (splitVals(raw[key]).length) n++;
  if (raw.teams.length) n++;
  if (raw.adminNames.length) n++;
  if (raw.categories.length) n++;
  return n;
}

const inputCls = "qms-input !py-1.5 text-[12px]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--fg-tertiary)]">{label}</span>
      {children}
    </div>
  );
}

type Options = { teamAgents: { team: string; name: string }[]; categories: string[] };

export default function FeedbackFilterPanel({
  initial,
  defaults,
  disabled,
  onApply,
}: {
  initial?: FeedbackSampleFilters;
  /** 초기화 시 돌아갈 값. 답변 0건 제외처럼 화면 기본값을 유지할 때 쓴다. */
  defaults?: FeedbackSampleFilters;
  disabled?: boolean;
  onApply: (filters: FeedbackSampleFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<Raw>(() => fromFilters(initial ?? defaults));
  const [options, setOptions] = useState<Options>({ teamAgents: [], categories: [] });
  const [optionsError, setOptionsError] = useState(false);
  const active = countActive(raw);
  const lookupByThread = splitVals(raw.sourceIds).length > 0;
  const fieldsDisabled = Boolean(disabled) || lookupByThread;

  useEffect(() => {
    fetch("/api/evaluations/feedback/filter-options")
      .then((r) => (r.ok ? (r.json() as Promise<Options>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setOptions(d);
        setOptionsError(false);
      })
      .catch(() => setOptionsError(true));
  }, []);

  const teamOptions = useMemo(
    () => sortKo([...new Set(options.teamAgents.map((p) => p.team).filter(Boolean))]),
    [options],
  );
  const nameOptions = useMemo(() => {
    const pairs = raw.teams.length ? options.teamAgents.filter((p) => raw.teams.includes(p.team)) : options.teamAgents;
    return sortKo([...new Set(pairs.map((p) => p.name))]);
  }, [options, raw.teams]);

  const setText = (key: (typeof TEXT_KEYS)[number]) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRaw((p) => ({ ...p, [key]: e.target.value }));
  const setStr = (key: "dateStart" | "dateEnd") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRaw((p) => ({ ...p, [key]: e.target.value }));
  const setCount =
    (key: "feedbackCountMin" | "feedbackCountMax" | "replyCountMin" | "replyCountMax" | "humanCountMin" | "humanCountMax") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setRaw((p) => ({ ...p, [key]: e.target.value.replace(/[^\d]/g, "") }));

  const setSourceIds = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sourceIds = e.target.value;
    setRaw((p) => {
      if (!splitVals(sourceIds).length) return { ...p, sourceIds };
      // 스레드 ID는 명시 조회라서 나머지 필터를 비운다.
      return { ...fromFilters({}), sourceIds };
    });
  };

  // 팀을 좁히면 그 팀에 없는 어드민 선택은 버린다(콜 품질 필터와 같은 규칙).
  const setTeams = (v: string[]) =>
    setRaw((p) => {
      const valid = v.length ? new Set(options.teamAgents.filter((a) => v.includes(a.team)).map((a) => a.name)) : null;
      const adminNames = valid ? p.adminNames.filter((n) => valid.has(n)) : p.adminNames;
      return { ...p, teams: v, adminNames };
    });

  const reset = () => {
    const next = fromFilters(defaults ?? {});
    setRaw(next);
    onApply(toFilters(next));
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] transition hover:bg-[var(--bg-muted)]"
      >
        <span className="inline-flex items-center gap-2 font-semibold text-[var(--fg-primary)]">
          <Filter className="h-4 w-4 text-[var(--brand)]" />
          필터
          {active > 0 && (
            <span className="rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-bold text-white">
              {active}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[var(--fg-tertiary)]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--fg-tertiary)]" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] px-3.5 py-3.5">
          {optionsError && (
            <p className="rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning-subtle)] px-3 py-2 text-[11px] text-[var(--warning)]">
              소속·어드민·카테고리 목록을 불러오지 못했어요. 새로고침해도 그대로면 관리자에게 알려주세요. (ID 입력·날짜
              필터는 그대로 쓸 수 있어요)
            </p>
          )}
          {/* 좁은 사이드 패널: 1열 고정 */}
          <div className="grid grid-cols-1 gap-3">
            <Field label="문의 날짜">
              <div className="grid grid-cols-1 gap-1.5">
                <input
                  type="date"
                  value={raw.dateStart}
                  onChange={setStr("dateStart")}
                  disabled={fieldsDisabled}
                  className={`${inputCls} w-full min-w-0`}
                  aria-label="문의 날짜 시작"
                />
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-[11px] text-[var(--fg-tertiary)]">~</span>
                  <input
                    type="date"
                    value={raw.dateEnd}
                    onChange={setStr("dateEnd")}
                    disabled={fieldsDisabled}
                    className={`${inputCls} min-w-0 flex-1`}
                    aria-label="문의 날짜 종료"
                  />
                </div>
              </div>
            </Field>
            <RangeField
              label="문의 개수"
              minValue={raw.feedbackCountMin}
              maxValue={raw.feedbackCountMax}
              onMinChange={setCount("feedbackCountMin")}
              onMaxChange={setCount("feedbackCountMax")}
              disabled={fieldsDisabled}
            />
            <RangeField
              label="답변 개수"
              minValue={raw.replyCountMin}
              maxValue={raw.replyCountMax}
              onMinChange={setCount("replyCountMin")}
              onMaxChange={setCount("replyCountMax")}
              disabled={fieldsDisabled}
            />
            <RangeField
              label="답변 담당자 수"
              minValue={raw.humanCountMin}
              maxValue={raw.humanCountMax}
              onMinChange={setCount("humanCountMin")}
              onMaxChange={setCount("humanCountMax")}
              disabled={fieldsDisabled}
            />
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Field label="상담사 소속(팀)">
              <MultiSelect
                options={teamOptions}
                selected={raw.teams}
                onChange={setTeams}
                placeholder="팀 선택"
                disabled={fieldsDisabled}
              />
            </Field>
            <Field label="상담사 닉네임">
              <MultiSelect
                options={nameOptions}
                selected={raw.adminNames}
                onChange={(adminNames) => setRaw((p) => ({ ...p, adminNames }))}
                placeholder="닉네임 선택"
                disabled={fieldsDisabled}
              />
              <p className="mt-1 text-[10.5px] text-[var(--fg-tertiary)]">
                담당 어드민이거나 답변에 참여한 어드민이면 표시합니다.
              </p>
            </Field>
            <Field label="카테고리">
              <MultiSelect
                options={options.categories}
                selected={raw.categories}
                onChange={(categories) => setRaw((p) => ({ ...p, categories }))}
                placeholder="카테고리 선택"
                disabled={fieldsDisabled}
              />
            </Field>
            <Field label="상담사 ID">
              <input
                value={raw.adminIds}
                onChange={setText("adminIds")}
                placeholder="쉼표로 여러 개"
                disabled={fieldsDisabled}
                className={`${inputCls} w-full min-w-0`}
              />
            </Field>
            <Field label="문의 스레드 ID">
              <input
                value={raw.sourceIds}
                onChange={setSourceIds}
                placeholder="쉼표로 여러 개"
                aria-label="문의 스레드 ID"
                className={`${inputCls} w-full min-w-0`}
              />
              <p className="mt-1 text-[10.5px] text-[var(--fg-tertiary)]">
                스레드 ID로 찾으면 다른 필터는 비우고 해당 건만 조회합니다.
              </p>
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={reset} disabled={disabled} className="qms-btn-ghost !h-8 text-[12px]">
              <X className="mr-1 inline h-3.5 w-3.5" />
              초기화
            </button>
            <button
              type="button"
              onClick={() => onApply(toFilters(raw))}
              disabled={disabled}
              className="qms-btn-primary !h-8 text-[12px]"
            >
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
    <Field label={label}>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="number"
          min={0}
          value={minValue}
          onChange={onMinChange}
          disabled={disabled}
          placeholder="최소"
          aria-label={`${label} 최소`}
          className={`${inputCls} min-w-0 flex-1`}
        />
        <span className="shrink-0 text-[11px] text-[var(--fg-tertiary)]">~</span>
        <input
          type="number"
          min={0}
          value={maxValue}
          onChange={onMaxChange}
          disabled={disabled}
          placeholder="최대"
          aria-label={`${label} 최대`}
          className={`${inputCls} min-w-0 flex-1`}
        />
      </div>
    </Field>
  );
}

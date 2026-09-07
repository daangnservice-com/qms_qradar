"use client";

import { useEffect, useMemo, useState } from "react";
import { Filter, ChevronDown, ChevronUp, X } from "lucide-react";
import type { SampleFilters } from "@/lib/types";
import { Chip } from "seed-design/ui/chip";
import MultiSelect from "./MultiSelect";

type Raw = {
  callDateStart: string;
  callDateEnd: string;
  callLenMin: string;
  callLenMax: string;
  conversationIds: string;
  phoneInquiryIds: string;
  adminUserIds: string;
  teams: string[];
  categories: string[];
  adminNames: string[];
  analyzedOnly: boolean;
  highRiskOnly: boolean;
  reviewStatus: "" | "completed" | "incomplete";
};

const EMPTY: Raw = {
  callDateStart: "",
  callDateEnd: "",
  callLenMin: "",
  callLenMax: "",
  conversationIds: "",
  phoneInquiryIds: "",
  adminUserIds: "",
  teams: [],
  categories: [],
  adminNames: [],
  analyzedOnly: false,
  highRiskOnly: false,
  reviewStatus: "",
};

const TEXT_KEYS = ["conversationIds", "phoneInquiryIds", "adminUserIds"] as const;

const splitVals = (s: string): string[] =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

const sortKo = (a: string[]) => [...a].sort((x, y) => x.localeCompare(y, "ko"));

function fromFilters(f: SampleFilters | undefined, fieldsOnly: boolean): Raw {
  const g = f ?? {};
  const base: Raw = {
    callDateStart: g.callDateStart ?? "",
    callDateEnd: g.callDateEnd ?? "",
    callLenMin: g.callLenMin != null ? String(g.callLenMin) : "",
    callLenMax: g.callLenMax != null ? String(g.callLenMax) : "",
    conversationIds: (g.conversationIds ?? []).join(", "),
    phoneInquiryIds: (g.phoneInquiryIds ?? []).join(", "),
    adminUserIds: (g.adminUserIds ?? []).join(", "),
    teams: g.teams ?? [],
    categories: g.categories ?? [],
    adminNames: g.adminNames ?? [],
    analyzedOnly: false,
    highRiskOnly: false,
    reviewStatus: "",
  };
  if (fieldsOnly) return base;
  return {
    ...base,
    analyzedOnly: Boolean(g.analyzedOnly),
    highRiskOnly: Boolean(g.highRiskOnly),
    reviewStatus: g.reviewStatus === "completed" || g.reviewStatus === "incomplete" ? g.reviewStatus : "",
  };
}

function toFilters(r: Raw, fieldsOnly: boolean): SampleFilters {
  const out: SampleFilters = {
    conversationIds: splitVals(r.conversationIds),
    phoneInquiryIds: splitVals(r.phoneInquiryIds),
    adminUserIds: splitVals(r.adminUserIds),
    teams: r.teams,
    categories: r.categories,
    adminNames: r.adminNames,
    callDateStart: r.callDateStart || null,
    callDateEnd: r.callDateEnd || null,
    callLenMin: r.callLenMin.trim() ? Number(r.callLenMin) : null,
    callLenMax: r.callLenMax.trim() ? Number(r.callLenMax) : null,
  };
  if (fieldsOnly) return out;
  return {
    ...out,
    analyzedOnly: r.analyzedOnly || undefined,
    highRiskOnly: r.highRiskOnly || undefined,
    reviewStatus: r.reviewStatus === "completed" || r.reviewStatus === "incomplete" ? r.reviewStatus : undefined,
  };
}

function countActive(r: Raw, fieldsOnly: boolean): number {
  let n = 0;
  if (r.callDateStart || r.callDateEnd) n++;
  if (r.callLenMin.trim() || r.callLenMax.trim()) n++;
  for (const k of TEXT_KEYS) if (splitVals(r[k]).length) n++;
  if (r.teams.length) n++;
  if (r.categories.length) n++;
  if (r.adminNames.length) n++;
  if (!fieldsOnly) {
    if (r.analyzedOnly) n++;
    if (r.highRiskOnly) n++;
    if (r.reviewStatus) n++;
  }
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

export default function FilterPanel({
  onApply,
  disabled,
  initial,
  showReviewFilter,
  fieldsOnly,
}: {
  onApply: (f: SampleFilters) => void;
  disabled?: boolean;
  initial?: SampleFilters;
  /** @deprecated 평가 진행은 SampleListQuickFilters 사용 */
  showReviewFilter?: boolean;
  /** true면 날짜·팀 등 필드만 (AI평가·고위험·수기검수 제외) */
  fieldsOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<Raw>(() => fromFilters(initial, Boolean(fieldsOnly)));
  const [options, setOptions] = useState<Options>({ teamAgents: [], categories: [] });
  const [optionsError, setOptionsError] = useState(false);
  const active = countActive(raw, Boolean(fieldsOnly));

  useEffect(() => {
    fetch("/api/call-quality/filter-options")
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

  const setText = (k: (typeof TEXT_KEYS)[number]) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRaw((p) => ({ ...p, [k]: e.target.value }));
  const setStr =
    (k: "callDateStart" | "callDateEnd" | "callLenMin" | "callLenMax") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setRaw((p) => ({ ...p, [k]: e.target.value }));

  const setTeams = (v: string[]) =>
    setRaw((p) => {
      const valid = v.length ? new Set(options.teamAgents.filter((a) => v.includes(a.team)).map((a) => a.name)) : null;
      const adminNames = valid ? p.adminNames.filter((n) => valid.has(n)) : p.adminNames;
      return { ...p, teams: v, adminNames };
    });
  const setCategories = (v: string[]) => setRaw((p) => ({ ...p, categories: v }));
  const setAdminNames = (v: string[]) => setRaw((p) => ({ ...p, adminNames: v }));

  const apply = () => onApply(toFilters(raw, Boolean(fieldsOnly)));
  const reset = () => {
    const empty = fromFilters(undefined, Boolean(fieldsOnly));
    setRaw(empty);
    onApply(toFilters(empty, Boolean(fieldsOnly)));
  };

  const callDateRange = (
    <div className="grid grid-cols-1 gap-1.5">
      <input
        type="date"
        value={raw.callDateStart}
        onChange={setStr("callDateStart")}
        className={`${inputCls} w-full min-w-0`}
        aria-label="콜 날짜 시작"
      />
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-[var(--fg-tertiary)]">~</span>
        <input
          type="date"
          value={raw.callDateEnd}
          onChange={setStr("callDateEnd")}
          className={`${inputCls} min-w-0 flex-1`}
          aria-label="콜 날짜 종료"
        />
      </div>
    </div>
  );

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
              팀·상담사·카테고리 목록을 불러오지 못했어요. 새로고침해도 그대로면 관리자에게 알려주세요. (ID 입력·날짜
              필터는 그대로 쓸 수 있어요)
            </p>
          )}
          {/* 좁은 사이드 패널: 1열 고정 (sm:grid-cols-2면 날짜·통화시간이 겹침) */}
          <div className="grid grid-cols-1 gap-3">
            <Field label="콜 날짜">{callDateRange}</Field>
            <Field label="통화 시간(분)">
              <div className="flex min-w-0 items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  placeholder="최소"
                  value={raw.callLenMin}
                  onChange={setStr("callLenMin")}
                  className={`${inputCls} min-w-0 flex-1`}
                />
                <span className="shrink-0 text-[var(--fg-tertiary)]">~</span>
                <input
                  type="number"
                  min={0}
                  placeholder="최대"
                  value={raw.callLenMax}
                  onChange={setStr("callLenMax")}
                  className={`${inputCls} min-w-0 flex-1`}
                />
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Field label="상담사 소속(팀)">
              <MultiSelect options={teamOptions} selected={raw.teams} onChange={setTeams} placeholder="팀 선택" disabled={disabled} />
            </Field>
            <Field label="상담사 닉네임">
              <MultiSelect
                options={nameOptions}
                selected={raw.adminNames}
                onChange={setAdminNames}
                placeholder="닉네임 선택"
                disabled={disabled}
              />
            </Field>
            <Field label="카테고리">
              <MultiSelect
                options={options.categories}
                selected={raw.categories}
                onChange={setCategories}
                placeholder="카테고리 선택"
                disabled={disabled}
              />
            </Field>
            <Field label="상담사 ID">
              <input
                value={raw.adminUserIds}
                onChange={setText("adminUserIds")}
                placeholder="쉼표로 여러 개"
                className={`${inputCls} w-full min-w-0`}
              />
            </Field>
            <Field label="상담이력 ID">
              <input
                value={raw.phoneInquiryIds}
                onChange={setText("phoneInquiryIds")}
                placeholder="쉼표로 여러 개"
                className={`${inputCls} w-full min-w-0`}
              />
            </Field>
            <Field label="Conversation ID">
              <input
                value={raw.conversationIds}
                onChange={setText("conversationIds")}
                placeholder="쉼표로 여러 개"
                className={`${inputCls} w-full min-w-0`}
              />
            </Field>
          </div>

          {!fieldsOnly && (
            <>
              <button
                type="button"
                role="switch"
                aria-checked={raw.analyzedOnly}
                disabled={disabled}
                onClick={() => setRaw((p) => ({ ...p, analyzedOnly: !p.analyzedOnly }))}
                className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-2.5 text-left transition hover:bg-[var(--bg-canvas)] disabled:opacity-50`}
              >
                <span className="text-[12px] font-medium text-[var(--fg-primary)]">AI 평가 완료만 찾기</span>
                <span
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                    raw.analyzedOnly ? "bg-[var(--brand)]" : "bg-[var(--border-strong)]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                      raw.analyzedOnly ? "translate-x-4" : ""
                    }`}
                  />
                </span>
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={raw.highRiskOnly}
                disabled={disabled}
                onClick={() => setRaw((p) => ({ ...p, highRiskOnly: !p.highRiskOnly }))}
                className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-2.5 text-left transition hover:bg-[var(--bg-canvas)] disabled:opacity-50`}
              >
                <span className="text-[12px] font-medium text-[var(--fg-primary)]">고위험군만 보기</span>
                <span
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                    raw.highRiskOnly ? "bg-[var(--brand)]" : "bg-[var(--border-strong)]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                      raw.highRiskOnly ? "translate-x-4" : ""
                    }`}
                  />
                </span>
              </button>

              {showReviewFilter && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-medium text-[var(--fg-tertiary)]">수기 검수</span>
                  <Chip.RadioRoot
                    value={raw.reviewStatus || "all"}
                    aria-label="수기 검수 완료 여부"
                    disabled={disabled}
                    onValueChange={(v) =>
                      setRaw((p) => ({
                        ...p,
                        reviewStatus: v === "completed" || v === "incomplete" ? v : "",
                      }))
                    }
                  >
                    <div className="flex flex-wrap gap-1.5">
                      <Chip.RadioItem value="all" size="small" variant="outlineStrong">
                        <Chip.Label>전체</Chip.Label>
                      </Chip.RadioItem>
                      <Chip.RadioItem value="completed" size="small" variant="outlineStrong">
                        <Chip.Label>수기 검수 완료만</Chip.Label>
                      </Chip.RadioItem>
                      <Chip.RadioItem value="incomplete" size="small" variant="outlineStrong">
                        <Chip.Label>수기 검수 미완료만</Chip.Label>
                      </Chip.RadioItem>
                    </div>
                  </Chip.RadioRoot>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={reset} disabled={disabled} className="qms-btn-ghost !h-8 text-[12px]">
              <X className="mr-1 inline h-3.5 w-3.5" />
              초기화
            </button>
            <button type="button" onClick={apply} disabled={disabled} className="qms-btn-primary !h-8 text-[12px]">
              필터 적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

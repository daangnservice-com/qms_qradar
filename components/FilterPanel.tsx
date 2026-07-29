"use client";

import { useEffect, useMemo, useState } from "react";
import { Filter, ChevronDown, ChevronUp, X } from "lucide-react";
import type { SampleFilters } from "@/lib/types";
import MultiSelect from "./MultiSelect";

type Raw = {
  callDateStart: string;
  callDateEnd: string;
  callLenMin: string;
  callLenMax: string;
  // 정확 일치 ID류: 텍스트(쉼표 구분)
  conversationIds: string;
  phoneInquiryIds: string;
  adminUserIds: string;
  // 범주형: 고유값 드롭다운
  teams: string[];
  categories: string[];
  adminNames: string[];
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
};

const TEXT_KEYS = ["conversationIds", "phoneInquiryIds", "adminUserIds"] as const;

const splitVals = (s: string): string[] =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

const sortKo = (a: string[]) => [...a].sort((x, y) => x.localeCompare(y, "ko"));

function fromFilters(f: SampleFilters | undefined): Raw {
  const g = f ?? {};
  return {
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
  };
}

function toFilters(r: Raw): SampleFilters {
  return {
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
}

function countActive(r: Raw): number {
  let n = 0;
  if (r.callDateStart || r.callDateEnd) n++;
  if (r.callLenMin.trim() || r.callLenMax.trim()) n++;
  for (const k of TEXT_KEYS) if (splitVals(r[k]).length) n++;
  if (r.teams.length) n++;
  if (r.categories.length) n++;
  if (r.adminNames.length) n++;
  return n;
}

const inputCls =
  "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-800 focus-visible:outline-2 focus-visible:outline-navy";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-medium text-gray-500">{label}</span>
      {children}
    </div>
  );
}

type Options = { teamAgents: { team: string; name: string }[]; categories: string[] };

export default function FilterPanel({
  onApply,
  disabled,
  initial,
}: {
  onApply: (f: SampleFilters) => void;
  disabled?: boolean;
  initial?: SampleFilters;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<Raw>(() => fromFilters(initial));
  const [options, setOptions] = useState<Options>({ teamAgents: [], categories: [] });
  const [optionsError, setOptionsError] = useState(false);
  const active = countActive(raw);

  // 옵션 로딩이 실패하면 드롭다운이 "값이 없어요"로만 보여 원인을 알 수 없다 → 별도로 알린다.
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
  // 팀이 선택되면 그 팀 소속 상담사만, 아니면 전체 상담사.
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

  // 팀 변경 시, 더 이상 유효하지 않은 상담사 선택은 정리한다.
  const setTeams = (v: string[]) =>
    setRaw((p) => {
      const valid = v.length ? new Set(options.teamAgents.filter((a) => v.includes(a.team)).map((a) => a.name)) : null;
      const adminNames = valid ? p.adminNames.filter((n) => valid.has(n)) : p.adminNames;
      return { ...p, teams: v, adminNames };
    });
  const setCategories = (v: string[]) => setRaw((p) => ({ ...p, categories: v }));
  const setAdminNames = (v: string[]) => setRaw((p) => ({ ...p, adminNames: v }));

  const apply = () => onApply(toFilters(raw));
  const reset = () => {
    setRaw(EMPTY);
    onApply({});
  };

  const callDateRange = (
    <div className="flex items-center gap-1.5">
      <input type="date" value={raw.callDateStart} onChange={setStr("callDateStart")} className={inputCls} />
      <span className="text-gray-400">~</span>
      <input type="date" value={raw.callDateEnd} onChange={setStr("callDateEnd")} className={inputCls} />
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm transition hover:bg-gray-50"
      >
        <span className="inline-flex items-center gap-2 font-semibold text-gray-800">
          <Filter className="h-4 w-4 text-navy" />
          필터
          {active > 0 && <span className="rounded-full bg-navy px-1.5 py-0.5 text-[10px] font-bold text-white">{active}</span>}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-4">
          {optionsError && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              팀·상담사·카테고리 목록을 불러오지 못했어요. 새로고침해도 그대로면 관리자에게 알려주세요. (ID 입력·날짜 필터는 그대로 쓸 수 있어요)
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="콜 날짜">{callDateRange}</Field>
            <Field label="통화 시간(분)">
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} placeholder="최소" value={raw.callLenMin} onChange={setStr("callLenMin")} className={inputCls} />
                <span className="text-gray-400">~</span>
                <input type="number" min={0} placeholder="최대" value={raw.callLenMax} onChange={setStr("callLenMax")} className={inputCls} />
              </div>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="상담사 소속(팀)">
              <MultiSelect options={teamOptions} selected={raw.teams} onChange={setTeams} placeholder="팀 선택" disabled={disabled} />
            </Field>
            <Field label="상담사 닉네임">
              <MultiSelect options={nameOptions} selected={raw.adminNames} onChange={setAdminNames} placeholder="닉네임 선택" disabled={disabled} />
            </Field>
            <Field label="카테고리">
              <MultiSelect options={options.categories} selected={raw.categories} onChange={setCategories} placeholder="카테고리 선택" disabled={disabled} />
            </Field>
            <Field label="상담사 ID">
              <input value={raw.adminUserIds} onChange={setText("adminUserIds")} placeholder="쉼표로 여러 개" className={inputCls} />
            </Field>
            <Field label="상담이력 ID">
              <input value={raw.phoneInquiryIds} onChange={setText("phoneInquiryIds")} placeholder="쉼표로 여러 개" className={inputCls} />
            </Field>
            <Field label="Conversation ID">
              <input value={raw.conversationIds} onChange={setText("conversationIds")} placeholder="쉼표로 여러 개" className={inputCls} />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              초기화
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={disabled}
              className="rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-hover disabled:opacity-50"
            >
              필터 적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

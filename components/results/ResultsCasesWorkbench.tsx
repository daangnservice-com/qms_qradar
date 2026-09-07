"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PrefixIcon, Text } from "@seed-design/react";
import IconArrow2ClockwiseCircularLine from "@karrotmarket/react-monochrome-icon/IconArrow2ClockwiseCircularLine";
import { ActionButton } from "seed-design/ui/action-button";
import { Callout } from "seed-design/ui/callout";
import { Checkbox } from "seed-design/ui/checkbox";
import { ProgressCircle } from "seed-design/ui/progress-circle";
import { useCachedFetch } from "@/lib/useCachedFetch";
import type { QmsCaseRow, ResultsOptions } from "@/lib/resultsStore";
import { FilterSelect, ResultsStat } from "./ResultsShared";
import { ResultsCaseCard } from "./ResultsCaseCard";

type OptionsRes = { ok: boolean; options: ResultsOptions };
type CasesRes = { ok: boolean; rows: QmsCaseRow[]; truncated: boolean };

type MemberGroup = {
  key: string;
  label: string;
  cases: QmsCaseRow[];
  wrong: number;
  memo: number;
  cold: number;
  templates: Map<string, { label: string; cases: QmsCaseRow[] }>;
};

function buildMemberTree(rows: QmsCaseRow[]): MemberGroup[] {
  const map = new Map<string, MemberGroup>();
  for (const row of rows) {
    let m = map.get(row.memberKey);
    if (!m) {
      m = {
        key: row.memberKey,
        label: row.memberLabel,
        cases: [],
        wrong: 0,
        memo: 0,
        cold: 0,
        templates: new Map(),
      };
      map.set(row.memberKey, m);
    }
    m.cases.push(row);
    if (row.hasWrongScore) m.wrong += 1;
    if (row.hasMemo) m.memo += 1;
    if (row.isCold) m.cold += 1;
    let t = m.templates.get(row.templateKey);
    if (!t) {
      t = { label: row.templateLabel, cases: [] };
      m.templates.set(row.templateKey, t);
    }
    t.cases.push(row);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

function Disclosure({
  title,
  meta,
  defaultOpen,
  children,
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--bg-muted)]"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--fg-tertiary)] transition ${open ? "rotate-0" : "-rotate-90"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-[var(--fg-primary)]">{title}</div>
          {meta && <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{meta}</div>}
        </div>
      </button>
      {open && <div className="space-y-3 border-t border-[var(--border-subtle)] p-3">{children}</div>}
    </div>
  );
}

export default function ResultsCasesWorkbench() {
  const [month, setMonth] = useState("");
  const [team, setTeam] = useState("");
  const [member, setMember] = useState("");
  const [template, setTemplate] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [wrongOnly, setWrongOnly] = useState(false);

  const { data: optData, refresh: refreshOpts } = useCachedFetch<OptionsRes>({
    key: `resultsOptions:v1:${month}:${team}`,
    fetcher: async () => {
      const sp = new URLSearchParams();
      if (month) sp.set("month", month);
      if (team) sp.set("team", team);
      const r = await fetch(`/api/results/options?${sp}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "옵션 로드 실패");
      return d as OptionsRes;
    },
  });

  const options = optData?.options;
  const effectiveMonth = month || options?.months[0]?.value || "";

  useEffect(() => {
    if (!month && options?.months[0]?.value) {
      setMonth(options.months[0].value);
    }
  }, [month, options?.months]);

  const casesKey = effectiveMonth
    ? `resultsCases:v1:${effectiveMonth}:${team}:${member}:${template}:${qDebounced}:${wrongOnly ? 1 : 0}`
    : "resultsCases:v1:none";

  const { data, loading, validating, error, refresh } = useCachedFetch<CasesRes>({
    key: casesKey,
    enabled: Boolean(effectiveMonth),
    fetcher: async () => {
      const sp = new URLSearchParams({ month: effectiveMonth });
      if (team) sp.set("team", team);
      if (member) sp.set("member", member);
      if (template) sp.set("template", template);
      if (qDebounced) sp.set("q", qDebounced);
      if (wrongOnly) sp.set("wrongOnly", "1");
      const r = await fetch(`/api/results/cases?${sp}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "케이스 로드 실패");
      return d as CasesRes;
    },
  });

  const rows = data?.rows ?? [];
  const tree = useMemo(() => buildMemberTree(rows), [rows]);

  const stats = useMemo(() => {
    const wrong = rows.filter((r) => r.hasWrongScore).length;
    const memo = rows.filter((r) => r.hasMemo).length;
    const members = new Set(rows.map((r) => r.memberKey)).size;
    const templates = new Set(rows.map((r) => r.templateKey)).size;
    return { cases: rows.length, wrong, memo, members, templates };
  }, [rows]);

  return (
    <div className="qms-page-body space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Text as="p" textStyle="t2Bold" color="fg.neutralSubtle">
            품질평가
          </Text>
          <Text as="h1" textStyle="t9Bold" color="fg.neutral">
            케이스 상세
          </Text>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
            QMS 사람 평가 케이스를 월·구성원·템플릿 단위로 살펴봐요
          </Text>
        </div>
        <ActionButton
          variant="neutralWeak"
          size="small"
          loading={validating || loading}
          onClick={() => {
            void refreshOpts();
            void refresh();
          }}
        >
          <PrefixIcon svg={<IconArrow2ClockwiseCircularLine />} />
          새로고침
        </ActionButton>
      </header>

      <div className="sticky top-0 z-10 -mx-1 space-y-3 rounded-[14px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-canvas)_92%,transparent)] p-3 backdrop-blur">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="평가월"
            value={effectiveMonth}
            onChange={(v) => {
              setMonth(v);
              setMember("");
              setTemplate("");
            }}
            options={options?.months ?? []}
            allLabel="월 선택"
          />
          <FilterSelect
            label="팀"
            value={team}
            onChange={(v) => {
              setTeam(v);
              setMember("");
            }}
            options={options?.teams ?? []}
            allLabel="전체 팀"
          />
          <FilterSelect
            label="구성원"
            value={member}
            onChange={setMember}
            options={options?.members ?? []}
            allLabel="전체 구성원"
          />
          <FilterSelect
            label="템플릿"
            value={template}
            onChange={setTemplate}
            options={options?.templates ?? []}
            allLabel="전체 템플릿"
          />
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              검색
            </Text>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => setQDebounced(q.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") setQDebounced(q.trim());
              }}
              placeholder="케이스/메모/오답/이름"
              className="qms-input h-9 px-2.5 text-[13px] font-medium"
            />
          </label>
          <div className="mb-1.5">
            <Checkbox checked={wrongOnly} onCheckedChange={setWrongOnly} label="오답만" size="medium" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <ResultsStat label="케이스" value={stats.cases} />
        <ResultsStat label="오답 케이스" value={stats.wrong} />
        <ResultsStat label="메모 포함" value={stats.memo} />
        <ResultsStat label="구성원" value={stats.members} />
        <ResultsStat label="템플릿" value={stats.templates} />
      </div>

      {error && (
        <Callout tone="critical" title="케이스를 불러오지 못했어요" description={error} />
      )}

      {data?.truncated && (
        <Callout
          tone="warning"
          description="결과가 많아 일부만 표시했어요. 필터를 더 좁혀 주세요."
        />
      )}

      {loading && !rows.length ? (
        <div className="flex items-center justify-center gap-2 py-16">
          <ProgressCircle size="24" />
          <Text textStyle="t4Regular" color="fg.neutralSubtle">
            불러오는 중…
          </Text>
        </div>
      ) : !effectiveMonth ? (
        <p className="py-16 text-center text-[13px] text-[var(--fg-tertiary)]">평가월을 선택해 주세요</p>
      ) : !rows.length ? (
        <p className="py-16 text-center text-[13px] text-[var(--fg-tertiary)]">조건에 맞는 케이스가 없어요</p>
      ) : (
        <div className="space-y-3">
          <Disclosure
            title={`${effectiveMonth}`}
            meta={`케이스 ${rows.length} · 구성원 ${tree.length}`}
            defaultOpen
          >
            {tree.map((m) => (
              <Disclosure
                key={m.key}
                title={m.label}
                meta={`케이스 ${m.cases.length} · Cold ${m.cold} · 오답 ${m.wrong} · 메모 ${m.memo}`}
              >
                {[...m.templates.entries()].map(([tk, t]) => (
                  <Disclosure key={tk} title={t.label} meta={`케이스 ${t.cases.length}`}>
                    {t.cases.map((c) => (
                      <ResultsCaseCard key={c.caseKey + c.evaluationTargetId} row={c} />
                    ))}
                  </Disclosure>
                ))}
              </Disclosure>
            ))}
          </Disclosure>
        </div>
      )}
    </div>
  );
}

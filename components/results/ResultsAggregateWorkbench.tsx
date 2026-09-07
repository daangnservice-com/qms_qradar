"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PrefixIcon, Text } from "@seed-design/react";
import IconArrow2ClockwiseCircularLine from "@karrotmarket/react-monochrome-icon/IconArrow2ClockwiseCircularLine";
import { ActionButton } from "seed-design/ui/action-button";
import { Callout } from "seed-design/ui/callout";
import { ProgressCircle } from "seed-design/ui/progress-circle";
import { useCachedFetch } from "@/lib/useCachedFetch";
import type { QmsCaseRow, ResultsOptions } from "@/lib/resultsStore";
import { FilterSelect, ResultsStat, pct } from "./ResultsShared";
import { ResultsCaseCard } from "./ResultsCaseCard";

type OptionsRes = { ok: boolean; options: ResultsOptions };
type CasesRes = { ok: boolean; rows: QmsCaseRow[]; truncated: boolean };

type MemberNode = {
  memberKey: string;
  memberLabel: string;
  cases: QmsCaseRow[];
  caseCount: number;
  coldCount: number;
  notColdCount: number;
  coldRate: number;
};

type TeamNode = {
  teamKey: string;
  teamLabel: string;
  members: MemberNode[];
  caseCount: number;
  coldCount: number;
  notColdCount: number;
  coldRate: number;
};

type MonthNode = {
  monthKey: string;
  teams: TeamNode[];
  caseCount: number;
  coldCount: number;
  notColdCount: number;
  coldRate: number;
};

function buildTree(rows: QmsCaseRow[]): {
  months: MonthNode[];
  summary: {
    memberCount: number;
    coldCount: number;
    notColdCount: number;
    coldRate: number;
  };
} {
  const monthMap = new Map<string, MonthNode>();
  const memberKeys = new Set<string>();
  let totalCold = 0;
  let totalNot = 0;

  for (const row of rows) {
    const monthKey = row.yearMonth || "미지정";
    let month = monthMap.get(monthKey);
    if (!month) {
      month = { monthKey, teams: [], caseCount: 0, coldCount: 0, notColdCount: 0, coldRate: 0 };
      monthMap.set(monthKey, month);
    }

    let team = month.teams.find((t) => t.teamKey === row.teamLabel);
    if (!team) {
      team = {
        teamKey: row.teamLabel,
        teamLabel: row.teamLabel,
        members: [],
        caseCount: 0,
        coldCount: 0,
        notColdCount: 0,
        coldRate: 0,
      };
      month.teams.push(team);
    }

    let member = team.members.find((m) => m.memberKey === row.memberKey);
    if (!member) {
      member = {
        memberKey: row.memberKey,
        memberLabel: row.memberLabel,
        cases: [],
        caseCount: 0,
        coldCount: 0,
        notColdCount: 0,
        coldRate: 0,
      };
      team.members.push(member);
    }

    member.cases.push(row);
    member.caseCount += 1;
    team.caseCount += 1;
    month.caseCount += 1;
    memberKeys.add(row.memberKey);

    if (row.isCold) {
      member.coldCount += 1;
      team.coldCount += 1;
      month.coldCount += 1;
      totalCold += 1;
    } else {
      member.notColdCount += 1;
      team.notColdCount += 1;
      month.notColdCount += 1;
      totalNot += 1;
    }
  }

  const rate = (c: number, n: number) => (c + n ? c / (c + n) : 0);

  const months = [...monthMap.values()]
    .map((m) => ({
      ...m,
      coldRate: rate(m.coldCount, m.notColdCount),
      teams: m.teams
        .map((t) => ({
          ...t,
          coldRate: rate(t.coldCount, t.notColdCount),
          members: t.members
            .map((mem) => ({
              ...mem,
              coldRate: rate(mem.coldCount, mem.notColdCount),
            }))
            .sort((a, b) => a.memberLabel.localeCompare(b.memberLabel, "ko")),
        }))
        .sort((a, b) => a.teamLabel.localeCompare(b.teamLabel, "ko")),
    }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

  const total = totalCold + totalNot;
  return {
    months,
    summary: {
      memberCount: memberKeys.size,
      coldCount: totalCold,
      notColdCount: totalNot,
      coldRate: total ? totalCold / total : 0,
    },
  };
}

function groupTemplates(cases: QmsCaseRow[]) {
  const map = new Map<string, { label: string; cases: QmsCaseRow[] }>();
  for (const row of cases) {
    let t = map.get(row.templateKey);
    if (!t) {
      t = { label: row.templateLabel, cases: [] };
      map.set(row.templateKey, t);
    }
    t.cases.push(row);
  }
  return [...map.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ko"));
}

function DisclosureShell({
  defaultOpen,
  depth = 0,
  header,
  children,
}: {
  defaultOpen?: boolean;
  depth?: number;
  header: (opts: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const isMonth = depth === 0;
  return (
    <div
      className={`overflow-hidden rounded-[14px] border border-[var(--border-subtle)] ${
        isMonth ? "bg-white" : depth === 1 ? "bg-[var(--bg-muted)]" : "bg-white"
      }`}
    >
      {header({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div className="space-y-2 border-t border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-[var(--fg-primary)]">
          {children}
        </div>
      )}
    </div>
  );
}

function Chevron({ open, light }: { open: boolean; light?: boolean }) {
  return (
    <ChevronDown
      className={`h-4 w-4 shrink-0 transition ${open ? "rotate-0" : "-rotate-90"} ${
        light ? "text-white/70" : "text-[var(--fg-tertiary)]"
      }`}
    />
  );
}

function MemberStatsInline({
  caseCount,
  coldCount,
  notColdCount,
  coldRate,
  light,
}: {
  caseCount: number;
  coldCount: number;
  notColdCount: number;
  coldRate: number;
  light?: boolean;
}) {
  const label = light ? "text-white/65" : "text-[var(--fg-tertiary)]";
  const value = light ? "text-white" : "text-[var(--fg-primary)]";
  const cold = light ? "text-white" : "text-[var(--danger)]";
  return (
    <div className="grid shrink-0 grid-cols-4 gap-2 text-center text-[10px] sm:gap-3 sm:text-[11px]">
      <div className="min-w-[52px]">
        <div className={`font-semibold ${label}`}>케이스</div>
        <div className={`mt-0.5 text-[12px] font-bold tabular-nums sm:text-[13px] ${value}`}>{caseCount}</div>
      </div>
      <div className="min-w-[52px]">
        <div className={`font-semibold ${label}`}>Cold</div>
        <div className={`mt-0.5 text-[12px] font-bold tabular-nums sm:text-[13px] ${cold}`}>{coldCount}</div>
      </div>
      <div className="min-w-[52px]">
        <div className={`font-semibold ${label}`}>Cold 아님</div>
        <div className={`mt-0.5 text-[12px] font-bold tabular-nums sm:text-[13px] ${value}`}>{notColdCount}</div>
      </div>
      <div className="min-w-[52px]">
        <div className={`font-semibold ${label}`}>Cold 비율</div>
        <div className={`mt-0.5 text-[12px] font-bold tabular-nums sm:text-[13px] ${value}`}>{pct(coldRate)}</div>
      </div>
    </div>
  );
}

function MemberDrilldown({ member }: { member: MemberNode }) {
  const templates = useMemo(() => groupTemplates(member.cases), [member.cases]);

  return (
    <DisclosureShell
      depth={2}
      header={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-[var(--fg-primary)] hover:bg-[var(--bg-subtle)]"
        >
          <Chevron open={open} />
          <div className="min-w-0 flex-1 truncate text-[13px] font-bold">{member.memberLabel}</div>
          <MemberStatsInline
            caseCount={member.caseCount}
            coldCount={member.coldCount}
            notColdCount={member.notColdCount}
            coldRate={member.coldRate}
          />
        </button>
      )}
    >
      {!templates.length ? (
        <p className="py-4 text-center text-[12px] text-[var(--fg-tertiary)]">케이스가 없어요</p>
      ) : (
        <div className="space-y-2">
          {templates.map(([tk, t]) => (
            <DisclosureShell
              key={tk}
              depth={2}
              header={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-[var(--fg-primary)] hover:bg-[var(--bg-subtle)]"
                >
                  <Chevron open={open} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{t.label}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
                      케이스 {t.cases.length} · Cold {t.cases.filter((c) => c.isCold).length} · 오답{" "}
                      {t.cases.filter((c) => c.hasWrongScore).length}
                    </div>
                  </div>
                </button>
              )}
            >
              {t.cases.map((c) => (
                <ResultsCaseCard key={`${c.caseKey}-${c.evaluationTargetId}`} row={c} />
              ))}
            </DisclosureShell>
          ))}
        </div>
      )}
    </DisclosureShell>
  );
}

export default function ResultsAggregateWorkbench() {
  const [month, setMonth] = useState("");
  const [team, setTeam] = useState("");

  const { data: optData, refresh: refreshOpts } = useCachedFetch<OptionsRes>({
    key: "resultsOptions:agg:v2:all",
    fetcher: async () => {
      const r = await fetch("/api/results/options");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "옵션 로드 실패");
      return d as OptionsRes;
    },
  });

  const {
    data: casesData,
    loading,
    validating,
    error,
    refresh,
  } = useCachedFetch<CasesRes>({
    key: "resultsAggCases:v3:all",
    fetcher: async () => {
      const r = await fetch("/api/results/cases?limit=20000");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "케이스 로드 실패");
      return d as CasesRes;
    },
  });

  const filteredRows = useMemo(() => {
    const rows = casesData?.rows ?? [];
    return rows.filter((row) => {
      if (month && row.yearMonth !== month) return false;
      if (team && row.teamLabel !== team) return false;
      return true;
    });
  }, [casesData?.rows, month, team]);

  const tree = useMemo(() => buildTree(filteredRows), [filteredRows]);

  const monthOptions = optData?.options.months ?? [];
  const teamOptions = useMemo(() => {
    const rows = casesData?.rows ?? [];
    const source = month ? rows.filter((r) => r.yearMonth === month) : rows;
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [];
    for (const row of source) {
      if (!row.teamLabel || seen.has(row.teamLabel)) continue;
      seen.add(row.teamLabel);
      opts.push({ value: row.teamLabel, label: row.teamLabel });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label, "ko"));
  }, [casesData?.rows, month]);

  return (
    <div className="qms-page-body space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Text as="p" textStyle="t2Bold" color="fg.neutralSubtle">
            품질평가
          </Text>
          <Text as="h1" textStyle="t9Bold" color="fg.neutral">
            월별 팀별 결과 집계
          </Text>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
            전체 데이터를 한 번 불러온 뒤, 월·팀 필터는 화면에서 적용해요
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

      <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--border-subtle)] bg-white p-3">
        <FilterSelect
          label="평가월"
          value={month}
          onChange={(v) => {
            setMonth(v);
            setTeam("");
          }}
          options={monthOptions}
          allLabel="전체 월"
        />
        <FilterSelect
          label="팀"
          value={team}
          onChange={setTeam}
          options={teamOptions}
          allLabel="전체 팀"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ResultsStat label="구성원" value={tree.summary.memberCount || (casesData ? 0 : "—")} />
        <ResultsStat label="Cold" value={casesData ? tree.summary.coldCount : "—"} />
        <ResultsStat label="Cold 아님" value={casesData ? tree.summary.notColdCount : "—"} />
        <ResultsStat label="Cold 비율" value={casesData ? pct(tree.summary.coldRate) : "—"} />
      </div>

      {error && (
        <Callout tone="critical" title="집계를 불러오지 못했어요" description={error} />
      )}

      {casesData?.truncated && (
        <Callout
          tone="warning"
          description="케이스가 많아 일부만 캐시했어요(최대 20000). 월·팀 필터로 범위를 좁혀 주세요."
        />
      )}

      {loading && !casesData ? (
        <div className="flex items-center justify-center gap-2 py-16">
          <ProgressCircle size="24" />
          <Text textStyle="t4Regular" color="fg.neutralSubtle">
            불러오는 중…
          </Text>
        </div>
      ) : !tree.months.length ? (
        <p className="py-16 text-center text-[13px] text-[var(--fg-tertiary)]">조건에 맞는 데이터가 없어요</p>
      ) : (
        <div className="space-y-3">
          {tree.months.map((m) => (
            <DisclosureShell
              key={m.monthKey}
              defaultOpen
              depth={0}
              header={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex w-full flex-wrap items-center gap-3 bg-[var(--fg-primary)] px-4 py-3 text-left text-white hover:bg-[color-mix(in_srgb,var(--fg-primary)_92%,white)]"
                >
                  <Chevron open={open} light />
                  <div className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">{m.monthKey}</div>
                  <MemberStatsInline
                    caseCount={m.caseCount}
                    coldCount={m.coldCount}
                    notColdCount={m.notColdCount}
                    coldRate={m.coldRate}
                    light
                  />
                </button>
              )}
            >
              {m.teams.map((t) => (
                <DisclosureShell
                  key={t.teamKey}
                  defaultOpen={m.teams.length <= 3}
                  depth={1}
                  header={({ open, toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-[var(--fg-primary)] hover:bg-[var(--bg-subtle)]"
                    >
                      <Chevron open={open} />
                      <div className="min-w-0 flex-1 truncate text-[13px] font-bold">{t.teamLabel}</div>
                      <MemberStatsInline
                        caseCount={t.caseCount}
                        coldCount={t.coldCount}
                        notColdCount={t.notColdCount}
                        coldRate={t.coldRate}
                      />
                    </button>
                  )}
                >
                  <div className="space-y-2">
                    {t.members.map((mem) => (
                      <MemberDrilldown key={mem.memberKey} member={mem} />
                    ))}
                  </div>
                </DisclosureShell>
              ))}
            </DisclosureShell>
          ))}
        </div>
      )}
    </div>
  );
}

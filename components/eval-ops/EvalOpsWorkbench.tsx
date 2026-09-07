"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, PrefixIcon, Text } from "@seed-design/react";
import IconArrow2ClockwiseCircularLine from "@karrotmarket/react-monochrome-icon/IconArrow2ClockwiseCircularLine";
import { ActionButton } from "seed-design/ui/action-button";
import { Callout } from "seed-design/ui/callout";
import { ChipTabsList, ChipTabsRoot, ChipTabsTrigger } from "seed-design/ui/chip-tabs";
import { ProgressCircle } from "seed-design/ui/progress-circle";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { calendarMonthOf, nextDistSetId } from "@/lib/distSet";
import type { EvalOpsBootstrap } from "@/lib/evalOpsStore";
import { FilterSelect } from "@/components/results/ResultsShared";
import { latestHistoryForMonth, moveByDrag, recomputeAssignStats, runAssign, runFromHistory } from "@/lib/distAssign";
import type { DistDragPayload } from "@/lib/distAssign";
import AssignBoard from "@/components/eval-ops/AssignBoard";
import {
  buildGpdFromResult,
  channelMembers,
  fmtMin,
  formatMetric,
  getCS,
  getChannelColdAddMin,
  getChannelCsTotal,
  getChannelJobTotal,
  getChannelPerPersonMin,
  getChannelTotalMin,
  getCsModeLabel,
  getDiff,
  getJobTotal,
  isRegularCS,
  redistributeLockedRatios,
  rosterTeamCount,
  syncTeamsFromRoster,
} from "@/lib/distWorkload";
import type {
  DistAssignRun,
  DistCfg,
  DistGp,
  DistRosterPerson,
  DistTeam,
} from "@/lib/distTypes";

type TabId = "roster" | "workload" | "evaluators" | "assign" | "history";

const TABS: Array<{ id: TabId; label: string; fullOnly?: boolean }> = [
  { id: "roster", label: "대상자" },
  { id: "workload", label: "일감 · AQT", fullOnly: true },
  { id: "evaluators", label: "평가자", fullOnly: true },
  { id: "assign", label: "배분", fullOnly: true },
  { id: "history", label: "현황 · 이력", fullOnly: true },
];

const GP_COLORS = ["#FF6F0F", "#3182F6", "#16A34A", "#7C3AED", "#0EA5E9", "#DB2777", "#CA8A04"];
const ROSTER_COLS = "minmax(240px,1.7fr) 52px 92px 92px 88px minmax(140px,1.1fr) minmax(120px,0.9fr)";

function gpColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GP_COLORS[h % GP_COLORS.length];
}

function nextMonth(ym: string): string {
  const cal = calendarMonthOf(ym);
  if (!/^\d{4}-\d{2}$/.test(cal)) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const y = Number(cal.slice(0, 4));
  const m = Number(cal.slice(5, 7));
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function KindTag({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1 py-px text-[10px] font-semibold leading-4 text-[var(--fg-tertiary)]">
      {children}
    </span>
  );
}

function FlagBadge({
  text,
  tone,
}: {
  text: string;
  tone: "positive" | "critical" | "warning" | "neutral";
}) {
  if (!text) {
    return (
      <Badge size="medium" variant="outline" tone="neutral">
        —
      </Badge>
    );
  }
  return (
    <Badge size="medium" variant="weak" tone={tone}>
      {text}
    </Badge>
  );
}

function judgeTone(kind: string, label: string): "positive" | "critical" | "warning" | "neutral" {
  if (kind === "target" || label.includes("대상")) return "positive";
  if (kind === "excluded" || label.includes("제외")) return "critical";
  return "neutral";
}

function statusTone(status: string): "positive" | "critical" | "warning" | "neutral" {
  const s = status.trim();
  if (s === "재직") return "positive";
  if (s.includes("퇴사예정") || s.includes("예정")) return "warning";
  if (s.includes("퇴사")) return "critical";
  return "neutral";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2.5">
      <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">{label}</div>
      <div className="mt-0.5 text-[18px] font-bold tabular-nums text-[var(--fg-primary)]">{value}</div>
    </div>
  );
}

function lvClass(cls: string) {
  if (cls === "lv0") return "text-emerald-700";
  if (cls === "lv2") return "text-amber-600";
  if (cls === "lv3") return "text-orange-600";
  if (cls === "lv4") return "text-red-600";
  return "text-[var(--fg-secondary)]";
}

async function apiJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "요청 실패");
  return d;
}

export default function EvalOpsWorkbench() {
  const searchParams = useSearchParams();
  const [month, setMonth] = useState("");
  const [tab, setTab] = useState<TabId>("roster");
  const [newMonth, setNewMonth] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const confirmedDeepLink = searchParams.get("confirmed") === "1";
  const tabParam = (searchParams.get("tab") || "").trim() as TabId | "";

  const { data, error, loading, validating, refresh } = useCachedFetch<EvalOpsBootstrap & { ok: boolean }>({
    key: `evalOps:bootstrap:v4:${month || "latest"}`,
    fetcher: async () => {
      const sp = new URLSearchParams();
      if (month) sp.set("month", month);
      const r = await fetch(`/api/eval-ops/bootstrap?${sp}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "배분 데이터 로드 실패");
      return d;
    },
  });

  // URL 딥링크: tab · 확정 배분(마지막 확정 셋)
  useEffect(() => {
    if (TABS.some((t) => t.id === tabParam)) setTab(tabParam as TabId);
  }, [tabParam]);

  useEffect(() => {
    if (!confirmedDeepLink || !data?.latestConfirmedSetId) return;
    setMonth((cur) => (cur === data.latestConfirmedSetId ? cur : data.latestConfirmedSetId));
    if (!tabParam) setTab("assign");
  }, [confirmedDeepLink, data?.latestConfirmedSetId, tabParam]);

  const [teams, setTeams] = useState<DistTeam[]>([]);
  const [gps, setGps] = useState<DistGp[]>([]);
  const [aqtBase, setAqtBase] = useState<Record<string, number>>({});
  const [cfg, setCfg] = useState<DistCfg>({ days: 15, avail: 4, month: "" });
  const [dirty, setDirty] = useState(false);
  const [run, setRun] = useState<DistAssignRun | null>(null);
  const [teamFilter, setTeamFilter] = useState("");
  const [metric, setMetric] = useState<"count" | "time">("count");
  const [scope, setScope] = useState<"cs" | "total">("cs");

  const loadedMonth = data?.month ?? "";
  useEffect(() => {
    if (!data) return;
    setTeams(structuredClone(data.teams));
    setGps(structuredClone(data.evaluators));
    setAqtBase({ ...data.aqtBase });
    setCfg({ ...data.cfg });
    setDirty(false);
    setNewMonth((cur) => cur || nextMonth(data.months[0] || data.month));
    setCopyFrom((cur) => cur || data.latestConfirmedSetId || data.months[0] || "");
    const confirmed = latestHistoryForMonth(data.history, data.month);
    if (confirmed) {
      setRun(runFromHistory(confirmed, data.evaluators));
      setMetric(confirmed.metric);
      setScope(confirmed.scope);
    } else {
      setRun(null);
    }
    // 월이 바뀔 때만 플랜 로컬 상태를 리셋한다. 재검증이 입력 중인 값을 덮지 않게.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedMonth, !!data]);

  const full = data?.userLevel === "full";
  const locked = !!data?.locked;
  const visibleTabs = TABS.filter((t) => full || !t.fullOnly);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : "roster";
  const monthOptions = useMemo(
    () =>
      (data?.sets?.length ? data.sets.map((s) => ({ value: s.id, label: s.label })) : (data?.months ?? []).map((m) => ({ value: m, label: m }))),
    [data?.sets, data?.months],
  );
  const currentSet = data?.sets?.find((s) => s.id === data.month);
  const setConfirmed = !!currentSet?.confirmed || !!latestHistoryForMonth(data?.history ?? [], data?.month ?? "");
  const nextSetPreview = useMemo(() => {
    try {
      if (!newMonth) return "";
      return nextDistSetId(newMonth, data?.months ?? []);
    } catch {
      return "";
    }
  }, [newMonth, data?.months]);
  const roster = data?.roster ?? [];
  const teamNames = useMemo(() => Array.from(new Set(roster.map((r) => r.teamName).filter(Boolean))).sort(), [roster]);
  const shownRoster = teamFilter ? roster.filter((r) => r.teamName === teamFilter) : roster;
  const ratioSum = gps.filter((g) => g.cs).reduce((s, g) => s + g.ratio, 0);
  const mh = run ? buildGpdFromResult(gps, cfg, run.result) : [];

  const markPlan = (nextTeams: DistTeam[], nextGps = gps, nextAqt = aqtBase, nextCfg = cfg) => {
    setTeams(nextTeams);
    setGps(nextGps);
    setAqtBase(nextAqt);
    setCfg(nextCfg);
    setDirty(true);
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErrMsg("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const savePlan = () =>
    withBusy("설정 저장", async () => {
      await apiJson("/api/eval-ops/plan", {
        method: "PUT",
        body: JSON.stringify({ cfg: { ...cfg, month: data?.month }, teams, gps, aqtBase }),
      });
      setDirty(false);
      setNotice("팀·평가자·AQT 설정을 저장했어요.");
      await refresh();
    });

  const patchPerson = (p: DistRosterPerson, patch: Partial<Pick<DistRosterPerson, "manualJudge" | "memo" | "evalItems">>) =>
    withBusy("명단 저장", async () => {
      await apiJson("/api/eval-ops/targets", {
        method: "PATCH",
        body: JSON.stringify({
          month: data?.month,
          employeeId: p.employeeId,
          manual: patch.manualJudge ?? p.manualJudge,
          memo: patch.memo ?? p.memo,
          evalItems: patch.evalItems ?? p.evalItems,
        }),
      });
      await refresh();
    });

  return (
    <div className="qms-page-body mx-auto max-w-[1280px] space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Text as="p" textStyle="t2Bold" color="fg.neutralSubtle">
            평가 운영
          </Text>
          <Text as="h1" textStyle="t9Bold" color="fg.neutral">
            평가 배분
          </Text>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
            재직자 기본값 → 팀 확정 → AQT 일감 → 평가자 배분 → 확정 이력. 같은 평가월은
            <span className="font-mono">_verN</span> 평가 배분 셋으로 버전이 올라갑니다.
          </Text>
        </div>
        <ActionButton variant="neutralWeak" size="small" loading={validating} onClick={() => void refresh()}>
          <PrefixIcon svg={<IconArrow2ClockwiseCircularLine />} />
          새로고침
        </ActionButton>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="평가 배분 셋"
          value={month || data?.month || ""}
          onChange={setMonth}
          options={monthOptions}
          allLabel="최신 셋"
        />
        {data?.locked ? (
          <span className="mb-1 rounded-full bg-[var(--bg-muted)] px-2.5 py-1 text-[12px] font-semibold text-[var(--fg-secondary)]">
            셋 잠금{data.lockBy ? ` · ${data.lockBy}` : ""}
          </span>
        ) : null}
        {currentSet?.confirmed || setConfirmed ? (
          <span className="mb-1">
            <Badge size="medium" variant="weak" tone="positive">
              확정
            </Badge>
          </span>
        ) : null}
        {full ? (
          <>
            <label className="flex min-w-[120px] flex-col gap-1">
              <Text textStyle="t2Bold" color="fg.neutralSubtle">
                신규 평가월
              </Text>
              <input
                className="qms-input h-9 w-[120px] px-2.5 text-[13px]"
                value={newMonth}
                onChange={(e) => setNewMonth(e.target.value)}
                placeholder="2026-09"
              />
            </label>
            <FilterSelect
              label="복사할 셋"
              value={copyFrom || data?.latestConfirmedSetId || ""}
              onChange={setCopyFrom}
              options={(data?.sets ?? []).map((s) => ({ value: s.id, label: s.label }))}
              allLabel="최근 확정 셋"
              allowEmpty
            />
            <ActionButton
              variant="neutralSolid"
              size="small"
              loading={busy === "셋 생성"}
              disabled={!!busy}
              onClick={() =>
                void withBusy("셋 생성", async () => {
                  const res = await apiJson("/api/eval-ops/months", {
                    method: "POST",
                    body: JSON.stringify({
                      month: newMonth,
                      copyFrom: copyFrom || data?.latestConfirmedSetId || "",
                    }),
                  });
                  setMonth(res.month);
                  setNotice(
                    `${res.month} 평가 배분 셋을 만들었어요 (명단 ${res.count}명).` +
                      (res.copiedFrom ? ` ${res.copiedFrom}에서 대상자·일감·평가자 설정을 복사했습니다.` : ""),
                  );
                  await refresh();
                })
              }
            >
              셋 생성
            </ActionButton>
            {nextSetPreview ? (
              <span className="mb-1 text-[11px] text-[var(--fg-tertiary)]">생성 ID {nextSetPreview}</span>
            ) : null}
            <ActionButton
              variant="neutralWeak"
              size="small"
              loading={busy === "셋 삭제"}
              disabled={!!busy || !data?.month || setConfirmed}
              onClick={() =>
                void withBusy("셋 삭제", async () => {
                  if (!window.confirm(`${data?.month} 평가 배분 셋을 삭제할까요? 대상자 명단이 사라집니다.`)) return;
                  const res = await apiJson("/api/eval-ops/months", {
                    method: "DELETE",
                    body: JSON.stringify({ month: data?.month }),
                  });
                  setMonth("");
                  setNotice(`${res.month} 평가 배분 셋을 삭제했어요.`);
                  await refresh();
                })
              }
            >
              셋 삭제
            </ActionButton>
            <ActionButton
              variant="neutralWeak"
              size="small"
              loading={busy === "명단 새로고침"}
              disabled={!!busy || locked || !data?.month}
              onClick={() =>
                void withBusy("명단 새로고침", async () => {
                  const res = await apiJson("/api/eval-ops/months/sync", {
                    method: "POST",
                    body: JSON.stringify({ month: data?.month }),
                  });
                  setNotice(`${res.month} 명단을 재직자 기준으로 다시 채웠어요 (${res.count}명).`);
                  await refresh();
                })
              }
            >
              명단 동기화
            </ActionButton>
          </>
        ) : null}
      </div>

      {data?.copiedFromHint ? <Callout tone="informative" description={data.copiedFromHint} /> : null}
      {notice ? <Callout tone="positive" description={notice} /> : null}
      {errMsg || error ? (
        <Callout
          tone="critical"
          title="처리할 수 없었어요"
          description={errMsg || error || ""}
          linkProps={{ children: "다시 시도", onClick: () => void refresh() }}
        />
      ) : null}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-20">
          <ProgressCircle size="24" />
          <Text textStyle="t4Regular" color="fg.neutralSubtle">
            불러오는 중…
          </Text>
        </div>
      ) : null}

      {data ? (
        <>
          {data.source === "empty" ? (
            <Callout
              tone="warning"
              title="적재된 배분 데이터가 없어요"
              description="시트 → BQ 마이그레이션(`npm run migrate:dist-sheets`) 후 월을 생성하면 여기에 나타납니다."
            />
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="명단" value={data.rosterSummary.total.toLocaleString("ko-KR")} />
            <Stat label="평가 대상" value={data.rosterSummary.target.toLocaleString("ko-KR")} />
            <Stat label="제외" value={data.rosterSummary.excluded.toLocaleString("ko-KR")} />
            <Stat label="팀" value={data.rosterSummary.teamCount.toLocaleString("ko-KR")} />
          </div>

          <ChipTabsRoot
            value={activeTab}
            onValueChange={(v) => setTab(v as TabId)}
            variant="neutralSolid"
            size="medium"
          >
            <ChipTabsList>
              {visibleTabs.map((t) => (
                <ChipTabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </ChipTabsTrigger>
              ))}
            </ChipTabsList>
          </ChipTabsRoot>

          {activeTab === "roster" ? (
            <RosterPanel
              roster={shownRoster}
              allTeams={teamNames}
              teamFilter={teamFilter}
              onTeamFilter={setTeamFilter}
              confirmMap={data.confirmMap}
              options={data.evalItemsOptions}
              locked={locked}
              busy={!!busy}
              onPatch={patchPerson}
              onConfirmTeam={(team) =>
                void withBusy("팀 확정", async () => {
                  await apiJson("/api/eval-ops/targets/confirm-team", {
                    method: "POST",
                    body: JSON.stringify({ month: data.month, team }),
                  });
                  setNotice(`${team} 팀을 확정했어요.`);
                  await refresh();
                })
              }
              onLock={
                full
                  ? () =>
                      void withBusy("셋 잠금", async () => {
                        await apiJson("/api/eval-ops/months/lock", {
                          method: "POST",
                          body: JSON.stringify({ month: data.month }),
                        });
                        setNotice(`${data.month} 평가 배분 셋을 잠갔습니다.`);
                        await refresh();
                      })
                  : undefined
              }
            />
          ) : null}

          {activeTab === "workload" ? (
            <WorkloadPanel
              teams={teams}
              roster={roster}
              aqtBase={aqtBase}
              coldData={data.coldData}
              locked={locked}
              dirty={dirty}
              busy={busy}
              onChange={(next) => markPlan(next)}
              onAqt={(ch, minutes) => markPlan(teams, gps, { ...aqtBase, [ch]: minutes })}
              onApplyCounts={() => {
                const next = teams.map((t) => {
                  const c = rosterTeamCount(roster, t.name);
                  return c == null ? t : { ...t, ppl: c };
                });
                markPlan(syncTeamsFromRoster(next, roster, data.coldData, aqtBase));
                setNotice("명단 인원·채널을 일감에 반영했어요. 저장해야 유지됩니다.");
              }}
              onApplyCold={() => {
                const miss: string[] = [];
                const next = teams.map((t) => {
                  if (data.coldData[t.name] == null) {
                    miss.push(t.name);
                    return t;
                  }
                  return { ...t, cold: data.coldData[t.name].rate };
                });
                markPlan(next);
                setNotice(
                  `COLD%를 이전 3개월 비율로 채웠어요.` + (miss.length ? ` 없음: ${miss.join(", ")}` : ""),
                );
              }}
              onSave={() => void savePlan()}
            />
          ) : null}

          {activeTab === "evaluators" ? (
            <EvaluatorsPanel
              gps={gps}
              cfg={cfg}
              ratioSum={ratioSum}
              locked={locked}
              dirty={dirty}
              busy={busy}
              onGps={(next) => markPlan(teams, next)}
              onCfg={(next) => markPlan(teams, gps, aqtBase, next)}
              onSave={() => void savePlan()}
            />
          ) : null}

          {activeTab === "assign" ? (
            <AssignPanel
              run={run}
              mh={mh}
              gps={gps}
              locked={locked}
              readOnly={!!run?.confirmed}
              busy={busy}
              metric={metric}
              scope={scope}
              onMetric={setMetric}
              onScope={setScope}
              onRun={() =>
                void withBusy("배분 실행", async () => {
                  const out = runAssign({
                    month: data.month,
                    teams,
                    gps,
                    roster,
                    aqtBase,
                    history: data.history,
                    metric,
                    scope,
                  });
                  if (!out.ok) throw new Error(out.error);
                  setRun(out.run);
                  if (!out.run.withinRange) {
                    setNotice("±5%p를 완전히 만족하는 조합을 찾지 못해 가장 가까운 결과를 표시했어요.");
                  }
                })
              }
              onMove={(payload, to) => {
                if (!run || run.confirmed) return;
                setRun(
                  recomputeAssignStats({
                    ...run,
                    result: moveByDrag(run.result, payload, to),
                    manual: true,
                    confirmed: false,
                  }),
                );
              }}
              onConfirm={() =>
                void withBusy("배분 확정", async () => {
                  if (!run || run.confirmed) return;
                  const res = await apiJson("/api/eval-ops/assign/confirm", {
                    method: "POST",
                    body: JSON.stringify({ month: data.month, run, teams, gps, aqtBase, cfg }),
                  });
                  setRun({ ...run, confirmed: true });
                  setNotice(`배분을 확정했어요. 이력 ${res.id}`);
                  await refresh();
                })
              }
            />
          ) : null}

          {activeTab === "history" ? (
            <HistoryPanel history={data.history} month={data.month} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function judgeLabel(p: DistRosterPerson): string {
  if (p.judgeKind === "target") return "대상";
  if (p.judgeKind === "excluded") return "제외";
  return p.finalJudge || "미지정";
}

function RosterMemberCells({
  p,
  editing,
  options,
  locked,
  busy,
  onPatch,
  onEdit,
}: {
  p: DistRosterPerson;
  editing: boolean;
  options: string[];
  locked: boolean;
  busy: boolean;
  onPatch: (p: DistRosterPerson, patch: Partial<Pick<DistRosterPerson, "manualJudge" | "memo" | "evalItems">>) => void;
  onEdit: (id: string | null) => void;
}) {
  const label = judgeLabel(p);
  return (
    <>
      <Text as="span" textStyle="t4Medium" color="fg.neutral">
        {p.level || "—"}
      </Text>
      <FlagBadge text={p.status || "—"} tone={statusTone(p.status)} />
      <FlagBadge text={label} tone={judgeTone(p.judgeKind, label)} />
      <span onClick={(e) => e.stopPropagation()}>
        <select
          className="qms-select qms-select-compact"
          disabled={locked || busy}
          value={p.manualJudge === "대상" || p.manualJudge === "제외" ? p.manualJudge : ""}
          onChange={(e) => onPatch(p, { manualJudge: e.target.value })}
        >
          <option value="">자동</option>
          <option value="대상">대상</option>
          <option value="제외">제외</option>
        </select>
      </span>
      <span onClick={(e) => e.stopPropagation()}>
        {editing && !locked ? (
          <div className="space-y-1.5">
            <div className="flex max-w-[260px] flex-wrap gap-1">
              {options.map((o) => {
                const on = p.evalItems.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onPatch(p, {
                        evalItems: on ? p.evalItems.filter((x) => x !== o) : [...p.evalItems, o],
                      })
                    }
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      on
                        ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                        : "bg-[var(--bg-muted)] text-[var(--fg-tertiary)]"
                    }`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="text-[11px] font-semibold text-[var(--fg-tertiary)]"
              onClick={() => onEdit(null)}
            >
              닫기
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={locked || busy}
            onClick={() => onEdit(p.employeeId)}
            className="flex max-w-[220px] flex-wrap gap-1 text-left"
          >
            {p.evalItems.length ? (
              p.evalItems.map((o) => (
                <span
                  key={o}
                  className="rounded-full bg-[var(--brand-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]"
                >
                  {o}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-[var(--fg-tertiary)]">{locked ? "-" : "＋ 선택"}</span>
            )}
          </button>
        )}
      </span>
      <span onClick={(e) => e.stopPropagation()}>
        <input
          className="qms-input h-7 min-w-[100px] px-2 py-0 text-[12px]"
          defaultValue={p.memo}
          disabled={locked || busy}
          onBlur={(e) => {
            if (e.target.value !== p.memo) onPatch(p, { memo: e.target.value });
          }}
        />
      </span>
    </>
  );
}

function RosterPanel({
  roster,
  allTeams,
  teamFilter,
  onTeamFilter,
  confirmMap,
  options,
  locked,
  busy,
  onPatch,
  onConfirmTeam,
  onLock,
}: {
  roster: DistRosterPerson[];
  allTeams: string[];
  teamFilter: string;
  onTeamFilter: (v: string) => void;
  confirmMap: Record<string, { by: string; at: string }>;
  options: string[];
  locked: boolean;
  busy: boolean;
  onPatch: (p: DistRosterPerson, patch: Partial<Pick<DistRosterPerson, "manualJudge" | "memo" | "evalItems">>) => void;
  onConfirmTeam: (team: string) => void;
  onLock?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openTeams, setOpenTeams] = useState<Record<string, boolean>>({});
  const confirmed = teamFilter ? !!confirmMap[teamFilter] : false;
  const groups = useMemo(() => {
    const m = new Map<string, DistRosterPerson[]>();
    for (const p of roster) {
      const k = p.teamName || "(팀 없음)";
      const list = m.get(k);
      if (list) list.push(p);
      else m.set(k, [p]);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [roster]);

  return (
    <section className="space-y-3">
      <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
        재직자에서 채운 기본 판정입니다. 리더가 대상 여부·평가 항목을 고치고 팀을 확정하면, 성장문화팀이 셋을 잠급니다.
        평가항목은 그 사람이 맡은 채널만 표시됩니다.
      </Text>
      <div className="flex flex-wrap items-end gap-2">
        <FilterSelect
          label="팀"
          value={teamFilter}
          onChange={onTeamFilter}
          options={allTeams.map((t) => ({
            value: t,
            label: `${t}${confirmMap[t] ? " · 확정" : ""}`,
          }))}
          allLabel="전체 팀"
        />
        {teamFilter ? (
          <ActionButton
            size="small"
            variant="neutralSolid"
            disabled={locked || busy || confirmed}
            onClick={() => onConfirmTeam(teamFilter)}
          >
            {confirmed ? "팀 확정됨" : "이 팀 확정"}
          </ActionButton>
        ) : null}
        {onLock ? (
          <ActionButton size="small" variant="neutralWeak" disabled={locked || busy} onClick={onLock}>
            셋 잠금
          </ActionButton>
        ) : null}
      </div>
      <div className="overflow-auto rounded-[12px] border border-[var(--border-subtle)]">
        <div
          className="grid min-w-[960px] items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-[18px] py-2 text-[11px] font-semibold text-[var(--fg-tertiary)]"
          style={{ gridTemplateColumns: ROSTER_COLS }}
        >
          <span>이름</span>
          <span>레벨</span>
          <span>재직</span>
          <span>최종판정</span>
          <span>수동</span>
          <span>평가항목</span>
          <span>메모</span>
        </div>
        {groups.length ? (
          groups.map(([team, members]) => {
            const open = openTeams[team] !== false;
            const targetN = members.filter((p) => p.judgeKind === "target").length;
            const excludedN = members.length - targetN;
            const teamConfirmed = !!confirmMap[team];
            return (
              <div key={team}>
                <div
                  className="grid min-w-[960px] cursor-pointer items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-[18px] py-2 hover:bg-[var(--bg-muted)]"
                  style={{ gridTemplateColumns: ROSTER_COLS }}
                  onClick={() => setOpenTeams((prev) => ({ ...prev, [team]: !open }))}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="w-3 shrink-0 text-[11px] text-[var(--fg-tertiary)]">{open ? "▾" : "▸"}</span>
                    <KindTag>팀</KindTag>
                    <Text as="span" textStyle="t4Bold" color="fg.neutral" maxLines={1}>
                      {team}
                    </Text>
                    <Text as="span" textStyle="t2Regular" color="fg.neutralSubtle">
                      {members.length}명 · 대상 {targetN} · 제외 {excludedN}
                    </Text>
                    {teamConfirmed ? <FlagBadge text="확정" tone="positive" /> : null}
                  </span>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span className="justify-self-end" onClick={(e) => e.stopPropagation()}>
                    <ActionButton
                      size="small"
                      variant="neutralWeak"
                      disabled={locked || busy || teamConfirmed}
                      onClick={() => onConfirmTeam(team)}
                    >
                      {teamConfirmed ? "확정됨" : "팀 확정"}
                    </ActionButton>
                  </span>
                </div>
                {open
                  ? members.map((p) => (
                      <div
                        key={p.employeeId}
                        className="grid min-w-[960px] items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-[18px] py-2"
                        style={{ gridTemplateColumns: ROSTER_COLS }}
                      >
                        <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: 16 }}>
                          <span className="w-3 shrink-0" />
                          <KindTag>구성원</KindTag>
                          <span className="min-w-0">
                            <Text as="span" textStyle="t4Medium" color="fg.neutral" maxLines={1}>
                              {p.nameEn}
                            </Text>
                            <div className="text-[11px] text-[var(--fg-tertiary)]">{p.employeeId}</div>
                          </span>
                        </span>
                        <RosterMemberCells
                          p={p}
                          editing={editingId === p.employeeId}
                          options={options}
                          locked={locked}
                          busy={busy}
                          onPatch={onPatch}
                          onEdit={setEditingId}
                        />
                      </div>
                    ))
                  : null}
              </div>
            );
          })
        ) : (
          <div className="px-3 py-8 text-center text-[13px] text-[var(--fg-tertiary)]">이 셋의 대상자 명단이 없어요</div>
        )}
      </div>
    </section>
  );
}

function WorkloadPanel({
  teams,
  roster,
  aqtBase,
  coldData,
  locked,
  dirty,
  busy,
  onChange,
  onAqt,
  onApplyCounts,
  onApplyCold,
  onSave,
}: {
  teams: DistTeam[];
  roster: DistRosterPerson[];
  aqtBase: Record<string, number>;
  coldData: Record<string, { rate: number; cold: number; total: number }>;
  locked: boolean;
  dirty: boolean;
  busy: string;
  onChange: (teams: DistTeam[]) => void;
  onAqt: (ch: string, minutes: number) => void;
  onApplyCounts: () => void;
  onApplyCold: () => void;
  onSave: () => void;
}) {
  const patch = (i: number, fn: (t: DistTeam) => DistTeam) => {
    const next = teams.map((t, idx) => (idx === i ? fn(t) : t));
    onChange(next);
  };
  return (
    <section className="space-y-3">
      <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
        확정된 대상자를 채널 AQT×건수로 일감화합니다. COLD%는 평가월 직전 3개월 콜드 비율입니다. 건당 소요 = (AQT +
        COLD%/100×5) × 난이도.
      </Text>
      <div className="flex flex-wrap gap-2">
        <ActionButton size="small" variant="neutralWeak" disabled={locked || !!busy} onClick={onApplyCounts}>
          명단 인원 반영
        </ActionButton>
        <ActionButton size="small" variant="neutralWeak" disabled={locked || !!busy} onClick={onApplyCold}>
          COLD% 반영
        </ActionButton>
        <ActionButton size="small" variant="neutralSolid" disabled={locked || !!busy || !dirty} onClick={onSave} loading={busy === "설정 저장"}>
          설정 저장
        </ActionButton>
      </div>
      <div className="space-y-3">
        {teams.map((t, i) => {
          const rosterN = rosterTeamCount(roster, t.name);
          const csLabel = isRegularCS(t) ? `${getCS(roster, teams, t)}건` : getCsModeLabel(t.csMode);
          return (
            <div key={t.id || t.name} className="overflow-hidden rounded-[12px] border border-[var(--border-subtle)]">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2 bg-[var(--bg-canvas)] px-3 py-2.5">
                <label className="inline-flex items-center gap-1 text-[12px] font-semibold">
                  <input
                    type="checkbox"
                    checked={t.on}
                    disabled={locked}
                    onChange={(e) => patch(i, (x) => ({ ...x, on: e.target.checked }))}
                  />
                  ON
                </label>
                <strong className="min-w-[88px] text-[14px]">{t.name}</strong>
                <span className="text-[12px] tabular-nums text-[var(--fg-secondary)]">
                  인원 {t.ppl}명
                  {rosterN != null ? (
                    <span className={`ml-1 font-semibold ${rosterN === t.ppl ? "text-emerald-700" : "text-amber-700"}`}>
                      · 명단 {rosterN}
                    </span>
                  ) : null}
                </span>
                <span className="text-[12px] tabular-nums">
                  COLD {t.cold}%
                  {coldData[t.name] ? (
                    <span className="ml-1 text-[11px] text-[var(--fg-tertiary)]">
                      ({coldData[t.name].cold}/{coldData[t.name].total})
                    </span>
                  ) : null}
                </span>
                <label className="flex items-center gap-1 text-[12px]">
                  난이도
                  <input
                    type="number"
                    step="0.05"
                    min={0.5}
                    max={2}
                    className="qms-input h-8 w-16 px-2 text-[12px]"
                    disabled={locked}
                    value={t.difficulty}
                    onChange={(e) => patch(i, (x) => ({ ...x, difficulty: Number(e.target.value) || 1 }))}
                  />
                </label>
                <label className="flex items-center gap-1 text-[12px]">
                  CS모드
                  <select
                    className="qms-select h-8 px-2 text-[12px]"
                    disabled={locked}
                    value={t.csMode || "normal"}
                    onChange={(e) => patch(i, (x) => ({ ...x, csMode: e.target.value }))}
                  >
                    <option value="normal">정규</option>
                    <option value="eventOnly">발생시</option>
                    <option value="exclude">제외</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 text-[12px]">
                  직무 평가자
                  <input
                    className="qms-input h-8 w-[100px] px-2 text-[12px]"
                    disabled={locked}
                    value={t.gp}
                    onChange={(e) => patch(i, (x) => ({ ...x, gp: e.target.value }))}
                  />
                </label>
                <span className="text-[12px] tabular-nums text-[var(--fg-secondary)]">
                  직무 {getJobTotal(roster, teams, t)}건 · CS {csLabel}
                </span>
              </div>
              <div className="overflow-auto">
                <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="bg-[var(--bg-subtle)] text-[11px] font-semibold text-[var(--fg-tertiary)]">
                      <th className="px-3 py-1.5">ON</th>
                      <th className="px-3 py-1.5">채널</th>
                      <th className="px-3 py-1.5">대상 구성원</th>
                      <th className="px-3 py-1.5">AQT(분)</th>
                      <th className="px-3 py-1.5">직무 to-be</th>
                      <th className="px-3 py-1.5">CS to-be</th>
                      <th className="px-3 py-1.5">직무 합</th>
                      <th className="px-3 py-1.5">CS 합</th>
                      <th className="px-3 py-1.5">인당 소요</th>
                      <th className="px-3 py-1.5">총 소요</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.channels.map((c, ci) => {
                      const mems = channelMembers(roster, t.name, c.ch);
                      const con = c.on !== false;
                      const jobN = getChannelJobTotal(roster, teams, t, c);
                      const csN = getChannelCsTotal(roster, teams, t, c);
                      const coldEff = getChannelColdAddMin(t) * getDiff(t);
                      return (
                        <tr
                          key={`${t.id}-${c.ch}-${ci}`}
                          className="border-t border-[var(--border-subtle)]"
                          style={{ opacity: con ? 1 : 0.45 }}
                        >
                          <td className="px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={con}
                              disabled={locked}
                              onChange={() =>
                                patch(i, (x) => ({
                                  ...x,
                                  channels: x.channels.map((ch, j) => (j === ci ? { ...ch, on: !con } : ch)),
                                }))
                              }
                            />
                          </td>
                          <td className="px-3 py-1.5 font-medium">
                            {c.ch}
                            {c.note ? <em className="ml-1 not-italic text-[11px] text-amber-700">({c.note})</em> : null}
                            <div className="text-[10px] text-[var(--fg-tertiary)]">
                              COLD +{fmtMin(coldEff)}/건
                            </div>
                          </td>
                          <td className="max-w-[220px] px-3 py-1.5 text-[11px] leading-snug text-[var(--fg-secondary)]">
                            {mems.length
                              ? `${mems.length}명 · ${mems.map((p) => p.nameEn).join(", ")}`
                              : "명단 연동 인원 없음"}
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              className="qms-input h-7 w-16 px-2 text-[12px]"
                              disabled={locked}
                              value={c.aqt}
                              onChange={(e) =>
                                patch(i, (x) => ({
                                  ...x,
                                  channels: x.channels.map((ch, j) =>
                                    j === ci ? { ...ch, aqt: Number(e.target.value) || 0 } : ch,
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              className="qms-input h-7 w-16 px-2 text-[12px]"
                              disabled={locked}
                              value={c.jobBe}
                              onChange={(e) =>
                                patch(i, (x) => ({
                                  ...x,
                                  channels: x.channels.map((ch, j) =>
                                    j === ci ? { ...ch, jobBe: Number(e.target.value) || 0 } : ch,
                                  ),
                                }))
                              }
                            />
                            <div className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">합 {jobN}건</div>
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              className="qms-input h-7 w-16 px-2 text-[12px]"
                              disabled={locked}
                              value={c.csBe}
                              onChange={(e) =>
                                patch(i, (x) => ({
                                  ...x,
                                  channels: x.channels.map((ch, j) =>
                                    j === ci ? { ...ch, csBe: Number(e.target.value) || 0 } : ch,
                                  ),
                                }))
                              }
                            />
                            <div className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">합 {csN}건</div>
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">{jobN}건</td>
                          <td className="px-3 py-1.5 tabular-nums">{csN}건</td>
                          <td className="px-3 py-1.5 tabular-nums font-semibold">
                            {fmtMin(getChannelPerPersonMin(t, c, aqtBase))}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums font-semibold">
                            {fmtMin(getChannelTotalMin(roster, teams, t, c, aqtBase))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      <div className="overflow-auto rounded-[12px] border border-[var(--border-subtle)]">
        <table className="w-full max-w-md border-collapse text-left text-[13px]">
          <thead>
            <tr className="bg-[var(--bg-subtle)] text-[11px] font-semibold text-[var(--fg-tertiary)]">
              <th className="px-3 py-2">채널</th>
              <th className="px-3 py-2">기준 AQT(분)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(aqtBase).map(([ch, minutes]) => (
              <tr key={ch} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2">{ch}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="qms-input h-8 w-20 px-2 text-[12px]"
                    disabled={locked}
                    value={minutes}
                    onChange={(e) => onAqt(ch, Number(e.target.value) || 0)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvaluatorsPanel({
  gps,
  cfg,
  ratioSum,
  locked,
  dirty,
  busy,
  onGps,
  onCfg,
  onSave,
}: {
  gps: DistGp[];
  cfg: DistCfg;
  ratioSum: number;
  locked: boolean;
  dirty: boolean;
  busy: string;
  onGps: (gps: DistGp[]) => void;
  onCfg: (cfg: DistCfg) => void;
  onSave: () => void;
}) {
  const [slackOptions, setSlackOptions] = useState<Array<{ email: string; label: string }>>([]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/eval-ops/evaluator-options");
        const d = await r.json();
        if (!r.ok) return;
        setSlackOptions(
          (d.users ?? []).map((u: { email: string; displayName?: string; realName?: string }) => ({
            email: u.email,
            label: u.displayName || u.realName || u.email,
          })),
        );
      } catch {
        /* optional */
      }
    })();
  }, []);

  return (
    <section className="space-y-3">
      <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
        평가자(GP)의 일 가용 시간, 버퍼, CS 참여, 배분 비율입니다. 비율 합은 100%여야 하고, 고정 인원은 슬라이더에서
        빠집니다.
      </Text>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12px]">
          <span className="font-semibold text-[var(--fg-tertiary)]">근무일</span>
          <input
            type="number"
            className="qms-input h-8 w-20 px-2"
            disabled={locked}
            value={cfg.days}
            onChange={(e) => onCfg({ ...cfg, days: Number(e.target.value) || 15 })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px]">
          <span className="font-semibold text-[var(--fg-tertiary)]">기본 가용 h</span>
          <input
            type="number"
            className="qms-input h-8 w-20 px-2"
            disabled={locked}
            value={cfg.avail}
            onChange={(e) => onCfg({ ...cfg, avail: Number(e.target.value) || 4 })}
          />
        </label>
        <ActionButton size="small" variant="neutralSolid" disabled={locked || !!busy || !dirty} onClick={onSave} loading={busy === "설정 저장"}>
          설정 저장
        </ActionButton>
      </div>
      <div className="overflow-auto rounded-[12px] border border-[var(--border-subtle)]">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="bg-[var(--bg-subtle)] text-[11px] font-semibold text-[var(--fg-tertiary)]">
              <th className="px-3 py-2">평가자</th>
              <th className="px-3 py-2">이메일</th>
              <th className="px-3 py-2">일 가용(h)</th>
              <th className="px-3 py-2">버퍼%</th>
              <th className="px-3 py-2">CS</th>
              <th className="px-3 py-2">비율%</th>
              <th className="px-3 py-2">고정</th>
            </tr>
          </thead>
          <tbody>
            {gps.map((g, i) => (
              <tr key={g.name} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2 font-medium">{g.name}</td>
                <td className="px-3 py-2">
                  {slackOptions.length ? (
                    <select
                      className="qms-input h-8 max-w-[220px] px-2 text-[12px]"
                      disabled={locked}
                      value={g.email ?? ""}
                      onChange={(e) =>
                        onGps(gps.map((x, j) => (j === i ? { ...x, email: e.target.value || undefined } : x)))
                      }
                    >
                      <option value="">— 이메일 선택 —</option>
                      {slackOptions.map((o) => (
                        <option key={o.email} value={o.email}>
                          {o.label} ({o.email})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="email"
                      className="qms-input h-8 max-w-[220px] px-2 text-[12px]"
                      disabled={locked}
                      placeholder="이메일"
                      value={g.email ?? ""}
                      onChange={(e) =>
                        onGps(gps.map((x, j) => (j === i ? { ...x, email: e.target.value || undefined } : x)))
                      }
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.5"
                    className="qms-input h-8 w-16 px-2"
                    disabled={locked}
                    value={g.avail}
                    onChange={(e) => onGps(gps.map((x, j) => (j === i ? { ...x, avail: Number(e.target.value) || 0 } : x)))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="qms-input h-8 w-16 px-2"
                    disabled={locked}
                    value={g.buffer}
                    onChange={(e) => onGps(gps.map((x, j) => (j === i ? { ...x, buffer: Number(e.target.value) || 0 } : x)))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={g.cs}
                    disabled={locked}
                    onChange={(e) =>
                      onGps(gps.map((x, j) => (j === i ? { ...x, cs: e.target.checked, ratio: e.target.checked ? x.ratio : 0 } : x)))
                    }
                  />
                </td>
                <td className="px-3 py-2">{g.ratio}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={locked || !g.cs}
                    className="qms-btn-ghost h-8 px-2 text-[11px]"
                    onClick={() => onGps(gps.map((x, j) => (j === i ? { ...x, locked: !x.locked } : x)))}
                  >
                    {g.locked ? "고정" : "조정"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 rounded-[12px] border border-[var(--border-subtle)] p-3">
        {gps
          .map((g, i) => ({ g, i }))
          .filter(({ g }) => g.cs)
          .map(({ g, i }) => (
            <div key={g.name} className="flex items-center gap-2">
              <span className="w-20 text-[12px] font-bold" style={{ color: gpColor(g.name) }}>
                {g.name}
              </span>
              <input
                type="range"
                min={0}
                max={80}
                value={g.ratio}
                disabled={locked || g.locked}
                className="flex-1"
                onChange={(e) => onGps(redistributeLockedRatios(gps, i, Number(e.target.value)))}
              />
              <span className="w-10 text-right text-[13px] font-bold">{g.ratio}%</span>
            </div>
          ))}
        <div className={`text-[13px] font-semibold ${ratioSum === 100 ? "text-emerald-700" : "text-red-600"}`}>
          합계 {ratioSum}% {ratioSum === 100 ? "정상" : "← 100%가 되어야 합니다"}
        </div>
      </div>
    </section>
  );
}

function AssignPanel({
  run,
  mh,
  gps,
  locked,
  readOnly,
  busy,
  metric,
  scope,
  onMetric,
  onScope,
  onRun,
  onMove,
  onConfirm,
}: {
  run: DistAssignRun | null;
  mh: ReturnType<typeof buildGpdFromResult>;
  gps: DistGp[];
  locked: boolean;
  readOnly: boolean;
  busy: string;
  metric: "count" | "time";
  scope: "cs" | "total";
  onMetric: (v: "count" | "time") => void;
  onScope: (v: "cs" | "total") => void;
  onRun: () => void;
  onMove: (payload: DistDragPayload, toGp: string) => void;
  onConfirm: () => void;
}) {
  const frozen = readOnly || !!run?.confirmed;
  return (
    <section className="space-y-3">
      <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
        {frozen
          ? "이 평가 배분 셋은 배분이 확정되어 있어요. 그래프와 배정 트리는 조회만 가능합니다."
          : "일감을 평가자에게 자동 배분한 뒤, 팀 → 채널 → 구성원을 펼쳐 다른 평가자 칸으로 드래그해 조정합니다. 막대는 전체 합=100%입니다."}
      </Text>
      {frozen ? (
        <Callout tone="informative" description="확정된 배분 결과입니다. 실행·드래그·재확정은 할 수 없어요." />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="qms-select h-9 w-auto min-w-[140px] px-2.5 text-[13px]"
          value={metric}
          disabled={frozen}
          onChange={(e) => onMetric(e.target.value as "count" | "time")}
        >
          <option value="count">건수</option>
          <option value="time">시간(AQT×건수)</option>
        </select>
        <select
          className="qms-select h-9 w-auto min-w-[120px] px-2.5 text-[13px]"
          value={scope}
          disabled={frozen}
          onChange={(e) => onScope(e.target.value as "cs" | "total")}
        >
          <option value="cs">CS만</option>
          <option value="total">CS+직무</option>
        </select>
        {!frozen ? (
          <ActionButton size="small" variant="neutralSolid" disabled={!!busy} loading={busy === "배분 실행"} onClick={onRun}>
            배분 실행
          </ActionButton>
        ) : null}
        {run && !run.confirmed ? (
          <ActionButton size="small" disabled={locked || !!busy} loading={busy === "배분 확정"} onClick={onConfirm}>
            이 배분안 확정
          </ActionButton>
        ) : null}
      </div>
      {!run ? (
        <p className="py-10 text-center text-[13px] text-[var(--fg-tertiary)]">배분 실행을 눌러주세요</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-[12px] text-[var(--fg-secondary)]">
            <span className="qms-chip">{run.month}</span>
            <span>
              CS {run.tCS}건 · 풀 {formatMetric(run.pool, run.metric)} · {run.withinRange ? "±5%p 충족" : "±5%p 미충족"}
              {run.manual ? " · 수동조정" : ""}
              {run.confirmed ? " · 확정됨" : ""}
            </span>
            <span>
              로테이션: {run.prevMonth ? `전월 ${run.prevMonth} 동일 조합 ${run.repeats}건` : "확정 이력 없어 자유 배분"}
            </span>
          </div>
          <AssignBoard run={run} gps={gps} frozen={frozen} onMove={onMove} />
          <div className="overflow-auto rounded-[12px] border border-[var(--border-subtle)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)] text-[11px] font-semibold text-[var(--fg-tertiary)]">
                  <th className="px-3 py-2">평가자</th>
                  <th className="px-3 py-2">팀</th>
                  <th className="px-3 py-2">CS</th>
                  <th className="px-3 py-2">직무</th>
                  <th className="px-3 py-2">일 투입</th>
                  <th className="px-3 py-2">적정</th>
                  <th className="px-3 py-2">부하</th>
                </tr>
              </thead>
              <tbody>
                {mh.map((r) => (
                  <tr key={r.name} className="border-t border-[var(--border-subtle)]">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-[12px]">{r.teamLabel}</td>
                    <td className="px-3 py-2 tabular-nums">{r.csCount}</td>
                    <td className="px-3 py-2 tabular-nums">{r.direct}</td>
                    <td className="px-3 py-2 tabular-nums">{r.perDay.toFixed(1)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.opt}</td>
                    <td className={`px-3 py-2 font-semibold ${lvClass(r.lv.cls)}`}>{r.lv.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function HistoryPanel({
  history,
  month,
}: {
  history: EvalOpsBootstrap["history"];
  month: string;
}) {
  const latest = history.filter((h) => h.evalMonth === month).slice(-1)[0];
  return (
    <section className="space-y-3">
      <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
        확정된 배분은 해당 평가 배분 셋의 배분 탭에서 그래프·트리로 조회할 수 있고, 수정은 할 수 없습니다.
      </Text>
      {latest ? (
        <Callout
          tone="informative"
          description={`${month} 최신 확정 ${latest.historyId || ""} · ${latest.confirmedBy} · CS ${latest.totalCs}건`}
        />
      ) : (
        <Callout tone="warning" description={`${month}에 확정된 배분이 아직 없어요.`} />
      )}
      <div className="space-y-3">
        {history.length ? (
          [...history].reverse().map((h) => (
            <div key={h.historyId || `${h.evalMonth}-${h.confirmedAt}`} className="rounded-[12px] border border-[var(--border-subtle)] p-3">
              <div className="mb-2 flex flex-wrap gap-2 text-[13px]">
                <strong>{h.historyId || h.evalMonth}</strong>
                <span className="text-[var(--fg-secondary)]">
                  {h.evalMonth} · {h.confirmedBy} · {h.confirmedAt} · CS {h.totalCs}건 · 전월중복 {h.repeats}건
                </span>
              </div>
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="text-[11px] text-[var(--fg-tertiary)]">
                    <th className="py-1">평가자</th>
                    <th className="py-1">팀</th>
                    <th className="py-1">CS</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(h.result || {}).map((gn) => {
                    const items = (h.result[gn] || []).filter((u) => u.kind !== "job");
                    const sum = items.reduce((s, u) => s + (+u.cs || 0), 0);
                    const teams = Array.from(new Set(items.map((u) => u.teamName))).join(", ");
                    return (
                      <tr key={gn} className="border-t border-[var(--border-subtle)]">
                        <td className="py-1 font-medium">{gn}</td>
                        <td className="py-1">{teams || "-"}</td>
                        <td className="py-1 tabular-nums">{sum}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-[13px] text-[var(--fg-tertiary)]">확정 이력이 없어요</p>
        )}
      </div>
    </section>
  );
}

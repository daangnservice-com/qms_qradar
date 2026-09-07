"use client";

import { useMemo, useState } from "react";
import { Badge, Text } from "@seed-design/react";
import type { DistAssignRun, DistAssignUnit, DistGp } from "@/lib/distTypes";
import {
  type DistDragPayload,
  gpMetricShares,
  sumUnitsMetric,
  uniqueMemberCount,
  visibleAssignUnits,
} from "@/lib/distAssign";
import { formatMetric, formatMetricKo } from "@/lib/distWorkload";

function gpHue(name: string) {
  const colors = ["#FF6F0F", "#3182F6", "#16A34A", "#7C3AED", "#0EA5E9", "#DB2777", "#CA8A04"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function KindBadge({ kind }: { kind: "cs" | "job" }) {
  return (
    <Badge size="medium" variant="weak" tone={kind === "cs" ? "brand" : "neutral"}>
      {kind === "cs" ? "CS" : "직무"}
    </Badge>
  );
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function groupByTeamChannel(units: DistAssignUnit[]) {
  const teams = new Map<string, Map<string, DistAssignUnit[]>>();
  for (const u of units) {
    const tn = u.teamName || "(팀 없음)";
    const ch = u.ch || "(채널 없음)";
    if (!teams.has(tn)) teams.set(tn, new Map());
    const chs = teams.get(tn)!;
    if (!chs.has(ch)) chs.set(ch, []);
    chs.get(ch)!.push(u);
  }
  return Array.from(teams.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([teamName, chs]) => ({
      teamName,
      units: Array.from(chs.values()).flat(),
      channels: Array.from(chs.entries())
        .sort((a, b) => a[0].localeCompare(b[0], "ko"))
        .map(([ch, list]) => ({ ch, units: list })),
    }));
}

function TreeRow({
  depth,
  open,
  canToggle,
  canDrag,
  frozen,
  payload,
  label,
  extra,
  kind,
  onToggle,
}: {
  depth: number;
  open?: boolean;
  canToggle?: boolean;
  canDrag: boolean;
  frozen: boolean;
  payload: DistDragPayload;
  label: string;
  extra: string;
  kind?: "cs" | "job";
  onToggle?: () => void;
}) {
  return (
    <div
      draggable={canDrag && !frozen}
      onDragStart={(e) => {
        if (frozen) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/json", JSON.stringify(payload));
        e.dataTransfer.setData("text/plain", JSON.stringify(payload));
        (e.currentTarget as HTMLElement).classList.add("opacity-40");
      }}
      onDragEnd={(e) => (e.currentTarget as HTMLElement).classList.remove("opacity-40")}
      className={`flex items-center gap-1.5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1.5 text-[12px] ${
        canDrag && !frozen ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{ marginLeft: depth * 12 }}
    >
      {canToggle ? (
        <button
          type="button"
          className="w-3 shrink-0 text-[11px] text-[var(--fg-tertiary)]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
        >
          {open ? "▾" : "▸"}
        </button>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      {kind ? <KindBadge kind={kind} /> : null}
      <span className="min-w-0 truncate font-medium">{label}</span>
      <span className="ml-auto shrink-0 text-[11px] text-[var(--fg-tertiary)]">{extra}</span>
    </div>
  );
}

function EvaluatorTree({
  gpName,
  units,
  metric,
  frozen,
  open,
  onToggle,
}: {
  gpName: string;
  units: DistAssignUnit[];
  metric: DistAssignRun["metric"];
  frozen: boolean;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const groups = useMemo(() => groupByTeamChannel(units), [units]);
  return (
    <div className="space-y-1">
      {groups.length ? (
        groups.map((g) => {
          const tKey = `${gpName}|${g.teamName}`;
          const tOpen = !!open[tKey];
          return (
            <div key={g.teamName} className="space-y-1">
              <TreeRow
                depth={0}
                open={tOpen}
                canToggle
                canDrag
                frozen={frozen}
                payload={{ fromGp: gpName, level: "team", teamName: g.teamName }}
                label={g.teamName}
                extra={`${formatMetric(sumUnitsMetric(g.units, metric), metric)} · ${uniqueMemberCount(g.units)}명`}
                onToggle={() => onToggle(tKey)}
              />
              {tOpen
                ? g.channels.map((c) => {
                    const cKey = `${tKey}|${c.ch}`;
                    const cOpen = !!open[cKey];
                    const kinds = (["cs", "job"] as const)
                      .map((kind) => ({ kind, list: c.units.filter((u) => u.kind === kind) }))
                      .filter((x) => x.list.length);
                    return (
                      <div key={c.ch} className="space-y-1">
                        <TreeRow
                          depth={1}
                          open={cOpen}
                          canToggle
                          canDrag
                          frozen={frozen}
                          payload={{ fromGp: gpName, level: "channel", teamName: g.teamName, ch: c.ch }}
                          label={c.ch}
                          extra={`${formatMetric(sumUnitsMetric(c.units, metric), metric)} · ${uniqueMemberCount(c.units)}명`}
                          onToggle={() => onToggle(cKey)}
                        />
                        {cOpen
                          ? kinds.flatMap(({ kind, list }) =>
                              list.map((u, i) => (
                                <TreeRow
                                  key={`${u.memberId || u.memberName || i}-${kind}`}
                                  depth={2}
                                  canDrag
                                  frozen={frozen}
                                  payload={{
                                    fromGp: gpName,
                                    level: "member",
                                    kind,
                                    teamName: g.teamName,
                                    ch: c.ch,
                                    memberId: u.memberId || "",
                                  }}
                                  kind={kind}
                                  label={u.memberName || u.memberId || "구성원"}
                                  extra={formatMetric(sumUnitsMetric([u], metric), metric)}
                                />
                              )),
                            )
                          : null}
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })
      ) : (
        <p className="px-2 py-4 text-center text-[11px] text-[var(--fg-tertiary)]">
          {frozen ? "배정 없음" : "비어 있음 · 여기에 드롭"}
        </p>
      )}
    </div>
  );
}

export default function AssignBoard({
  run,
  gps,
  frozen,
  onMove,
}: {
  run: DistAssignRun;
  gps: DistGp[];
  frozen: boolean;
  onMove: (payload: DistDragPayload, toGp: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [overGp, setOverGp] = useState("");
  const metric = run.metric;
  const { byGp, grand } = useMemo(() => gpMetricShares(run.result, metric), [run.result, metric]);
  const names = useMemo(() => {
    const order: string[] = [];
    const seen: Record<string, true> = {};
    for (const g of gps) {
      if (!seen[g.name]) {
        seen[g.name] = true;
        order.push(g.name);
      }
    }
    for (const gn of Object.keys(run.result || {})) {
      if (!seen[gn]) {
        seen[gn] = true;
        order.push(gn);
      }
    }
    return order;
  }, [gps, run.result]);

  const barBase = grand || 1;

  return (
    <div className="space-y-2">
      <Text as="p" textStyle="t2Regular" color="fg.neutralMuted">
        막대 축은 전체 합 {formatMetricKo(barBase, metric)} = 100%입니다. 직무/CS 비중과 평가자 점유율이 수동 이동 후에도
        같이 바뀝니다.
      </Text>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {names.map((gn) => {
          const items = visibleAssignUnits(run.result[gn]);
          const share = byGp[gn] || { jobW: 0, csW: 0, totW: 0 };
          const jp = pct(share.jobW, barBase);
          const cp = pct(share.csW, barBase);
          const sharePct = pct(share.totW, barBase);
          const ratioGp = (run.cgps || []).find((g) => g.name === gn);
          const scoreW = run.scope === "cs" ? share.csW : share.totW;
          const vsPool = run.pool ? Math.round((scoreW / run.pool) * 100) : 0;
          return (
            <div
              key={gn}
              className={`flex min-h-[180px] flex-col rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] ${
                overGp === gn ? "outline outline-2 outline-[var(--brand)]" : ""
              }`}
              onDragOver={(e) => {
                if (frozen) return;
                e.preventDefault();
                setOverGp(gn);
              }}
              onDragLeave={() => setOverGp((cur) => (cur === gn ? "" : cur))}
              onDrop={(e) => {
                if (frozen) return;
                e.preventDefault();
                setOverGp("");
                const raw = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
                if (!raw) return;
                const payload = JSON.parse(raw) as DistDragPayload;
                if (payload.fromGp && payload.fromGp !== gn) onMove(payload, gn);
              }}
            >
              <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <strong style={{ color: gpHue(gn) }}>{gn}</strong>
                  <span className="text-[11px] text-[var(--fg-tertiary)]">{sharePct}%</span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-[var(--fg-secondary)]">
                  직무 {formatMetricKo(share.jobW, metric)} / CS {formatMetricKo(share.csW, metric)} 도합{" "}
                  {formatMetricKo(share.totW, metric)} ({sharePct}%)
                </p>
                {ratioGp ? (
                  <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
                    배정 {vsPool}% · 목표 {ratioGp.ratio}%
                  </p>
                ) : null}
                <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]" aria-hidden>
                  <div className="flex h-full w-full">
                    <div className="h-full bg-[var(--fg-tertiary)]" style={{ width: `${jp}%` }} title={`직무 ${jp}%`} />
                    <div className="h-full bg-[var(--brand)]" style={{ width: `${cp}%` }} title={`CS ${cp}%`} />
                  </div>
                </div>
                <div className="mt-1 flex gap-3 text-[10px] text-[var(--fg-tertiary)]">
                  <span>
                    <i className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[var(--fg-tertiary)]" />
                    직무 {formatMetricKo(share.jobW, metric)}
                  </span>
                  <span>
                    <i className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[var(--brand)]" />
                    CS {formatMetricKo(share.csW, metric)}
                  </span>
                </div>
              </div>
              <div className="flex-1 p-2">
                <EvaluatorTree
                  gpName={gn}
                  units={items}
                  metric={metric}
                  frozen={frozen}
                  open={open}
                  onToggle={(key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

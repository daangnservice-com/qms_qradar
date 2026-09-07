"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrefixIcon, Text } from "@seed-design/react";
import IconArrow2ClockwiseCircularLine from "@karrotmarket/react-monochrome-icon/IconArrow2ClockwiseCircularLine";
import IconArrowDownHorizlineLine from "@karrotmarket/react-monochrome-icon/IconArrowDownHorizlineLine";
import IconExclamationmarkTriangleFill from "@karrotmarket/react-monochrome-icon/IconExclamationmarkTriangleFill";
import { ActionButton } from "seed-design/ui/action-button";
import { Callout } from "seed-design/ui/callout";
import { Chip } from "seed-design/ui/chip";
import { ChipTabsList, ChipTabsRoot, ChipTabsTrigger } from "seed-design/ui/chip-tabs";
import { ActionablePageBanner } from "seed-design/ui/page-banner";
import { ProgressCircle } from "seed-design/ui/progress-circle";
import { useCachedFetch } from "@/lib/useCachedFetch";
import type {
  ReportRateCell,
  ResultsReportRange,
  ResultsReportResponse,
  UnconfirmedCurrentMonth,
} from "@/lib/resultsStore";
import { FilterSelect, pct } from "./ResultsShared";

type ReportRes = { ok: boolean } & ResultsReportResponse;

type ViewId = "summary" | "trend" | "byOrg" | "bySheet" | "byMonth";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "summary", label: "요약" },
  { id: "trend", label: "추이" },
  { id: "byOrg", label: "조직별" },
  { id: "bySheet", label: "평가표별" },
  { id: "byMonth", label: "월별" },
];

const RANGES: Array<{ id: ResultsReportRange; label: string }> = [
  { id: "3m", label: "최근 3개월" },
  { id: "6m", label: "최근 6개월" },
  { id: "12m", label: "최근 12개월" },
  { id: "all", label: "전체 기간" },
];

function StatCard({
  label,
  value,
  unit,
  caption,
  delta,
}: {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  delta?: { text: string; up: boolean } | null;
}) {
  const long = value.length > 18;
  return (
    <div className="flex h-full flex-col rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2">
      <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-0.5">
        <span
          className={`font-bold tabular-nums text-[var(--fg-primary)] ${long ? "text-[13px] leading-snug" : "text-[18px] leading-none"}`}
        >
          {value}
        </span>
        {unit ? <span className="text-[12px] font-bold text-[var(--fg-tertiary)]">{unit}</span> : null}
      </div>
      {delta ? (
        <div className={`mt-0.5 text-[11px] font-bold ${delta.up ? "text-[var(--accent-fg)]" : "text-[var(--danger)]"}`}>
          {delta.text}
        </div>
      ) : null}
      {caption ? <div className="mt-0.5 text-[11px] leading-snug text-[var(--fg-tertiary)]">{caption}</div> : null}
    </div>
  );
}

/** 비율 + 건수/인원을 크게 병기 */
function RateCountCard({
  label,
  rate,
  count,
  countUnit,
}: {
  label: string;
  rate: number;
  count: number;
  countUnit: "명" | "건";
}) {
  return (
    <div className="flex h-full flex-col rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2">
      <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 gap-y-0">
        <span className="text-[18px] font-bold leading-none tabular-nums text-[var(--fg-primary)]">
          {(rate * 100).toFixed(1)}
        </span>
        <span className="text-[12px] font-bold text-[var(--fg-tertiary)]">%</span>
        <span className="text-[13px] font-bold text-[var(--fg-tertiary)]">/</span>
        <span className="text-[18px] font-bold leading-none tabular-nums text-[var(--fg-primary)]">
          {count.toLocaleString("ko-KR")}
        </span>
        <span className="text-[12px] font-bold text-[var(--fg-tertiary)]">{countUnit}</span>
      </div>
    </div>
  );
}

function ScoreSection({
  title,
  sub,
  children,
  tone = "period",
  className = "",
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  tone?: "period" | "latest";
  className?: string;
}) {
  const wrap =
    tone === "period"
      ? "rounded-[14px] border border-[var(--seed-color-stroke-brand-weak,var(--c-carrot-100))] bg-[var(--seed-color-bg-brand-weak,var(--brand-subtle))] p-3"
      : "rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 shadow-[var(--shadow-1,0_1px_2px_rgba(0,0,0,.04))]";
  return (
    <section className={`flex h-full flex-col ${wrap} ${className}`.trim()}>
      <div className="mb-2 flex min-h-[20px] flex-wrap items-baseline gap-1.5">
        <div className="text-[14px] font-bold text-[var(--fg-primary)]">{title}</div>
        {sub ? <span className="text-[11px] text-[var(--fg-tertiary)]">{sub}</span> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function ScoreRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 h-4 text-[11px] font-semibold leading-4 text-[var(--fg-tertiary)]">{label}</div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-1.5">{children}</div>
    </div>
  );
}

function Panel({
  title,
  sub,
  children,
  footer,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  footer?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl,16px)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] shadow-[var(--shadow-1,0_1px_2px_rgba(0,0,0,.04))]">
      <div className="flex flex-wrap items-center gap-2.5 px-[18px] pb-2.5 pt-[15px]">
        <div className="text-[15px] font-bold text-[var(--fg-primary)]">{title}</div>
        {sub ? <span className="text-[12px] text-[var(--fg-tertiary)]">{sub}</span> : null}
      </div>
      {children}
      {footer ? (
        <div className="border-t border-[var(--border-subtle)] px-[18px] py-3 text-[12px] leading-relaxed text-[var(--fg-tertiary)]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function UnconfirmedLink({ data }: { data: UnconfirmedCurrentMonth }) {
  const router = useRouter();
  const hasOpen = data.openEvalCount + data.openTargetCount + data.openCaseCount > 0;
  if (!data.month || !hasOpen) return null;
  return (
    <div className="mb-3.5">
      <ActionablePageBanner
        tone="warning"
        variant="weak"
        prefixIcon={<IconExclamationmarkTriangleFill />}
        title="미확정 평가표 존재"
        description={`${data.month} · 회차 ${data.openEvalCount}/${data.evalCount} · 대상자 ${data.openTargetCount}/${data.targetCount} · 케이스 ${data.openCaseCount}/${data.caseCount}`}
        onClick={() => router.push(`/results/status?month=${encodeURIComponent(data.month)}`)}
      />
    </div>
  );
}

function RateTooltipBody({
  cell,
  title,
}: {
  cell: ReportRateCell;
  title?: string;
}) {
  return (
    <>
      {title ? <div className="mb-1 font-bold text-[var(--fg-primary)]">{title}</div> : null}
      <div>전체 인원 {cell.people.toLocaleString("ko-KR")}명</div>
      <div>
        {`Hot ${cell.hotPeople.toLocaleString("ko-KR")}명 Cold ${cell.coldPeople.toLocaleString("ko-KR")}명 (Hot ${pct(cell.hotRate)})`}
      </div>
      <div>평가 케이스 {cell.caseCount.toLocaleString("ko-KR")}건</div>
      <div>
        {`Hot ${cell.hotCases.toLocaleString("ko-KR")}개 Cold ${cell.coldCases.toLocaleString("ko-KR")}개 (Cold 케이스 비율 ${pct(cell.caseColdRate)})`}
      </div>
    </>
  );
}

function RateHover({
  cell,
  month,
  children,
}: {
  cell: ReportRateCell;
  month?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="group relative inline-flex cursor-default justify-center">
      {children}
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-30 hidden w-[240px] -translate-x-1/2 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-left text-[11px] leading-relaxed text-[var(--fg-secondary)] shadow-[0_8px_24px_rgba(0,0,0,.12)] group-hover:block">
        <RateTooltipBody cell={cell} title={month} />
      </span>
    </span>
  );
}

function HotBar({ rate }: { rate: number }) {
  const w = Math.max(0, Math.min(100, rate * 100));
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="block h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-sunken,#eee)]">
        <span className="block h-full rounded-full bg-[var(--accent,#ff6f0f)]" style={{ width: `${w}%` }} />
      </span>
      <b className="min-w-[44px] tabular-nums text-[var(--fg-primary)]">{pct(rate)}</b>
    </span>
  );
}

const TEAM_DOTS = ["#ff6f0f", "#3182f6", "#16a34a", "#a855f7", "#e11d48", "#0d9488", "#ca8a04", "#64748b"];

function emptyHoverCell(): ReportRateCell {
  return {
    people: 0,
    hotPeople: 0,
    coldPeople: 0,
    meltPeople: 0,
    hotRate: 0,
    coldRate: 0,
    meltRate: 0,
    caseCount: 0,
    hotCases: 0,
    coldCases: 0,
    meltCases: 0,
    caseHotRate: 0,
    caseColdRate: 0,
  };
}

function HotTrendChart({
  months,
  company,
  teams,
}: {
  months: string[];
  company: ResultsReportResponse["hotTrend"];
  teams: ResultsReportResponse["teamHotTrend"];
}) {
  const [mode, setMode] = useState<"company" | "team">("company");
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    label: string;
    month: string;
    cell: ReportRateCell;
  } | null>(null);

  const W = 640;
  const H = 240;
  const padL = 36;
  const padR = 12;
  const padTop = 22;
  const padBot = 28;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBot;

  const series =
    mode === "company"
      ? [
          {
            key: "전사",
            color: "#ff6f0f",
            points: months.map((m) => {
              const p = company.find((c) => c.month === m);
              return { month: m, cell: p ?? emptyHoverCell() };
            }),
          },
        ]
      : teams.map((t, i) => ({
          key: t.org,
          color: TEAM_DOTS[i % TEAM_DOTS.length],
          points: months.map((m, mi) => ({
            month: m,
            cell: t.cells[mi] ?? emptyHoverCell(),
          })),
        }));

  const hasData = series.some((s) =>
    s.points.some((p) => p.cell.people > 0 || p.cell.caseCount > 0),
  );
  if (!months.length || !hasData) {
    return <p className="py-8 text-center text-[13px] text-[var(--fg-tertiary)]">표시할 추이가 없어요</p>;
  }

  const n = months.length;
  const xAt = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1));
  const yAt = (rate: number) => padTop + ((100 - rate * 100) / 100) * plotH;
  const yTicks = [0, 25, 50, 75, 100];
  const showLabels = mode === "company" || series.length <= 3;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Chip.RadioRoot
          value={mode}
          onValueChange={(v) => {
            setMode(v as "company" | "team");
            setHover(null);
          }}
          className="flex flex-wrap gap-1.5"
        >
          <Chip.RadioItem value="company" size="small" variant="outlineWeak">
            <Chip.Label>전사</Chip.Label>
          </Chip.RadioItem>
          <Chip.RadioItem value="team" size="small" variant="outlineWeak">
            <Chip.Label>팀별</Chip.Label>
          </Chip.RadioItem>
        </Chip.RadioRoot>
        {mode === "team" ? (
          <div className="flex max-w-full flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-[var(--fg-secondary)]">
            {series.slice(0, 12).map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                <span className="max-w-[96px] truncate">{s.key}</span>
              </span>
            ))}
            {series.length > 12 ? <span>+{series.length - 12}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          onMouseLeave={() => setHover(null)}
        >
          {yTicks.map((t) => {
            const y = yAt(t / 100);
            return (
              <g key={t}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  stroke="#ecece8"
                  strokeWidth={1}
                  strokeDasharray={t === 0 || t === 100 ? undefined : "3 4"}
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="#9ca3af"
                  className="tabular-nums"
                >
                  {t}%
                </text>
              </g>
            );
          })}
          <line x1={padL} y1={padTop} x2={padL} y2={H - padBot} stroke="#e5e5e0" strokeWidth={1} />
          <line
            x1={padL}
            y1={H - padBot}
            x2={W - padR}
            y2={H - padBot}
            stroke="#e5e5e0"
            strokeWidth={1}
          />
          {months.map((m, i) => (
            <text
              key={m}
              x={xAt(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="#9ca3af"
              className="tabular-nums"
            >
              {m.slice(5)}월
            </text>
          ))}
          {series.map((s) => {
            const coords = s.points
              .map((p, i) =>
                p.cell.people > 0 || p.cell.caseCount > 0
                  ? { i, x: xAt(i), y: yAt(p.cell.hotRate), p }
                  : null,
              )
              .filter(Boolean) as Array<{
              i: number;
              x: number;
              y: number;
              p: { month: string; cell: ReportRateCell };
            }>;
            const poly = coords.map((c) => `${c.x},${c.y}`).join(" ");
            return (
              <g key={s.key}>
                {coords.length > 1 ? (
                  <polyline
                    points={poly}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={mode === "company" ? 2 : 1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={mode === "team" ? 0.9 : 1}
                  />
                ) : null}
                {coords.map((c) => (
                  <g key={`${s.key}-${c.p.month}`}>
                    {showLabels ? (
                      <text
                        x={c.x}
                        y={c.y - 8}
                        textAnchor="middle"
                        fontSize={mode === "company" ? 10 : 8}
                        fontWeight={700}
                        fill={s.color}
                        className="tabular-nums"
                      >
                        {(c.p.cell.hotRate * 100).toFixed(0)}%
                      </text>
                    ) : null}
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={mode === "company" ? 2.75 : 2.25}
                      fill={s.color}
                      stroke="#fff"
                      strokeWidth={1}
                      className="cursor-pointer"
                      onMouseEnter={() =>
                        setHover({
                          x: c.x,
                          y: c.y,
                          label: s.key,
                          month: c.p.month,
                          cell: c.p.cell,
                        })
                      }
                    />
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
        {hover ? (
          <div
            className="pointer-events-none absolute z-20 w-[240px] rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-left text-[11px] leading-relaxed text-[var(--fg-secondary)] shadow-[0_8px_24px_rgba(0,0,0,.12)]"
            style={{
              left: `min(max(0px, calc(${(hover.x / W) * 100}% - 120px)), calc(100% - 240px))`,
              top: `calc(${(hover.y / H) * 100}% + 14px)`,
            }}
          >
            <RateTooltipBody
              cell={hover.cell}
              title={hover.label === "전사" ? hover.month : `${hover.label} · ${hover.month}`}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TeamHotTrend({
  months,
  rows,
}: {
  months: string[];
  rows: ResultsReportResponse["teamHotTrend"];
}) {
  if (!rows.length || !months.length) {
    return <p className="py-6 text-center text-[13px] text-[var(--fg-tertiary)]">팀별 추이가 없어요</p>;
  }
  return (
    <div className="max-h-[340px] overflow-auto">
      <div
        className="grid min-w-0 items-center gap-x-1 gap-y-1"
        style={{ gridTemplateColumns: `minmax(88px,1.1fr) repeat(${months.length}, minmax(44px,1fr))` }}
      >
        <span className="sticky top-0 z-10 bg-[var(--bg-canvas)] pb-1 text-[11px] font-semibold text-[var(--fg-tertiary)]">
          팀
        </span>
        {months.map((mo) => (
          <span
            key={mo}
            className="sticky top-0 z-10 bg-[var(--bg-canvas)] pb-1 text-center text-[10px] tabular-nums text-[var(--fg-tertiary)]"
          >
            {mo.slice(5)}월
          </span>
        ))}
        {rows.map((row, i) => (
          <div key={row.org} className="contents">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: TEAM_DOTS[i % TEAM_DOTS.length] }}
              />
              <span className="truncate" title={row.org}>
                {row.org}
              </span>
            </span>
            {row.cells.map((cell, mi) => (
              <RateHover key={`${row.org}-${months[mi]}`} cell={cell} month={months[mi]}>
                <span
                  className={`block py-0.5 text-center text-[12px] font-semibold tabular-nums ${
                    cell.people ? "text-[var(--fg-primary)]" : "text-[var(--fg-tertiary)]"
                  }`}
                >
                  {cell.people ? pct(cell.hotRate) : "—"}
                </span>
              </RateHover>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function downloadCsv(data: ResultsReportResponse, view: ViewId) {
  const lines: string[][] = [];
  if (view === "byOrg" || view === "summary") {
    lines.push(["조직", "구성원", "Hot인원", "Cold인원", "Hot비율(구성원)", "Cold비율(구성원)", "평가건수", "핫케이스비율", "콜드케이스비율", "전월Hot", "변화(pp)"]);
    for (const r of data.byOrg) {
      lines.push([
        r.org,
        String(r.people),
        String(r.hotPeople),
        String(r.coldPeople),
        pct(r.hotRate),
        pct(r.coldRate),
        String(r.caseCount),
        pct(r.caseHotRate),
        pct(r.caseColdRate),
        r.prevHotRate != null ? pct(r.prevHotRate) : "",
        r.deltaPp != null ? String(r.deltaPp) : "",
      ]);
    }
  } else if (view === "bySheet") {
    lines.push(["평가표", "구성원", "Hot비율(구성원)", "Cold비율(구성원)", "평가건수", "핫케이스비율", "콜드케이스비율"]);
    for (const r of data.bySheet) {
      lines.push([
        r.name,
        String(r.people),
        pct(r.hotRate),
        pct(r.coldRate),
        String(r.caseCount),
        pct(r.caseHotRate),
        pct(r.caseColdRate),
      ]);
    }
  } else if (view === "byMonth" || view === "trend") {
    lines.push(["월", "구성원", "Hot인원", "Cold인원", "Hot비율(구성원)", "Cold비율(구성원)", "평가건수", "핫케이스비율", "콜드케이스비율"]);
    for (const r of data.byMonth) {
      lines.push([
        r.month,
        String(r.people),
        String(r.hotPeople),
        String(r.coldPeople),
        pct(r.hotRate),
        pct(r.coldRate),
        String(r.caseCount),
        pct(r.caseHotRate),
        pct(r.caseColdRate),
      ]);
    }
  }
  if (!lines.length) return;
  const body = lines.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `qms-report-${data.range}-${view}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ResultsReportWorkbench() {
  const [view, setView] = useState<ViewId>("summary");
  const [range, setRange] = useState<ResultsReportRange>("6m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");

  const reportQuery =
    range === "custom" && customFrom && customTo
      ? `range=custom&from=${customFrom}&to=${customTo}`
      : `range=${range === "custom" ? "6m" : range}`;

  const { data, error, loading, validating, refresh } = useCachedFetch<ReportRes>({
    key: `resultsReport:v7:${reportQuery}`,
    fetcher: async () => {
      const r = await fetch(`/api/results/report?${reportQuery}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "리포트 로드 실패");
      return d as ReportRes;
    },
  });

  const monthOptions = (data?.allMonths ?? []).map((m) => ({ value: m, label: m }));

  const openPeriod = () => {
    const months = data?.allMonths ?? [];
    setDraftFrom(customFrom || data?.fromMonth || months[Math.max(0, months.length - 6)] || "");
    setDraftTo(customTo || data?.toMonth || months[months.length - 1] || "");
    setPeriodOpen(true);
  };

  const applyPeriod = () => {
    if (!draftFrom || !draftTo) return;
    const from = draftFrom <= draftTo ? draftFrom : draftTo;
    const to = draftFrom <= draftTo ? draftTo : draftFrom;
    setCustomFrom(from);
    setCustomTo(to);
    setRange("custom");
    setPeriodOpen(false);
  };

  const selectPreset = (v: ResultsReportRange) => {
    setRange(v);
    setCustomFrom("");
    setCustomTo("");
    setPeriodOpen(false);
  };

  const lm = data?.latestMonth;

  return (
    <div className="qms-page-body mx-auto max-w-[1280px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Text as="p" textStyle="t2Bold" color="fg.neutralSubtle">
            품질평가
          </Text>
          <Text as="h1" textStyle="t9Bold" color="fg.neutral">
            리포트
          </Text>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
            구성원(evaluation_target) 기준으로 Hot/Cold를 집계해요. 케이스 비율은 별도 지표예요.
          </Text>
        </div>
        <ActionButton variant="neutralWeak" size="small" loading={validating} onClick={() => void refresh()}>
          <PrefixIcon svg={<IconArrow2ClockwiseCircularLine />} />
          새로고침
        </ActionButton>
      </div>

      {data?.unconfirmed ? <UnconfirmedLink data={data.unconfirmed} /> : null}

      <div className="flex flex-wrap items-center gap-2.5">
        <ChipTabsRoot
          value={view}
          onValueChange={(v) => setView(v as ViewId)}
          variant="neutralSolid"
          size="medium"
        >
          <ChipTabsList>
            {VIEWS.map((v) => (
              <ChipTabsTrigger key={v.id} value={v.id}>
                {v.label}
              </ChipTabsTrigger>
            ))}
          </ChipTabsList>
        </ChipTabsRoot>
        <Chip.RadioRoot
          value={range}
          onValueChange={(v) => {
            if (v === "custom") {
              openPeriod();
              return;
            }
            selectPreset(v as ResultsReportRange);
          }}
          className="flex flex-wrap gap-1.5"
        >
          {RANGES.map((r) => (
            <Chip.RadioItem key={r.id} value={r.id} size="small" variant="outlineWeak">
              <Chip.Label>{r.label}</Chip.Label>
            </Chip.RadioItem>
          ))}
          <Chip.RadioItem value="custom" size="small" variant="outlineWeak">
            <Chip.Label>
              {range === "custom" && customFrom && customTo ? `${customFrom} ~ ${customTo}` : "기간 선택"}
            </Chip.Label>
          </Chip.RadioItem>
        </Chip.RadioRoot>
        <ActionButton
          variant="neutralOutline"
          size="small"
          disabled={!data}
          onClick={() => data && downloadCsv(data, view)}
          className="ml-auto"
        >
          <PrefixIcon svg={<IconArrowDownHorizlineLine />} />
          CSV 내려받기
        </ActionButton>
      </div>

      {periodOpen ? (
        <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--border-subtle)] bg-white p-3">
          <FilterSelect
            label="시작월"
            value={draftFrom}
            onChange={setDraftFrom}
            options={monthOptions}
            allLabel="시작월"
          />
          <FilterSelect
            label="종료월"
            value={draftTo}
            onChange={setDraftTo}
            options={monthOptions}
            allLabel="종료월"
          />
          <ActionButton size="small" onClick={applyPeriod} disabled={!draftFrom || !draftTo}>
            적용
          </ActionButton>
          <ActionButton size="small" variant="neutralWeak" onClick={() => setPeriodOpen(false)}>
            닫기
          </ActionButton>
        </div>
      ) : null}

      {error ? (
        <Callout
          tone="critical"
          title="리포트를 불러오지 못했어요"
          description={error}
          linkProps={{ children: "다시 시도", onClick: () => void refresh() }}
        />
      ) : null}

      {!data && loading ? (
        <div className="flex items-center justify-center gap-2 py-24">
          <ProgressCircle size="24" />
          <Text textStyle="t4Regular" color="fg.neutralSubtle">
            리포트 집계 중…
          </Text>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch">
            <ScoreSection title="선택 기간" sub={data.rangeLabel} tone="period" className="h-full">
              <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <ScoreRow label="구성원">
                  <StatCard
                    label="평가 대상"
                    value={data.summary.people.toLocaleString("ko-KR")}
                    unit="명"
                  />
                  <RateCountCard
                    label="Hot 비율"
                    rate={data.summary.hotRate}
                    count={data.summary.hotPeople}
                    countUnit="명"
                  />
                  <RateCountCard
                    label="Cold 비율"
                    rate={data.summary.coldRate}
                    count={data.summary.coldPeople}
                    countUnit="명"
                  />
                </ScoreRow>
                <ScoreRow label="케이스">
                  <StatCard
                    label="평가 건수"
                    value={data.summary.caseCount.toLocaleString("ko-KR")}
                    unit="건"
                  />
                  <RateCountCard
                    label="Hot 비율"
                    rate={data.summary.caseHotRate}
                    count={data.summary.hotCases}
                    countUnit="건"
                  />
                  <RateCountCard
                    label="Cold 비율"
                    rate={data.summary.caseColdRate}
                    count={data.summary.coldCases}
                    countUnit="건"
                  />
                </ScoreRow>
              </div>
            </ScoreSection>

            {lm ? (
              <ScoreSection title="최근월" sub={lm.month} tone="latest" className="h-full">
                <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                  <ScoreRow label="구성원">
                    <StatCard
                      label="평가 인원"
                      value={lm.rates.people.toLocaleString("ko-KR")}
                      unit="명"
                    />
                    <RateCountCard
                      label="Hot 구성원"
                      rate={lm.rates.hotRate}
                      count={lm.rates.hotPeople}
                      countUnit="명"
                    />
                    <RateCountCard
                      label="Cold 구성원"
                      rate={lm.rates.coldRate}
                      count={lm.rates.coldPeople}
                      countUnit="명"
                    />
                  </ScoreRow>
                  <ScoreRow label="팀 · 평가표">
                    <StatCard
                      label="Hot 제일 많은 팀"
                      value={lm.hotTeams.length ? lm.hotTeams.join(", ") : "—"}
                      caption={lm.hotTeams.length ? `Hot ${pct(lm.hotTeamRate)}` : undefined}
                    />
                    <StatCard
                      label="Cold 제일 많은 팀"
                      value={lm.coldTeams.length ? lm.coldTeams.join(", ") : "—"}
                      caption={lm.coldTeams.length ? `Cold ${pct(lm.coldTeamRate)}` : undefined}
                    />
                    <StatCard
                      label="Cold 제일 많은 평가표"
                      value={lm.coldSheet?.name ?? "—"}
                      caption={
                        lm.coldSheet
                          ? `${lm.coldSheet.caseCount.toLocaleString("ko-KR")}건 · ${lm.coldSheet.people}명 · Hot ${lm.coldSheet.hotPeople} / Cold ${lm.coldSheet.coldPeople}`
                          : undefined
                      }
                    />
                  </ScoreRow>
                </div>
              </ScoreSection>
            ) : (
              <div className="rounded-[14px] border border-dashed border-[var(--border-subtle)] p-4 text-[13px] text-[var(--fg-tertiary)]">
                최근월 데이터가 없어요
              </div>
            )}
          </div>

          {view === "summary" ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.95fr)]">
              <div className="rounded-[var(--radius-xl,16px)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 shadow-[var(--shadow-1,0_1px_2px_rgba(0,0,0,.04))]">
                <div className="text-[15px] font-bold">Hot 비율 추이</div>
                <div className="mb-2 text-[12px] text-[var(--fg-tertiary)]">
                  구성원 기준 · {data.rangeLabel}
                  {data.monthsInRange.length
                    ? ` · ${data.monthsInRange[0]} ~ ${data.monthsInRange[data.monthsInRange.length - 1]}`
                    : ""}
                </div>
                <HotTrendChart
                  months={data.monthsInRange}
                  company={data.hotTrend}
                  teams={data.teamHotTrend}
                />
              </div>
              <div className="rounded-[var(--radius-xl,16px)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 shadow-[var(--shadow-1,0_1px_2px_rgba(0,0,0,.04))]">
                <div className="text-[15px] font-bold">팀별 Hot 비율</div>
                <div className="mb-2 text-[12px] text-[var(--fg-tertiary)]">구성원 기준 · 월별</div>
                <TeamHotTrend months={data.monthsInRange} rows={data.teamHotTrend} />
              </div>
            </div>
          ) : null}

          {view === "trend" ? (
            <Panel
              title="조직별 · 월별 Hot 비율"
              sub="구성원 기준. 최근 최대 3개월"
              footer="빈 칸은 해당 월에 평가된 구성원이 없는 조직이에요. 숫자에 마우스를 올리면 인원·케이스 상세가 나와요."
            >
              <div
                className="grid gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-[18px] py-2.5 text-[12px] font-semibold text-[var(--fg-tertiary)]"
                style={{
                  gridTemplateColumns: `minmax(140px,1fr) repeat(${Math.max(data.trendMonths.length, 1)},90px)`,
                }}
              >
                <span>조직</span>
                {data.trendMonths.map((mo) => (
                  <span key={mo} className="text-center">
                    {mo}
                  </span>
                ))}
              </div>
              {data.trendMatrix.map((row) => (
                <div
                  key={row.org}
                  className="grid items-center gap-2.5 border-b border-[var(--border-subtle)] px-[18px] py-3 text-[13.5px]"
                  style={{
                    gridTemplateColumns: `minmax(140px,1fr) repeat(${Math.max(data.trendMonths.length, 1)},90px)`,
                  }}
                >
                  <span className="font-semibold">{row.org}</span>
                  {row.cells.map((c, i) => (
                    <RateHover key={data.trendMonths[i]} cell={c} month={data.trendMonths[i]}>
                      <span className="block text-center tabular-nums text-[var(--fg-primary)]">
                        {c.people ? pct(c.hotRate) : "—"}
                      </span>
                    </RateHover>
                  ))}
                </div>
              ))}
              {!data.trendMatrix.length ? (
                <p className="px-[18px] py-8 text-center text-[13px] text-[var(--fg-tertiary)]">데이터가 없어요</p>
              ) : null}
            </Panel>
          ) : null}

          {view === "byOrg" ? (
            <Panel
              title="조직별 실적"
              sub="팀 단위 구성원 Hot 비율, 전월 대비 변화"
              footer="Hot/Cold 비율은 구성원(월) 기준이에요. 변화는 범위 내 마지막 월과 그 직전 월을 비교해요."
            >
              <div className="grid grid-cols-[minmax(140px,1fr)_72px_72px_minmax(160px,1.2fr)_72px_64px] gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-[18px] py-2.5 text-[12px] font-semibold text-[var(--fg-tertiary)]">
                <span>조직</span>
                <span>인원</span>
                <span>건수</span>
                <span>Hot 비율</span>
                <span>전월</span>
                <span>변화</span>
              </div>
              {data.byOrg.map((r) => (
                <div
                  key={r.org}
                  className="grid items-center gap-2.5 border-b border-[var(--border-subtle)] px-[18px] py-3 text-[13.5px] hover:bg-[var(--bg-subtle)]"
                  style={{
                    gridTemplateColumns: "minmax(140px,1fr) 72px 72px minmax(160px,1.2fr) 72px 64px",
                  }}
                >
                  <span className="font-semibold">{r.org}</span>
                  <span className="tabular-nums">{r.people}명</span>
                  <span className="tabular-nums">{r.caseCount}</span>
                  <HotBar rate={r.hotRate} />
                  <span className="tabular-nums text-[var(--fg-secondary)]">
                    {r.prevHotRate != null ? pct(r.prevHotRate) : "—"}
                  </span>
                  <b
                    className={`tabular-nums ${
                      r.deltaPp == null
                        ? "text-[var(--fg-tertiary)]"
                        : r.deltaPp >= 0
                          ? "text-[var(--accent-fg)]"
                          : "text-[var(--danger)]"
                    }`}
                  >
                    {r.deltaPp == null ? "—" : `${r.deltaPp > 0 ? "+" : ""}${r.deltaPp}%p`}
                  </b>
                </div>
              ))}
            </Panel>
          ) : null}

          {view === "bySheet" ? (
            <Panel
              title="평가표별 실적"
              sub="평가표 기준 구성원 Hot / Cold 비율"
              footer="Hot/Cold는 구성원 기준, 케이스 비율은 CSV에서 확인할 수 있어요."
            >
              <div className="grid grid-cols-[minmax(220px,1.4fr)_80px_minmax(180px,1fr)_90px] gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-[18px] py-2.5 text-[12px] font-semibold text-[var(--fg-tertiary)]">
                <span>평가표</span>
                <span>건수</span>
                <span>Hot 비율</span>
                <span>Cold율</span>
              </div>
              {data.bySheet.map((r) => (
                <div
                  key={r.name}
                  className="grid items-center gap-2.5 border-b border-[var(--border-subtle)] px-[18px] py-3 text-[13.5px] hover:bg-[var(--bg-subtle)]"
                  style={{ gridTemplateColumns: "minmax(220px,1.4fr) 80px minmax(180px,1fr) 90px" }}
                >
                  <span className="font-semibold">{r.name}</span>
                  <span className="tabular-nums">{r.caseCount}건</span>
                  <HotBar rate={r.hotRate} />
                  <b className="tabular-nums text-[#9a5b00]">{pct(r.coldRate)}</b>
                </div>
              ))}
            </Panel>
          ) : null}

          {view === "byMonth" ? (
            <Panel
              title="월별 실적"
              sub={`${data.rangeLabel} · 구성원 Hot 비율`}
              footer="Hot/Cold 비율은 구성원 기준이에요. 해당 월에 한 번이라도 result가 cold면 Cold, melt가 있으면 Melt, 나머지는 Hot이에요."
            >
              <div className="grid grid-cols-[100px_minmax(160px,1fr)_80px_minmax(160px,1fr)_80px] gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-[18px] py-2.5 text-[12px] font-semibold text-[var(--fg-tertiary)]">
                <span>월</span>
                <span>건수 분포</span>
                <span>건수</span>
                <span>Hot 비율</span>
                <span>Cold율</span>
              </div>
              {(() => {
                const maxN = Math.max(1, ...data.byMonth.map((m) => m.caseCount));
                return data.byMonth.map((r) => (
                  <div
                    key={r.month}
                    className="grid items-center gap-2.5 border-b border-[var(--border-subtle)] px-[18px] py-3 text-[13.5px] hover:bg-[var(--bg-subtle)]"
                    style={{
                      gridTemplateColumns: "100px minmax(160px,1fr) 80px minmax(160px,1fr) 80px",
                    }}
                  >
                    <b className="tabular-nums">{r.month}</b>
                    <span className="block">
                      <span
                        className="block h-3 rounded-md bg-[var(--brand)]"
                        style={{ width: `${(r.caseCount / maxN) * 100}%`, minWidth: r.caseCount ? 4 : 0 }}
                      />
                    </span>
                    <span className="tabular-nums">{r.caseCount}건</span>
                    <HotBar rate={r.hotRate} />
                    <b className="tabular-nums text-[#9a5b00]">{pct(r.coldRate)}</b>
                  </div>
                ));
              })()}
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

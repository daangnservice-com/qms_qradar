"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PrefixIcon, Text } from "@seed-design/react";
import IconArrow2ClockwiseCircularLine from "@karrotmarket/react-monochrome-icon/IconArrow2ClockwiseCircularLine";
import { ChevronDown, Printer } from "lucide-react";
import { ActionButton } from "seed-design/ui/action-button";
import { Callout } from "seed-design/ui/callout";
import { ChipTabsList, ChipTabsRoot, ChipTabsTrigger } from "seed-design/ui/chip-tabs";
import { ProgressCircle } from "seed-design/ui/progress-circle";
import { useCachedFetch } from "@/lib/useCachedFetch";
import {
  CRITICAL_CATEGORY,
  categoryTotals,
  getTeamSplitStats,
  integratedStatus,
  isCsAdminItems,
  itemDrilldown,
  primaryCounts,
  ratePct,
} from "@/lib/monthlyReportLogic";
import type {
  MonthlyReportDraftResponse,
  MonthlyReportResponse,
  RepeatColdRow,
} from "@/lib/monthlyReportTypes";
import { FilterSelect } from "./ResultsShared";

type ReportRes = { ok: boolean } & MonthlyReportResponse;
type DraftRes = { ok: boolean } & MonthlyReportDraftResponse;
type TabId = "dash" | "report";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "dash", label: "대시보드 · 트렌드" },
  { id: "report", label: "보고서" },
];

function tierColor(hotRate: number): string {
  if (hotRate < 50) return "#E74C3C";
  if (hotRate < 75) return "#F5A623";
  return "#52C41A";
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-visible rounded-[var(--radius-xl,16px)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] shadow-[var(--shadow-1,0_1px_2px_rgba(0,0,0,.04))] print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline gap-2 px-[18px] pb-2 pt-[15px]">
        <div className="text-[15px] font-bold text-[var(--fg-primary)]">{title}</div>
        {sub ? <span className="text-[12px] text-[var(--fg-tertiary)]">{sub}</span> : null}
      </div>
      <div className="px-[18px] pb-4">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-[var(--fg-tertiary)]">{children}</p>;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--fg-tertiary)] transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="text-[14px] font-bold text-[var(--fg-primary)]">{title}</span>
      </button>
      {open ? <div className="border-t border-[var(--border-subtle)] px-4 py-3">{children}</div> : null}
    </section>
  );
}

function renderInlineMd(text: string, keyBase: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <strong key={`${keyBase}-b${i++}`} className="font-bold">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : text;
}

function isMdTableSep(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
}

function splitMdRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function ReportMarkdownPreview({ text }: { text: string }) {
  const raw = text.trim();
  if (!raw) {
    return <p className="py-6 text-center text-[13px] text-[var(--fg-tertiary)]">미리볼 내용이 없어요.</p>;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith("■")) {
      blocks.push(
        <h1 key={key++} className="mb-3 text-[20px] font-bold leading-snug text-[var(--fg-primary)]">
          {renderInlineMd(line.replace(/^■\s*/, ""), `t${key}`)}
        </h1>,
      );
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? "mt-6 mb-2 text-[18px] font-bold text-[var(--fg-primary)]"
          : level === 2
            ? "mt-6 mb-2 text-[16px] font-bold text-[var(--fg-primary)]"
            : "mt-4 mb-1.5 text-[14px] font-bold text-[var(--fg-secondary)]";
      const Tag = (level === 1 ? "h1" : level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
      blocks.push(
        <Tag key={key++} className={cls}>
          {renderInlineMd(heading[2], `h${key}`)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-3 rounded-[8px] border-l-4 border-[#4A90D9] bg-[var(--bg-muted)] px-3 py-2 text-[13px] leading-relaxed text-[var(--fg-secondary)]"
        >
          {quote.map((q, qi) => (
            <p key={qi} className={qi > 0 ? "mt-1" : undefined}>
              {renderInlineMd(q, `q${key}-${qi}`)}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && isMdTableSep(lines[i + 1])) {
      const headers = splitMdRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && !isMdTableSep(lines[i])) {
        rows.push(splitMdRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th
                    key={hi}
                    className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2 py-1.5 font-bold text-[var(--fg-secondary)]"
                  >
                    {renderInlineMd(h, `th${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {headers.map((_, ci) => (
                    <td key={ci} className="border-b border-[var(--border-subtle)] px-2 py-1.5 text-[var(--fg-primary)]">
                      {renderInlineMd(row[ci] ?? "", `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*(?:[-*○])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*(?:[-*○])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-*○])\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-[var(--fg-primary)]">
          {items.map((item, ii) => (
            <li key={ii}>{renderInlineMd(item, `li${key}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("■") &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith(">") &&
      !/^\s*(?:[-*○])\s+/.test(lines[i]) &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && isMdTableSep(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="my-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--fg-primary)]">
        {renderInlineMd(para.join("\n"), `p${key}`)}
      </p>,
    );
  }

  return <div className="monthly-report-md">{blocks}</div>;
}

function KpiCard({
  label,
  value,
  unit,
  caption,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  tone?: "hot" | "cold" | "melt";
}) {
  const color =
    tone === "hot" ? "text-[#E74C3C]" : tone === "cold" ? "text-[#4A90D9]" : tone === "melt" ? "text-[#52C41A]" : "";
  return (
    <div className="flex min-w-[130px] flex-1 flex-col rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-3">
      <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={`text-[22px] font-bold leading-none tabular-nums ${color}`}>{value}</span>
        {unit ? <span className="text-[12px] font-bold text-[var(--fg-tertiary)]">{unit}</span> : null}
      </div>
      {caption ? <div className="mt-1 text-[11px] leading-snug text-[var(--fg-tertiary)]">{caption}</div> : null}
    </div>
  );
}

function HBars({
  rows,
  max,
  onClick,
}: {
  rows: Array<{ key: string; label: string; value: number; color: string; hint?: string }>;
  max: number;
  onClick?: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (!rows.length) return <Empty>표시할 데이터가 없어요</Empty>;
  const m = Math.max(max, 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          disabled={!onClick}
          onClick={() => onClick?.(r.key)}
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
          className={`relative grid w-full grid-cols-[minmax(72px,160px)_1fr_52px] items-center gap-2 text-left ${onClick ? "cursor-pointer" : "cursor-default"}`}
        >
          <span className="truncate text-[12px] font-semibold text-[var(--fg-secondary)]">{r.label}</span>
          <span className="block h-3 overflow-hidden rounded-full bg-[var(--bg-sunken,#eee)]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(2, (r.value / m) * 100)}%`, background: r.color }}
            />
          </span>
          <span className="text-right text-[12px] font-bold tabular-nums text-[var(--fg-primary)]">
            {r.hint ?? String(r.value)}
          </span>
          {hover === r.key ? (
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-left text-[11px] leading-snug text-[var(--fg-secondary)] shadow-[0_8px_24px_rgba(0,0,0,.12)]">
              <span className="block font-bold text-[var(--fg-primary)]">{r.label}</span>
              <span className="tabular-nums">{r.hint ?? String(r.value)}</span>
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const CHART_H = 240;
const CHART_PAD = { l: 40, r: 16, t: 16, b: 30 };
const POINT_R = 4;
const LINE_W = 2;

function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (width: number) => {
      const next = Math.max(280, Math.floor(width));
      setW((prev) => (prev === next ? prev : next));
    };
    apply(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) apply(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceTicks(yMax: number): number[] {
  if (yMax <= 0) return [0];
  if (yMax <= 100 && yMax >= 40) return [0, 25, 50, 75, 100].filter((t) => t <= yMax + 1e-9);
  const raw = yMax / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((n) => n * pow).find((n) => n >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + nice * 0.01; v += nice) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < yMax) ticks.push(yMax);
  return ticks;
}

function hexAlpha(color: string, a: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const h = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = Number.parseInt(h.slice(1, 3), 16);
    const g = Number.parseInt(h.slice(3, 5), 16);
    const b = Number.parseInt(h.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

function ChartTooltip({
  x,
  y,
  width,
  title,
  rows,
  note,
}: {
  x: number;
  y: number;
  width: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  note?: string;
}) {
  const left = Math.min(Math.max(8, x - 110), Math.max(8, width - 228));
  return (
    <div
      className="pointer-events-none absolute z-20 w-[220px] rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-left text-[11px] leading-relaxed text-[var(--fg-secondary)] shadow-[0_8px_24px_rgba(0,0,0,.12)]"
      style={{ left, top: Math.max(4, y - 12), transform: "translateY(-100%)" }}
    >
      <div className="mb-1 font-bold text-[var(--fg-primary)]">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {r.color ? <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.color }} /> : null}
            <span className="truncate">{r.label}</span>
          </span>
          <span className="tabular-nums font-bold text-[var(--fg-primary)]">{r.value}</span>
        </div>
      ))}
      {note ? <div className="mt-1 text-[10.5px] text-[var(--fg-tertiary)]">{note}</div> : null}
    </div>
  );
}

type ChartSeries = { key: string; color: string; values: number[] };

function TrendChart({
  months,
  series,
  yMax = 100,
  variant = "line",
  formatValue,
  tooltipExtra,
}: {
  months: string[];
  series: ChartSeries[];
  yMax?: number;
  variant?: "line" | "area";
  formatValue?: (v: number) => string;
  tooltipExtra?: string[];
}) {
  const { ref, w } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const fmt = formatValue ?? ((v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)));

  if (!months.length || !series.some((s) => s.values.some((v) => v > 0))) {
    return <Empty>표시할 추이가 없어요</Empty>;
  }

  const W = w || 640;
  const pad = CHART_PAD;
  const plotW = W - pad.l - pad.r;
  const plotH = CHART_H - pad.t - pad.b;
  const n = months.length;
  const maxY = Math.max(yMax, 1);
  const xAt = (i: number) => (n === 1 ? pad.l + plotW / 2 : pad.l + (i * plotW) / (n - 1));
  const yAt = (v: number) => pad.t + ((maxY - Math.max(0, Math.min(maxY, v))) / maxY) * plotH;
  const yTicks = niceTicks(maxY);

  const stacked = variant === "area"
    ? months.map((_, i) => {
        let acc = 0;
        return series.map((s) => {
          const v = s.values[i] ?? 0;
          const from = acc;
          acc += v;
          return { from, to: acc, v };
        });
      })
    : null;

  const nearestIndex = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  const hoverX = hover != null ? xAt(hover) : 0;
  const hoverY = hover != null
    ? stacked
      ? yAt(stacked[hover]?.[stacked[hover].length - 1]?.to ?? 0)
      : Math.min(...series.map((s) => yAt(s.values[hover] ?? 0)))
    : 0;

  return (
    <div>
      <div ref={ref} className="relative h-[240px] w-full">
        {w ? (
          <svg
            width={W}
            height={CHART_H}
            className="block"
            onMouseMove={(e) => setHover(nearestIndex(e.clientX, e.currentTarget))}
            onMouseLeave={() => setHover(null)}
          >
            {yTicks.map((t) => {
              const y = yAt(t);
              return (
                <g key={t}>
                  <line
                    x1={pad.l}
                    y1={y}
                    x2={W - pad.r}
                    y2={y}
                    stroke="var(--border-subtle)"
                    strokeWidth={1}
                    strokeDasharray={t === 0 || t === maxY ? undefined : "3 4"}
                  />
                  <text
                    x={pad.l - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--fg-tertiary)"
                    className="tabular-nums"
                  >
                    {t}
                  </text>
                </g>
              );
            })}
            <line x1={pad.l} y1={pad.t} x2={pad.l} y2={CHART_H - pad.b} stroke="var(--border-subtle)" strokeWidth={1} />
            <line
              x1={pad.l}
              y1={CHART_H - pad.b}
              x2={W - pad.r}
              y2={CHART_H - pad.b}
              stroke="var(--border-subtle)"
              strokeWidth={1}
            />
            {months.map((m, i) => (
              <text
                key={m}
                x={xAt(i)}
                y={CHART_H - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--fg-tertiary)"
                className="tabular-nums"
              >
                {m.slice(2)}
              </text>
            ))}
            {hover != null ? (
              <line
                x1={hoverX}
                y1={pad.t}
                x2={hoverX}
                y2={CHART_H - pad.b}
                stroke="var(--fg-tertiary)"
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.45}
              />
            ) : null}

            {variant === "area" && stacked
              ? series.map((s, si) => {
                  const top = months.map((_, i) => `${xAt(i)},${yAt(stacked[i][si].to)}`).join(" ");
                  const bottom = months
                    .map((_, i) => `${xAt(n - 1 - i)},${yAt(stacked[n - 1 - i][si].from)}`)
                    .join(" ");
                  return (
                    <g key={s.key}>
                      <polygon
                        points={`${top} ${bottom}`}
                        fill={hexAlpha(s.color, 0.28)}
                        stroke="none"
                      />
                      <polyline
                        points={months.map((_, i) => `${xAt(i)},${yAt(stacked[i][si].to)}`).join(" ")}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={LINE_W}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {months.map((_, i) => (
                        <circle
                          key={i}
                          cx={xAt(i)}
                          cy={yAt(stacked[i][si].to)}
                          r={POINT_R}
                          fill={s.color}
                          stroke="#fff"
                          strokeWidth={1}
                        />
                      ))}
                    </g>
                  );
                })
              : series.map((s) => {
                  const pts = months.map((_, i) => `${xAt(i)},${yAt(s.values[i] ?? 0)}`).join(" ");
                  return (
                    <g key={s.key}>
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={LINE_W}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {months.map((_, i) => (
                        <circle
                          key={i}
                          cx={xAt(i)}
                          cy={yAt(s.values[i] ?? 0)}
                          r={POINT_R}
                          fill={s.color}
                          stroke="#fff"
                          strokeWidth={1}
                        />
                      ))}
                    </g>
                  );
                })}
          </svg>
        ) : null}
        {hover != null && w ? (
          <ChartTooltip
            x={hoverX}
            y={hoverY}
            width={W}
            title={months[hover]}
            rows={series.map((s, si) => ({
              label: s.key,
              value: fmt(stacked ? stacked[hover][si].v : (s.values[hover] ?? 0)),
              color: s.color,
            }))}
            note={tooltipExtra?.[hover]}
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--fg-secondary)]">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {s.key}
          </span>
        ))}
      </div>
    </div>
  );
}

function statusIcon(st: "H" | "C" | "M"): string {
  return st === "H" ? "Hot" : st === "C" ? "Cold" : "Melt";
}

export default function MonthlyReportWorkbench() {
  const [tab, setTab] = useState<TabId>("dash");
  const [month, setMonth] = useState("");
  const [team, setTeam] = useState("");
  const [splitAudit, setSplitAudit] = useState(true);
  const [agentQ, setAgentQ] = useState("");
  const [itemDrill, setItemDrill] = useState<{ label: string; categoryMode: boolean } | null>(null);
  const [repeatDrill, setRepeatDrill] = useState<RepeatColdRow | null>(null);
  const [toast, setToast] = useState("");
  const [notes, setNotes] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);

  const reportQuery = `month=${encodeURIComponent(month)}&team=${encodeURIComponent(team)}`;
  const { data, error, loading, validating, refresh } = useCachedFetch<ReportRes>({
    key: `monthlyReport:v1:${reportQuery}`,
    fetcher: async () => {
      const r = await fetch(`/api/results/monthly-report?${reportQuery}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "월간 리포트 로드 실패");
      return d as ReportRes;
    },
  });

  useEffect(() => {
    if (data?.month && !month) setMonth(data.month);
  }, [data?.month, month]);

  const draftKey = `monthlyReportDraft:v1:${reportQuery}`;
  const {
    data: draft,
    error: draftError,
    loading: draftLoading,
    validating: draftValidating,
    refresh: refreshDraft,
    setData: setDraftData,
  } = useCachedFetch<DraftRes>({
    key: draftKey,
    enabled: tab === "report",
    fetcher: async () => {
      const r = await fetch(`/api/results/monthly-report/draft?${reportQuery}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "보고서 초안 로드 실패");
      return d as DraftRes;
    },
  });

  useEffect(() => {
    if (!draft) return;
    setNotes(draft.specialNotes);
    setDraftText(draft.text);
    setDraftSaved(draft.saved);
  }, [draft]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }

  const monthOptions = (data?.allMonths ?? []).map((m) => ({ value: m, label: m }));
  const teamOptions = (data?.teams ?? []).map((t) => ({ value: t, label: t }));
  const selected = data?.selected ?? null;
  const pc = selected ? primaryCounts(selected) : null;
  const total = pc ? pc.hot + pc.cold + pc.melt : 0;
  const hotRate = pc ? ratePct(pc.hot, total) : 0;
  const prevPc = data?.prev ? primaryCounts(data.prev) : null;
  const prevTotal = prevPc ? prevPc.hot + prevPc.cold + prevPc.melt : 0;
  const prevHot = prevPc ? ratePct(prevPc.hot, prevTotal) : null;
  const deltaPp = prevHot != null ? hotRate - prevHot : null;

  const teamRows = useMemo(() => {
    if (!selected) return [];
    return Object.keys(selected.teams)
      .flatMap((name) => getTeamSplitStats(selected, name, splitAudit))
      .map((s) => {
        const t = s.hot + s.cold + s.melt;
        return { ...s, total: t, hotRate: t ? (s.hot / t) * 100 : 0 };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => a.hotRate - b.hotRate);
  }, [selected, splitAudit]);

  const teamChartRows = useMemo(
    () =>
      [...teamRows]
        .sort((a, b) => b.hotRate - a.hotRate)
        .map((r) => ({
          key: r.label,
          label: r.label,
          value: r.hotRate,
          color: tierColor(r.hotRate),
          hint: `${r.hotRate.toFixed(1)}%`,
        })),
    [teamRows],
  );
  const teamAvg = teamChartRows.length
    ? teamChartRows.reduce((a, r) => a + r.value, 0) / teamChartRows.length
    : 0;

  const agents = useMemo(() => {
    if (!selected) return [];
    const q = agentQ.trim().toLowerCase();
    const rows = Object.values(selected.agents).map((a) => {
      const st = integratedStatus(a.channels);
      const chanList = Object.keys(a.channels)
        .map((c) => {
          const b = a.channels[c];
          const s = b.M > 0 ? "M" : b.C > 0 ? "C" : "H";
          return `${c}:${s}`;
        })
        .join(" / ");
      return { key: a.key, name: a.name, team: a.team, status: st, chanList };
    });
    const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    const order = { C: 0, M: 1, H: 2 };
    return filtered.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, "ko"));
  }, [selected, agentQ]);

  const categoryMode = selected ? isCsAdminItems(selected.items) : false;
  const itemRows = useMemo(() => {
    if (!selected) return [];
    const totals = categoryMode ? categoryTotals(selected.items) : selected.items;
    return Object.entries(totals)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ key: k, label: k, value: n, color: "#1A2B5E", hint: `${n}` }));
  }, [selected, categoryMode]);

  const drillRows = useMemo(() => {
    if (!selected || !itemDrill) return [];
    return itemDrilldown(selected, itemDrill.label, itemDrill.categoryMode);
  }, [selected, itemDrill]);

  const trendMonths = data?.trend.map((t) => t.month) ?? [];
  const trendSeries = [
    {
      key: "Cold",
      color: "#4A90D9",
      values: data?.trend.map((t) => (t.total ? (t.cold / t.total) * 100 : 0)) ?? [],
    },
    { key: "Hot", color: "#E74C3C", values: data?.trend.map((t) => t.hotRate) ?? [] },
    {
      key: "Melt",
      color: "#52C41A",
      values: data?.trend.map((t) => (t.total ? (t.melt / t.total) * 100 : 0)) ?? [],
    },
  ];
  const trendTooltipExtra = data?.trend.map(
    (t) => `Cold ${t.cold}명 · Hot ${t.hot}명 · Melt ${t.melt}명`,
  );

  const catKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of data?.categoryTrend ?? []) {
      for (const [k, n] of Object.entries(p.categories)) if (n > 0 && k !== CRITICAL_CATEGORY) keys.add(k);
    }
    return [...keys];
  }, [data?.categoryTrend]);
  const catColors = ["#1A2B5E", "#4A90D9", "#F5A623", "#52C41A", "#E74C3C", "#9B59B6", "#0d9488", "#64748b"];
  const catSeries = catKeys.map((k, i) => ({
    key: k,
    color: catColors[i % catColors.length],
    values: (data?.categoryTrend ?? []).map((p) => p.categories[k] || 0),
  }));
  const catMax = Math.max(1, ...catSeries.flatMap((s) => s.values));

  async function saveNotes() {
    if (!data?.month) return;
    await fetch("/api/results/monthly-report/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month: data.month, team, specialNotes: notes }),
    });
  }

  async function saveDraft() {
    if (!data?.month) return;
    setDraftBusy(true);
    try {
      const r = await fetch("/api/results/monthly-report/draft", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month: data.month, team, specialNotes: notes, text: draftText }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "저장 실패");
      setDraftData(d);
      setDraftSaved(true);
      showToast("보고서를 저장했어요");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
    }
  }

  async function regenerateDraft() {
    if (!data?.month) return;
    setDraftBusy(true);
    try {
      await saveNotes();
      const r = await fetch(`/api/results/monthly-report/draft?${reportQuery}&fresh=1`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "재생성 실패");
      setDraftText(d.text);
      setNotes(d.specialNotes);
      setDraftSaved(false);
      showToast("초안을 다시 만들었어요 (미저장)");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
    }
  }

  async function deleteDraft() {
    if (!data?.month) return;
    if (!window.confirm("저장된 보고서를 삭제할까요? 초안이 다시 생성돼요.")) return;
    setDraftBusy(true);
    try {
      const r = await fetch(`/api/results/monthly-report/draft?${reportQuery}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "삭제 실패");
      setDraftData(d);
      showToast("저장된 보고서를 삭제했어요");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
    }
  }

  function copyDraft() {
    void navigator.clipboard.writeText(draftText).then(() => showToast("복사됐어요"));
  }

  function printDash() {
    showToast("인쇄 창에서 PDF로 저장하고 배경 그래픽을 켜주세요");
    window.setTimeout(() => window.print(), 400);
  }

  return (
    <div className="qms-page-body mx-auto max-w-[1280px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <Text as="p" textStyle="t2Bold" color="fg.neutralSubtle">
            품질평가
          </Text>
          <Text as="h1" textStyle="t9Bold" color="fg.neutral">
            월간 리포트
          </Text>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
            월마감 대시보드와 보고서 초안이에요. 확정된 품질평가 결과로 집계해요.
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="neutralWeak" size="small" loading={validating} onClick={() => void refresh()}>
            <PrefixIcon svg={<IconArrow2ClockwiseCircularLine />} />
            새로고침
          </ActionButton>
          <ActionButton variant="neutralOutline" size="small" onClick={printDash} disabled={!selected}>
            <Printer className="h-4 w-4" />
            PDF로 출력
          </ActionButton>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <ChipTabsRoot value={tab} onValueChange={(v) => setTab(v as TabId)} variant="neutralSolid" size="medium">
          <ChipTabsList>
            {TABS.map((t) => (
              <ChipTabsTrigger key={t.id} value={t.id}>
                {t.label}
              </ChipTabsTrigger>
            ))}
          </ChipTabsList>
        </ChipTabsRoot>
        <FilterSelect
          label="대상 월"
          value={month}
          onChange={(v) => {
            setMonth(v);
            setItemDrill(null);
            setRepeatDrill(null);
          }}
          options={monthOptions}
          allLabel="월 선택"
          allowEmpty={false}
        />
        <FilterSelect
          label="팀"
          value={team}
          onChange={setTeam}
          options={teamOptions}
          allLabel="전사"
        />
      </div>

      {error ? (
        <Callout
          tone="critical"
          title="월간 리포트를 불러오지 못했어요"
          description={error}
          linkProps={{ children: "다시 시도", onClick: () => void refresh() }}
        />
      ) : loading && !data ? (
        <div className="flex justify-center py-16">
          <ProgressCircle size="24" />
        </div>
      ) : tab === "dash" ? (
        !selected ? (
          <Empty>해당 월의 확정 평가 결과가 아직 없어요</Empty>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <KpiCard
                label="HOT"
                value={String(pc?.hot ?? 0)}
                unit={pc?.basis.startsWith("통합") ? "명" : "건"}
                tone="hot"
                caption={`${hotRate.toFixed(1)}%${
                  deltaPp != null
                    ? ` · 전월대비 ${deltaPp > 0 ? "▲" : deltaPp < 0 ? "▼" : "-"}${Math.abs(deltaPp).toFixed(1)}%p`
                    : ""
                }`}
              />
              <KpiCard
                label="COLD"
                value={String(pc?.cold ?? 0)}
                unit={pc?.basis.startsWith("통합") ? "명" : "건"}
                tone="cold"
                caption={`총 ${total} 중`}
              />
              <KpiCard
                label="MELT"
                value={String(pc?.melt ?? 0)}
                unit={pc?.basis.startsWith("통합") ? "명" : "건"}
                tone="melt"
                caption="Hot/Cold와 별개 지표 · 중복 가능"
              />
            </div>
            <p className="text-[11px] text-[var(--fg-tertiary)]">
              기준: {pc?.basis}
              {team ? ` · "${team}" 팀만 보는 중` : ""}
            </p>

            <Panel
              title="팀별 HOT 비중 (이번 달)"
              sub="위험 50% 미만 · 주의 50~74% · 양호 75% 이상. 점선은 팀 평균."
            >
              <label className="mb-3 flex items-center gap-2 text-[12.5px] print:hidden">
                <input
                  type="checkbox"
                  checked={splitAudit}
                  onChange={(e) => setSplitAudit(e.target.checked)}
                />
                심사/운영 나눠서 보기 (끄면 팀 전체 합산 한 줄로)
              </label>
              {teamChartRows.length ? (
                <div>
                  <HBars rows={teamChartRows} max={100} />
                  <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">팀 평균 {teamAvg.toFixed(1)}%</p>
                </div>
              ) : (
                <Empty>이 달은 팀별 데이터가 없어요</Empty>
              )}
            </Panel>

            <Panel title="팀별 결과">
              {teamRows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="text-[var(--fg-tertiary)]">
                      <tr>
                        {["팀", "Hot", "Cold", "Melt", "합계", "Hot비중", "기준"].map((h) => (
                          <th key={h} className="border-b border-[var(--border-subtle)] px-2 py-1.5 font-bold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamRows.map((r) => (
                        <tr key={r.label}>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5">{r.label}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5 tabular-nums">{r.hot}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5 tabular-nums">{r.cold}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5 tabular-nums">{r.melt}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5 tabular-nums">{r.total}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5 tabular-nums">
                            {r.hotRate.toFixed(1)}%
                          </td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5">{r.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>이 달은 팀별 결과가 없어요</Empty>
              )}
            </Panel>

            <Panel title="상담사별 결과" sub="이름으로 검색해서 특정 상담사를 바로 찾을 수 있어요">
              <input
                id="agentSearch"
                value={agentQ}
                onChange={(e) => setAgentQ(e.target.value)}
                placeholder="이름 검색"
                className="qms-select mb-3 h-8 w-[200px] px-2.5 text-[12.5px] print:hidden"
              />
              {agents.length ? (
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="sticky top-0 bg-[var(--bg-canvas)] text-[var(--fg-tertiary)]">
                      <tr>
                        {["이름", "팀", "통합 판정", "채널별"].map((h) => (
                          <th key={h} className="border-b border-[var(--border-subtle)] px-2 py-1.5 font-bold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((r) => (
                        <tr key={r.key}>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5">{r.name}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5">{r.team}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5">{statusIcon(r.status)}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1.5">{r.chanList}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>이 달은 상담사별 결과가 없어요</Empty>
              )}
            </Panel>

            <Panel title="월별 Hot/Cold/Melt 비중 추이" sub="Cold · Hot · Melt 비중을 쌓은 영역형이에요">
              <TrendChart
                months={trendMonths}
                series={trendSeries}
                variant="area"
                formatValue={(v) => `${v.toFixed(1)}%`}
                tooltipExtra={trendTooltipExtra}
              />
            </Panel>

            <Panel
              title="이번 달 항목별 위반 건수"
              sub="대분류로 묶어서 표시돼요. 막대를 클릭하면 해당 인원 목록이 아래에 나와요."
            >
              <HBars
                rows={itemRows}
                max={Math.max(1, ...itemRows.map((r) => r.value))}
                onClick={(key) => setItemDrill({ label: key, categoryMode })}
              />
              {itemDrill ? (
                <div className="mt-3">
                  <div className="mb-1 text-[12px] font-bold text-[var(--fg-secondary)]">
                    {itemDrill.label} · {drillRows.length}명
                  </div>
                  {drillRows.length ? (
                    <div className="max-h-[240px] overflow-auto">
                      <table className="w-full text-left text-[12.5px]">
                        <thead>
                          <tr className="text-[var(--fg-tertiary)]">
                            {["이름", "팀", "채널", "항목", "건수"].map((h) => (
                              <th key={h} className="border-b border-[var(--border-subtle)] px-2 py-1 font-bold">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {drillRows.map((r, i) => (
                            <tr key={`${r.name}-${r.item}-${i}`}>
                              <td className="border-b border-[var(--border-subtle)] px-2 py-1">{r.name}</td>
                              <td className="border-b border-[var(--border-subtle)] px-2 py-1">{r.team}</td>
                              <td className="border-b border-[var(--border-subtle)] px-2 py-1">{r.channel}</td>
                              <td className="border-b border-[var(--border-subtle)] px-2 py-1">{r.item}</td>
                              <td className="border-b border-[var(--border-subtle)] px-2 py-1 tabular-nums">{r.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>해당하는 인원이 없어요</Empty>
                  )}
                </div>
              ) : null}
            </Panel>

            <Panel title="대분류별 위반 건수 추이 (월별)" sub="여러 달에 걸쳐 교정됐는지 확인할 수 있어요">
              <TrendChart
                months={data?.categoryTrend.map((p) => p.month) ?? []}
                series={catSeries}
                yMax={catMax}
                formatValue={(v) => `${v.toLocaleString("ko-KR")}건`}
              />
            </Panel>

            <Panel
              title="인원별 누적 Cold 횟수"
              sub="저장된 전체 기간의 Cold 케이스를 건 단위로 누적 · 2건 이상 상위 10명. 막대를 클릭하면 월별 내역이 나와요."
            >
              <HBars
                rows={(data?.repeatCold ?? []).map((r) => ({
                  key: r.key,
                  label: r.name,
                  value: r.totalCold,
                  color: "#4A90D9",
                  hint: `${r.totalCold}건`,
                }))}
                max={Math.max(1, ...(data?.repeatCold ?? []).map((r) => r.totalCold))}
                onClick={(key) => setRepeatDrill(data?.repeatCold.find((r) => r.key === key) ?? null)}
              />
              {repeatDrill ? (
                <div className="mt-3">
                  <div className="mb-1 text-[12px] font-bold text-[var(--fg-secondary)]">
                    {repeatDrill.name} · 누적 Cold {repeatDrill.totalCold}건
                  </div>
                  <table className="w-full text-left text-[12.5px]">
                    <thead>
                      <tr className="text-[var(--fg-tertiary)]">
                        {["월", "Hot", "Cold", "Melt"].map((h) => (
                          <th key={h} className="border-b border-[var(--border-subtle)] px-2 py-1 font-bold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {repeatDrill.byMonth.map((r) => (
                        <tr key={r.month}>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1">{r.month}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1 tabular-nums">{r.H}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1 tabular-nums">{r.C}</td>
                          <td className="border-b border-[var(--border-subtle)] px-2 py-1 tabular-nums">{r.M}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Panel>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {draftError ? (
            <Callout tone="critical" title="보고서 초안을 불러오지 못했어요" description={draftError} />
          ) : null}
          {draftLoading && !draft ? (
            <div className="flex justify-center py-16">
              <ProgressCircle size="24" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-bold ${
                    draftSaved ? "bg-[#EEF6EC] text-[#2E7D32]" : "bg-[var(--bg-muted)] text-[var(--fg-tertiary)]"
                  }`}
                >
                  {draftSaved ? "저장된 보고서" : "자동 생성 초안 (미저장)"}
                  {team ? ` (${team})` : ""}
                </span>
                {draftValidating ? <ProgressCircle size="24" /> : null}
              </div>
              <p className="text-[12px] leading-relaxed text-[var(--fg-tertiary)]">
                선택된 월 기준 보고서예요. 마크다운 표 형이라 노션에 그대로 붙여넣기 가능해요. 필요한 부분은 직접
                수정해서 쓰세요.
              </p>
              <CollapsibleSection title="평가 특이사항">
                <label className="mb-1.5 block text-[12px] font-semibold text-[var(--fg-secondary)]">
                  이번 달 평가 특이사항 (정책 변경·평가 유예·제외 대상 등 — 직접 입력)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => void saveNotes()}
                  placeholder="예: 26년 4월부터 예절·화법 정상 평가 도입 / 고객요구 재진술 평가 유예"
                  className="min-h-[70px] w-full rounded-[8px] border border-[var(--border-subtle)] p-2.5 text-[12.5px]"
                />
              </CollapsibleSection>
              <CollapsibleSection title="초안 편집" defaultOpen={false}>
                <textarea
                  value={draftText}
                  onChange={(e) => {
                    setDraftText(e.target.value);
                    setDraftSaved(false);
                  }}
                  spellCheck={false}
                  className="min-h-[340px] w-full rounded-[8px] border border-[var(--border-subtle)] p-3 font-mono text-[12.5px] leading-relaxed"
                />
              </CollapsibleSection>
              <CollapsibleSection title="미리보기">
                <ReportMarkdownPreview text={draftText} />
              </CollapsibleSection>
              <div className="flex flex-wrap gap-2 print:hidden">
                <ActionButton variant="neutralOutline" size="small" loading={draftBusy} onClick={() => void regenerateDraft()}>
                  초안 재생성
                </ActionButton>
                <ActionButton size="small" loading={draftBusy} onClick={() => void saveDraft()}>
                  이 보고서 저장
                </ActionButton>
                <ActionButton variant="neutralOutline" size="small" onClick={copyDraft}>
                  복사하기
                </ActionButton>
                <ActionButton variant="neutralWeak" size="small" loading={draftBusy} onClick={() => void deleteDraft()}>
                  저장된 보고서 삭제
                </ActionButton>
                <ActionButton variant="neutralWeak" size="small" onClick={() => void refreshDraft()}>
                  다시 불러오기
                </ActionButton>
              </div>
            </>
          )}
        </div>
      )}

      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[var(--fg-secondary)] px-4 py-2 text-[12.5px] text-white">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

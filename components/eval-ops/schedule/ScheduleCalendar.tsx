"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PrefixIcon } from "@seed-design/react";
import { IconPlusFill } from "@karrotmarket/react-monochrome-icon";
import { ActionButton } from "seed-design/ui/action-button";
import type { EvalOpsPersonalEvent, EvalOpsScheduleBoardItem } from "@/lib/evalOpsScheduleStore";
import {
  addDays,
  assignLanes,
  completionState,
  diffDays,
  fmtYmd,
  teamColor,
} from "@/lib/evalOpsSchedule";

export type DragMode = "assign" | "move" | "resize-start" | "resize-end";

export type DragState = {
  mode: DragMode;
  id: string;
  fromDate?: string;
};

type Props = {
  month: string; // yyyy-MM
  items: EvalOpsScheduleBoardItem[];
  personal: EvalOpsPersonalEvent[];
  dragState: DragState | null;
  setDragState: (s: DragState | null) => void;
  onItemDates: (id: string, start: string, end: string) => void;
  onCancelSchedule: (id: string) => void;
  onOpenPersonal: (id: string | null, defaultDate: string | null) => void;
  onAddPersonalClick: () => void;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function ScheduleCalendar({
  month,
  items,
  personal,
  dragState,
  setDragState,
  onItemDates,
  onCancelSchedule,
  onOpenPersonal,
  onAddPersonalClick,
}: Props) {
  const justDragged = useRef(false);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [yStr, mStr] = month.split("-");
  const yv = Number(yStr);
  const mv = Number(mStr);
  const teams = useMemo(() => [...new Set(items.map((i) => i.teamName))], [items]);

  useEffect(() => {
    if (!dragState) setDragOverDate(null);
  }, [dragState]);

  const laneMap = useMemo(() => {
    return assignLanes([
      ...items
        .filter((d) => d.startDate)
        .map((d) => ({
          id: d.id,
          start: d.startDate!,
          end: d.endDate || d.startDate!,
        })),
      ...personal
        .filter((e) => e.startDate)
        .map((e) => ({
          id: e.id,
          start: e.startDate,
          end: e.endDate || e.startDate,
        })),
    ]);
  }, [items, personal]);

  const startDow = new Date(yv, mv - 1, 1).getDay();
  const daysInMonth = new Date(yv, mv, 0).getDate();
  const todayStr = fmtYmd(new Date());

  const onDayDrop = (ds: string) => {
    setDragOverDate(null);
    if (!dragState) return;
    const item = items.find((d) => d.id === dragState.id);
    if (!item) {
      setDragState(null);
      return;
    }
    if (dragState.mode === "assign") {
      onItemDates(item.id, ds, ds);
    } else if (dragState.mode === "move" && item.startDate) {
      const dur = diffDays(item.startDate, item.endDate || item.startDate);
      const offset = diffDays(item.startDate, dragState.fromDate || item.startDate);
      const newStart = addDays(ds, -offset);
      onItemDates(item.id, newStart, addDays(newStart, dur));
    } else if (dragState.mode === "resize-start" && item.startDate) {
      const end = item.endDate || item.startDate;
      onItemDates(item.id, ds <= end ? ds : end, ds <= end ? end : ds);
    } else if (dragState.mode === "resize-end" && item.startDate) {
      const start = item.startDate;
      onItemDates(item.id, ds >= start ? start : ds, ds >= start ? ds : start);
    }
    setDragState(null);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 300);
  };

  const cells: ReactNode[] = [];
  for (let i = 0; i < startDow; i++) {
    cells.push(<div key={`pad-s-${i}`} className="min-h-[110px] bg-[var(--bg-subtle)]" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${yv}-${String(mv).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(yv, mv - 1, day).getDay();
    const isToday = ds === todayStr;

    const evItems = items.filter(
      (d) => d.startDate && d.startDate <= ds && (d.endDate || d.startDate) >= ds,
    );
    const evPersonal = personal.filter(
      (e) => e.startDate && e.startDate <= ds && (e.endDate || e.startDate) >= ds,
    );
    const allEvs = [...evItems, ...evPersonal];
    const maxLane = allEvs.length ? Math.max(...allEvs.map((d) => laneMap[d.id] || 0)) : -1;

    const lanes: ReactNode[] = [];
    for (let l = 0; l <= maxLane; l++) {
      const ev = allEvs.find((d) => (laneMap[d.id] || 0) === l);
      if (!ev) {
        lanes.push(<div key={`empty-${ds}-${l}`} className="h-[22px]" />);
        continue;
      }
      const isPersonal = !("teamName" in ev);
      if (isPersonal) {
        const e = ev as EvalOpsPersonalEvent;
        const isStart = e.startDate === ds;
        const isEnd = (e.endDate || e.startDate) === ds;
        const showLabel = isStart || dow === 0;
        lanes.push(
          <div key={e.id} className="h-[22px] px-0.5">
            <button
              type="button"
              className={`flex h-full w-full items-center overflow-hidden border border-dashed border-white/50 px-1 text-left text-[10px] font-semibold text-white ${
                isStart ? "rounded-l-md" : ""
              } ${isEnd ? "rounded-r-md" : ""}`}
              style={{ background: e.color || "#64748b" }}
              title={`${e.title} — 클릭하여 수정`}
              onClick={() => onOpenPersonal(e.id, null)}
            >
              {showLabel ? <span className="truncate">📌 {e.title}</span> : null}
            </button>
          </div>,
        );
      } else {
        const d = ev as EvalOpsScheduleBoardItem;
        const isStart = d.startDate === ds;
        const isEnd = (d.endDate || d.startDate) === ds;
        const showLabel = isStart || dow === 0;
        const state = completionState(d);
        const bg =
          state === "selfDone" ? "#6b7280" : state === "evalDone" ? "#9ca3af" : teamColor(d.teamName, teams);
        lanes.push(
          <div key={d.id} className="h-[22px] px-0.5">
            <div
              className={`flex h-full w-full items-center gap-0.5 overflow-hidden text-[10px] font-semibold text-white ${
                isStart ? "rounded-l-md" : ""
              } ${isEnd ? "rounded-r-md" : ""}`}
              style={{ background: bg }}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                justDragged.current = true;
                setDragState({ mode: "move", id: d.id, fromDate: ds });
                e.dataTransfer.effectAllowed = "move";
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (justDragged.current) return;
                onCancelSchedule(d.id);
              }}
              title={`${d.teamName} ${d.evalType} ${d.roundLabel} ${d.channel} ${d.totalCount}건 — 더블클릭하면 일정 취소`}
            >
              {isStart ? (
                <span
                  className="cursor-ew-resize bg-white/35 px-0.5"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    justDragged.current = true;
                    setDragState({ mode: "resize-start", id: d.id });
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  ◀
                </span>
              ) : null}
              {showLabel ? (
                <span className="min-w-0 flex-1 truncate px-0.5">
                  <span className="mr-0.5 rounded bg-black/20 px-0.5">{d.evalType === "직무" ? "직" : "CS"}</span>
                  {d.teamName} {d.channel} {d.totalCount}건
                </span>
              ) : (
                <span className="flex-1" />
              )}
              {isEnd ? (
                <span
                  className="cursor-ew-resize bg-white/35 px-0.5"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    justDragged.current = true;
                    setDragState({ mode: "resize-end", id: d.id });
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  ▶
                </span>
              ) : null}
            </div>
          </div>,
        );
      }
    }

    const isDragOver = dragOverDate === ds;
    cells.push(
      <div
        key={ds}
        className={`relative min-h-[110px] border-b border-r border-[var(--border-subtle)] p-1 ${
          dragState ? "cursor-copy" : ""
        } ${isDragOver ? "bg-[#fff4ec]" : "bg-white"}`}
        style={
          isDragOver
            ? { boxShadow: "inset 0 0 0 2px var(--brand, #ff6f0f)" }
            : undefined
        }
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dragOverDate !== ds) setDragOverDate(ds);
        }}
        onDragLeave={(e) => {
          // Ignore leave into a child inside this cell
          const related = e.relatedTarget as Node | null;
          if (related && e.currentTarget.contains(related)) return;
          if (dragOverDate === ds) setDragOverDate(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDayDrop(ds);
        }}
      >
        <div className="mb-1 flex items-center gap-1 px-1">
          <span
            className={`text-[12px] font-bold ${
              isToday
                ? "rounded-full bg-[var(--brand)] px-1.5 text-white"
                : "text-[var(--fg-tertiary)]"
            }`}
          >
            {day}
          </span>
          <button
            type="button"
            className="text-[11px] text-[var(--fg-tertiary)] hover:text-blue-600"
            title="내 일정 추가"
            onClick={() => onOpenPersonal(null, ds)}
          >
            ＋
          </button>
        </div>
        <div className="flex flex-col gap-0.5">{lanes}</div>
      </div>,
    );
  }

  const rest = (startDow + daysInMonth) % 7;
  if (rest) {
    for (let i = rest; i < 7; i++) {
      cells.push(<div key={`pad-e-${i}`} className="min-h-[110px] bg-[var(--bg-subtle)]" />);
    }
  }

  return (
    <div className="rounded-[16px] border border-[var(--border-subtle)] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-[15px] font-bold text-[var(--fg-primary)]">
          캘린더 — {yv}년 {mv}월
        </h2>
        <ActionButton size="small" variant="brandSolid" onClick={onAddPersonalClick}>
          <PrefixIcon svg={<IconPlusFill />} />
          내 일정 추가
        </ActionButton>
      </div>
      {teams.length > 0 && (
        <div className="flex flex-wrap gap-3 border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--fg-tertiary)]">
          {teams.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: teamColor(t, teams) }} />
              {t}
            </span>
          ))}
          <span className="text-[var(--fg-tertiary)]">| 바 안의 CS/직 태그로 구분</span>
        </div>
      )}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] py-2 text-center text-[12px] font-bold text-[var(--fg-tertiary)]"
          >
            {d}
          </div>
        ))}
        {cells}
      </div>
    </div>
  );
}

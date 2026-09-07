"use client";

import { useState } from "react";
import { Badge, Text } from "@seed-design/react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { EvalOpsScheduleBoardItem } from "@/lib/evalOpsScheduleStore";
import { splitPerPersonCounts, teamColor, todoBorderColor } from "@/lib/evalOpsSchedule";

type Props = {
  items: EvalOpsScheduleBoardItem[];
  busyId: string | null;
  onPatch: (
    id: string,
    fields: { evalDone?: boolean; leaderDone?: boolean; selfDone?: boolean },
  ) => void;
  onSplit: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd?: () => void;
};

export default function ScheduleTodoPanel({
  items,
  busyId,
  onPatch,
  onSplit,
  onDragStart,
  onDragEnd,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const teams = [...new Set(items.map((i) => i.teamName))];

  if (!items.length) {
    return (
      <div className="rounded-[16px] border border-[var(--border-subtle)] bg-white p-6 text-[13px] text-[var(--fg-tertiary)]">
        저장된 평가 항목이 없습니다. 「배분에서 불러오기」로 확정 배분을 가져오세요.
      </div>
    );
  }

  return (
    <div className="flex max-h-[calc(100vh-220px)] flex-col gap-2 overflow-auto pr-1">
      {items.map((d) => {
        const open = !!expanded[d.id];
        const border = todoBorderColor(d, teams);
        const color = teamColor(d.teamName, teams);
        const canSplit = !!splitPerPersonCounts(d.perPersonCount);
        const busy = busyId === d.id;

        return (
          <div
            key={d.id}
            className="rounded-[12px] border border-[var(--border-subtle)] bg-white shadow-sm"
            style={{ borderLeftWidth: 4, borderLeftColor: border }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              onDragStart(d.id);
            }}
            onDragEnd={() => onDragEnd?.()}
          >
            <button
              type="button"
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
              onClick={() => setExpanded((s) => ({ ...s, [d.id]: !open }))}
            >
              <span className="mt-0.5 shrink-0 text-[var(--fg-tertiary)]" title="드래그하여 캘린더에 배치">
                <GripVertical className="h-4 w-4" />
              </span>
              <span className="mt-0.5 shrink-0 text-[var(--fg-tertiary)]">
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <b className="text-[13px]" style={{ color }}>
                    {d.teamName || "(팀 없음)"}
                  </b>
                  <Badge tone={d.evalType === "CS" ? "informative" : "neutral"} variant="weak">
                    {d.evalType}
                  </Badge>
                  <span className="text-[12px] text-[var(--fg-secondary)]">{d.roundLabel}</span>
                  {d.channel ? (
                    <span className="text-[12px] text-[var(--fg-tertiary)]">{d.channel}</span>
                  ) : null}
                  {d.startDate ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      배치됨
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-[12px] text-[var(--fg-tertiary)]">
                  <span>
                    {d.memberCount}명 × {d.perPersonCount}건
                  </span>
                  <b className="text-[var(--fg-primary)]">{d.totalCount}건</b>
                </div>
                <Text as="p" textStyle="t5Regular" color="fg.neutralMuted" className="mt-0.5 !text-[11px]">
                  {d.startDate
                    ? `${d.startDate}${d.endDate && d.endDate !== d.startDate ? ` ~ ${d.endDate}` : ""}`
                    : "캘린더로 드래그해서 일정 지정"}
                </Text>
              </div>
            </button>

            <div
              className="flex flex-wrap gap-3 border-t border-[var(--border-subtle)] px-3 py-2 pl-10 text-[12px] text-[var(--fg-secondary)]"
              onClick={(e) => e.stopPropagation()}
            >
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={d.evalDone}
                  onChange={(e) => onPatch(d.id, { evalDone: e.target.checked })}
                />
                평가완료
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={d.leaderDone}
                  disabled={!d.evalDone}
                  onChange={(e) => onPatch(d.id, { leaderDone: e.target.checked })}
                />
                리더검토
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={d.selfDone}
                  disabled={!d.evalDone}
                  onChange={(e) => onPatch(d.id, { selfDone: e.target.checked })}
                />
                본인확정
              </label>
            </div>

            {open && (
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2 pl-10">
                {d.members.length === 0 ? (
                  <p className="text-[12px] text-[var(--fg-tertiary)]">대상자 상세 없음</p>
                ) : (
                  <ul className="space-y-1">
                    {d.members.map((m, i) => (
                      <li
                        key={`${m.memberId || m.memberName}-${i}`}
                        className="flex justify-between gap-2 text-[12px] text-[var(--fg-secondary)]"
                      >
                        <span className="truncate">{m.memberName || m.memberId || "—"}</span>
                        <span className="shrink-0 font-semibold">{m.count}건</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className="qms-btn-secondary mt-3 w-full !h-8 text-[12px] disabled:opacity-40"
                  disabled={busy || !canSplit}
                  title={!canSplit ? "인당 1건인 경우 쪼갤 수 없습니다" : "1회차 / 2회차로 반반 분할"}
                  onClick={() => onSplit(d.id)}
                >
                  해당 평가를 쪼개기
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

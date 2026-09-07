"use client";

import { useState } from "react";
import { Badge, Text } from "@seed-design/react";
import { ActionButton } from "seed-design/ui/action-button";
import type {
  UnconfirmedCaseNode,
  UnconfirmedCurrentMonth,
  UnconfirmedSheetNode,
  UnconfirmedTargetNode,
  UnconfirmedTemplateNode,
  UnconfirmedTeamNode,
} from "@/lib/resultsStore";

const COLS = "minmax(260px,1.8fr) 100px 52px 64px 52px 64px minmax(96px,max-content)";

function statusTone(status: string): "positive" | "warning" {
  const s = status.trim().toLowerCase();
  return s === "confirmed" || s === "evaluated" ? "positive" : "warning";
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const done = statusTone(status) === "positive";
  return (
    <Badge size="medium" variant={done ? "weak" : "outline"} tone={statusTone(status)}>
      {label || "미지정"}
    </Badge>
  );
}

function KindTag({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1 py-px text-[10px] font-semibold leading-4 text-[var(--fg-tertiary)]">
      {children}
    </span>
  );
}

function CountCell({ value, warn }: { value?: number; warn?: boolean }) {
  if (value == null) {
    return (
      <Text as="span" textStyle="t4Medium" color="fg.neutralSubtle">
        —
      </Text>
    );
  }
  return (
    <Text as="span" textStyle="t4Bold" color={warn && value > 0 ? "fg.warning" : "fg.neutral"}>
      {value}
    </Text>
  );
}

function TreeRow({
  depth,
  kind,
  name,
  status,
  statusLabel,
  targetCount,
  openTargetCount,
  caseCount,
  openCaseCount,
  action,
  onToggle,
  onActivate,
  expanded,
}: {
  depth: number;
  kind: string;
  name: string;
  status: string;
  statusLabel: string;
  targetCount?: number;
  openTargetCount?: number;
  caseCount?: number;
  openCaseCount?: number;
  action?: React.ReactNode;
  onToggle?: () => void;
  onActivate?: () => void;
  expanded?: boolean;
}) {
  const clickable = Boolean(onToggle || onActivate);
  const bg =
    depth === 0 ? "bg-[var(--bg-subtle)]" : depth >= 3 ? "bg-[var(--bg-muted,#fafafa)]" : "bg-[var(--bg-canvas)]";
  return (
    <div
      className={`grid items-center gap-2 border-b border-[var(--border-subtle)] px-[18px] py-2 ${bg} ${
        clickable ? "cursor-pointer hover:bg-[var(--bg-subtle)]" : ""
      }`}
      style={{ gridTemplateColumns: COLS }}
      onClick={onToggle ?? onActivate}
    >
      <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
        {onToggle ? (
          <span className="w-3 shrink-0 text-[11px] text-[var(--fg-tertiary)]">{expanded ? "▾" : "▸"}</span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <KindTag>{kind}</KindTag>
        <Text as="span" textStyle={depth <= 1 ? "t4Bold" : "t4Medium"} color="fg.neutral" maxLines={1}>
          {name}
        </Text>
      </span>
      <StatusBadge status={status} label={statusLabel} />
      <CountCell value={targetCount} />
      <CountCell value={openTargetCount} warn />
      <CountCell value={caseCount} />
      <CountCell value={openCaseCount} warn />
      <span className="justify-self-end" onClick={(e) => e.stopPropagation()}>
        {action}
      </span>
    </div>
  );
}

function CaseRows({
  cases,
  depth,
  onCaseClick,
}: {
  cases: UnconfirmedCaseNode[];
  depth: number;
  onCaseClick?: (caseId: string) => void;
}) {
  return (
    <>
      {cases.map((c) => (
        <TreeRow
          key={c.id}
          depth={depth}
          kind="케이스"
          name={c.name}
          status={c.status}
          statusLabel={c.statusLabel}
          onActivate={onCaseClick ? () => onCaseClick(c.id) : undefined}
        />
      ))}
    </>
  );
}

function TargetBlock({
  target,
  depth,
  onCaseClick,
}: {
  target: UnconfirmedTargetNode;
  depth: number;
  onCaseClick?: (caseId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TreeRow
        depth={depth}
        kind="타겟"
        name={target.name}
        status={target.status}
        statusLabel={target.statusLabel}
        caseCount={target.caseCount}
        openCaseCount={target.openCaseCount}
        action={
          target.cases.length ? (
            <ActionButton size="small" variant="neutralWeak" onClick={() => setOpen((v) => !v)}>
              {open ? "접기" : `케이스 ${target.cases.length}`}
            </ActionButton>
          ) : null
        }
      />
      {open ? <CaseRows cases={target.cases} depth={depth + 1} onCaseClick={onCaseClick} /> : null}
    </>
  );
}

function SheetBlock({
  sheet,
  depth,
  onCaseClick,
}: {
  sheet: UnconfirmedSheetNode;
  depth: number;
  onCaseClick?: (caseId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TreeRow
        depth={depth}
        kind="평가표"
        name={sheet.name}
        status={sheet.status}
        statusLabel={sheet.statusLabel}
        targetCount={sheet.targetCount}
        openTargetCount={sheet.openTargetCount}
        caseCount={sheet.caseCount}
        openCaseCount={sheet.openCaseCount}
        action={
          sheet.targets.length ? (
            <ActionButton size="small" variant="neutralWeak" onClick={() => setOpen((v) => !v)}>
              {open ? "접기" : `대상 ${sheet.targets.length}`}
            </ActionButton>
          ) : null
        }
      />
      {open
        ? sheet.targets.map((t) => (
            <TargetBlock key={t.id} target={t} depth={depth + 1} onCaseClick={onCaseClick} />
          ))
        : null}
    </>
  );
}

function TemplateBlock({
  template,
  depth,
  onCaseClick,
}: {
  template: UnconfirmedTemplateNode;
  depth: number;
  onCaseClick?: (caseId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <TreeRow
        depth={depth}
        kind="템플릿"
        name={template.name}
        status={template.status}
        statusLabel={template.statusLabel}
        targetCount={template.targetCount}
        openTargetCount={template.openTargetCount}
        caseCount={template.caseCount}
        openCaseCount={template.openCaseCount}
        onToggle={() => setOpen((v) => !v)}
        expanded={open}
      />
      {open
        ? template.sheets.map((s) => (
            <SheetBlock key={s.id} sheet={s} depth={depth + 1} onCaseClick={onCaseClick} />
          ))
        : null}
    </>
  );
}

function TeamBlock({
  team,
  onCaseClick,
}: {
  team: UnconfirmedTeamNode;
  onCaseClick?: (caseId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <TreeRow
        depth={0}
        kind="팀"
        name={team.name}
        status={team.status}
        statusLabel={team.statusLabel}
        targetCount={team.targetCount}
        openTargetCount={team.openTargetCount}
        caseCount={team.caseCount}
        openCaseCount={team.openCaseCount}
        onToggle={() => setOpen((v) => !v)}
        expanded={open}
      />
      {open
        ? team.templates.map((t) => (
            <TemplateBlock key={t.id} template={t} depth={1} onCaseClick={onCaseClick} />
          ))
        : null}
    </>
  );
}

export function filterOpenTree(tree: UnconfirmedTeamNode[]): UnconfirmedTeamNode[] {
  const empty = { targetCount: 0, openTargetCount: 0, caseCount: 0, openCaseCount: 0 };
  const add = (a: typeof empty, b: typeof empty) => ({
    targetCount: a.targetCount + b.targetCount,
    openTargetCount: a.openTargetCount + b.openTargetCount,
    caseCount: a.caseCount + b.caseCount,
    openCaseCount: a.openCaseCount + b.openCaseCount,
  });
  const sheetOpen = (s: UnconfirmedSheetNode) =>
    s.status.trim().toLowerCase() !== "confirmed" || s.openTargetCount > 0 || s.openCaseCount > 0;

  const out: UnconfirmedTeamNode[] = [];
  for (const team of tree) {
    const templates: UnconfirmedTemplateNode[] = [];
    let teamCounts = empty;
    let sheetCount = 0;
    for (const tpl of team.templates) {
      const sheets = tpl.sheets.filter(sheetOpen);
      if (!sheets.length) continue;
      const counts = sheets.reduce(add, empty);
      templates.push({
        ...tpl,
        sheets,
        ...counts,
        sheetCount: sheets.length,
        openSheetCount: sheets.length,
        status: "open",
        statusLabel: "미확정",
      });
      teamCounts = add(teamCounts, counts);
      sheetCount += sheets.length;
    }
    if (!templates.length) continue;
    out.push({
      ...team,
      templates,
      ...teamCounts,
      sheetCount,
      openSheetCount: sheetCount,
      status: "open",
      statusLabel: "미확정",
    });
  }
  return out;
}

export function EvalStatusTree({
  data,
  onCaseClick,
  emptyLabel = "이 달에 표시할 평가가 없어요",
}: {
  data: UnconfirmedCurrentMonth;
  onCaseClick?: (caseId: string) => void;
  emptyLabel?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl,16px)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
      <div className="border-b border-[var(--border-subtle)] px-[18px] py-3">
        <Text as="p" textStyle="t3Regular" color="fg.neutralMuted">
          팀 → 템플릿 → 평가표까지 기본으로 보여요. 평가 타겟·케이스는 버튼을 눌러 펼치고, 케이스를 누르면 상세가
          열려요. 확정 기준은 회차 confirmed, 대상자·케이스 evaluated예요.
        </Text>
        {data.byEvalStatus.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.byEvalStatus.map((s) => (
              <Badge key={s.status} size="medium" variant="weak" tone="warning">
                {s.label} {s.count}
              </Badge>
            ))}
          </div>
        ) : null}
        {data.truncated ? (
          <div className="mt-2">
            <Text as="p" textStyle="t2Regular" color="fg.warning">
              상세가 많아 일부만 표시해요.
            </Text>
          </div>
        ) : null}
      </div>
      <div className="overflow-auto">
        <div className="min-w-[780px]">
          <div
            className="grid gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-[18px] py-2"
            style={{ gridTemplateColumns: COLS }}
          >
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              항목
            </Text>
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              상태
            </Text>
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              대상
            </Text>
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              미완 대상
            </Text>
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              케이스
            </Text>
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              미완 케이스
            </Text>
            <span />
          </div>
          {data.tree.map((team) => (
            <TeamBlock key={team.id} team={team} onCaseClick={onCaseClick} />
          ))}
          {!data.tree.length ? (
            <div className="px-[18px] py-6 text-center">
              <Text textStyle="t4Regular" color="fg.neutralSubtle">
                {emptyLabel}
              </Text>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

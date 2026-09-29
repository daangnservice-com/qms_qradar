"use client";

import { diffReplyPolishText, type ReplyPolishDiffPart } from "@/lib/replyPolishDiff";

function partClass(part: ReplyPolishDiffPart, side: "left" | "right"): string {
  if (side === "left" && part.removed) {
    return "rounded-[3px] bg-[var(--danger-subtle)] text-[var(--danger)] line-through decoration-[var(--danger)]";
  }
  if (side === "right" && part.added) {
    return "rounded-[3px] bg-[var(--accent-subtle)] text-[var(--accent-fg)]";
  }
  return "";
}

export default function ReplyPolishDiffText(props: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const parts = diffReplyPolishText(props.left, props.right);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Pane label={props.leftLabel} parts={parts} side="left" />
      <Pane label={props.rightLabel} parts={parts} side="right" />
    </div>
  );
}

function Pane({
  label,
  parts,
  side,
}: {
  label: string;
  parts: ReplyPolishDiffPart[];
  side: "left" | "right";
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-bold text-[var(--fg-tertiary)]">{label}</div>
      <pre className="qms-card max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-3 text-[13px] leading-relaxed">
        {parts.map((part, i) => {
          if (side === "left" && part.added) return null;
          if (side === "right" && part.removed) return null;
          const cls = partClass(part, side);
          return cls ? (
            <span key={`${side}-${i}`} className={cls}>
              {part.value}
            </span>
          ) : (
            <span key={`${side}-${i}`}>{part.value}</span>
          );
        })}
      </pre>
    </div>
  );
}

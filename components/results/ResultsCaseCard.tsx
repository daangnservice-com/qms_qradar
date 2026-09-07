"use client";

import { Badge } from "@seed-design/react";
import { CaseContentBlock, RawToggle } from "./ResultsShared";
import type { QmsCaseRow } from "@/lib/resultsStore";

export function ResultsCaseCard({ row }: { row: QmsCaseRow }) {
  return (
    <article className="qms-card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-[var(--fg-primary)]">
          케이스 {row.caseId || row.caseKey}
        </span>
        {row.isCold ? (
          <Badge size="medium" variant="weak" tone="informative">
            Cold
          </Badge>
        ) : String(row.result || "")
            .trim()
            .toLowerCase() === "hot" ? (
          <Badge size="medium" variant="weak" tone="warning">
            Hot
          </Badge>
        ) : (
          <Badge size="medium" variant="weak" tone="neutral">
            {row.result || "—"}
          </Badge>
        )}
        {row.hasWrongScore && (
          <Badge size="medium" variant="weak" tone="critical">
            오답
          </Badge>
        )}
        {row.hasMemo && (
          <Badge size="medium" variant="weak" tone="informative">
            메모
          </Badge>
        )}
        {row.caseStatus && (
          <Badge size="medium" variant="outline" tone="neutral">
            {row.caseStatus}
          </Badge>
        )}
        <span className="text-[11px] text-[var(--fg-tertiary)]">{row.teamLabel}</span>
      </div>

      <CaseContentBlock title="문의 / 케이스 내용" raw={row.caseContent} />

      {row.hasWrongScore ? (
        <div className="rounded-[12px] border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--danger)_6%,white)] p-3">
          <div className="mb-1 text-[11px] font-bold text-[var(--danger)]">오답 항목</div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--fg-primary)]">
            {row.scoreDetail}
          </p>
        </div>
      ) : (
        <p className="text-[12px] text-[var(--fg-tertiary)]">오답 항목 없음</p>
      )}

      {row.hasMemo && (
        <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-3">
          <div className="mb-1 text-[11px] font-bold text-[var(--fg-secondary)]">메모</div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{row.memoDetail}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <RawToggle title="원본 case_scores" raw={row.caseScores} />
        <RawToggle title="원본 case_extra" raw={row.caseExtra} />
        <RawToggle title="원본 evaluation_extra" raw={row.evaluationExtra} />
        <RawToggle title="원본 extra" raw={row.extra} />
      </div>
    </article>
  );
}

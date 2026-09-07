"use client";

import { Fragment, useMemo, useState } from "react";
import { Badge } from "@seed-design/react";
import { formatClock } from "@/lib/format";
import { coerceAtSec, type AtSecSttHint } from "@/lib/atSecNormalize";
import { CS_CHECKLIST } from "@/lib/csChecklist";
import { deriveEvalLabel } from "@/lib/resultParse";
import { maskPII } from "@/lib/pii";
import type { ChecklistEvidence, ChecklistResult, EvaluationResult } from "@/lib/types";
import type { EvalReviewAnnotation } from "@/lib/evalReviewTypes";
import { annotationFinalCold, annotationReviewNeeded } from "@/lib/evalReviewTypes";
import {
  displayReviewNeededLabel,
  hotColdLabel,
  hotColdTone,
  isReviewNeededRaw,
  reviewNeededLabel,
  reviewNeededTone,
} from "@/lib/judgmentUi";
import { AiEvalBlock } from "./AiEvalBlock";

function EvidenceList({
  evidence,
  sttHints,
  onSeek,
}: {
  evidence: ChecklistEvidence[];
  sttHints: AtSecSttHint[];
  onSeek?: (sec: number) => void;
}) {
  if (!evidence?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {evidence.map((e, i) => {
        const atSec = coerceAtSec(e.atSec, { quote: e.quote, stt: sttHints });
        return (
          <li key={i} className="text-[11px] leading-snug text-[var(--fg-secondary)]">
            <button
              type="button"
              className="font-mono text-[var(--info)] hover:underline"
              title="해당 구간으로 이동"
              onClick={(event) => {
                event.stopPropagation();
                onSeek?.(atSec);
              }}
            >
              {formatClock(atSec)}
            </button>{" "}
            “{e.quote}”
          </li>
        );
      })}
    </ul>
  );
}

/**
 * AI 비교·개선 「케이스 상세」와 동일한 형태.
 * 수기 리뷰가 전달되면 항목별 수기 판정도 함께 표시한다.
 */
export default function EvalCaseDetail({
  result,
  conversationId,
  compactHeader,
  humanResult,
  humanFinalLabel,
  match,
  reviews,
  onSeek,
}: {
  result: EvaluationResult;
  conversationId?: string;
  /** 드로어 헤더에 이미 id가 있을 때 패널 안 헤더 축소 */
  compactHeader?: boolean;
  /** 검수 완료 시 파생 수기 검토필요 라벨 */
  humanResult?: string | null;
  /** 수기 최종 Cold/Hot */
  humanFinalLabel?: string | null;
  match?: boolean | null;
  /** 항목별 수기 판정 */
  reviews?: EvalReviewAnnotation[];
  /** evidence 타임스탬프 클릭 시 오디오 이동 */
  onSeek?: (sec: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const ev = result.evaluation;
  const sttHints = useMemo<AtSecSttHint[]>(
    () => (ev?.transcript ?? []).map((s) => ({ atSec: s.atSec, text: s.text })),
    [ev?.transcript],
  );
  const checklist = useMemo(() => {
    return (ev?.csChecklist ?? []).map((c) => ({
      ...c,
      reason: maskPII(c.reason),
      evidence: c.evidence.map((x) => ({
        atSec: coerceAtSec(x.atSec, { quote: x.quote, stt: sttHints }),
        quote: maskPII(x.quote),
      })),
    }));
  }, [ev?.csChecklist, sttHints]);

  const criteriaSnapshot = useMemo(
    () => (result.promptConfig?.criteria?.length ? result.promptConfig.criteria : CS_CHECKLIST),
    [result.promptConfig?.criteria],
  );
  const checklistById = useMemo(() => new Map(checklist.map((c) => [c.id, c])), [checklist]);
  const labelById = useMemo(
    () => new Map(criteriaSnapshot.map((c) => [c.id, c.label])),
    [criteriaSnapshot],
  );
  const humanById = useMemo(() => {
    const occurrence = new Map<number, EvalReviewAnnotation>();
    const conversation = new Map<number, EvalReviewAnnotation>();
    for (const review of reviews ?? []) {
      if (review.criterionId <= 0 || review.judgment === "best") continue;
      if (review.scope === "conversation") {
        const previous = conversation.get(review.criterionId);
        if (!previous || (review.updatedAt || "") >= (previous.updatedAt || "")) {
          conversation.set(review.criterionId, review);
        }
      } else {
        const previous = occurrence.get(review.criterionId);
        if (!previous || (review.updatedAt || "") >= (previous.updatedAt || "")) {
          occurrence.set(review.criterionId, review);
        }
      }
    }
    const out = new Map(occurrence);
    for (const [id, review] of conversation) out.set(id, review);
    return out;
  }, [reviews]);

  const aiLabel = checklist.length ? deriveEvalLabel({ csChecklist: checklist }) : null;
  const violatedCount = checklist.filter((c) => c.violated).length;

  // 기준표 순서 + AI가 반환한 미등록 id. 위반 우선 표시하되 전체 펼칠 수 있게.
  const rows = useMemo(() => {
    const known = criteriaSnapshot.map((c) => {
      const res = checklistById.get(c.id);
      return res
        ? { id: c.id, label: c.label, category: c.category, res }
        : null;
    }).filter(Boolean) as Array<{
      id: number;
      label: string;
      category: string;
      res: ChecklistResult;
    }>;
    const knownIds = new Set(known.map((r) => r.id));
    const extras = checklist
      .filter((c) => !knownIds.has(c.id))
      .map((res) => ({
        id: res.id,
        label: labelById.get(res.id) ?? `평가 ${res.id}`,
        category: "",
        res,
      }));
    const all = [...known, ...extras];
    return all.sort((a, b) => Number(b.res.violated) - Number(a.res.violated));
  }, [checklist, checklistById, criteriaSnapshot, labelById]);

  const cid = conversationId ?? result.conversationId ?? "";

  return (
    <div className="space-y-3 text-[13px] text-[var(--fg-primary)]">
      {!compactHeader && (
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">케이스 상세</div>
          {cid ? (
            <div className="break-all font-mono text-[11px] text-[var(--fg-secondary)]">{cid}</div>
          ) : null}
        </div>
      )}

      <div className={`grid gap-2 ${humanResult ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
        <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-2">
          <div className="text-[10px] text-[var(--fg-tertiary)]">AI 검토</div>
          <div
            className={`font-bold ${
              isReviewNeededRaw(aiLabel) === true
                ? "text-[var(--info)]"
                : isReviewNeededRaw(aiLabel) === false
                  ? "text-[var(--c-carrot-500)]"
                  : ""
            }`}
          >
            {aiLabel ? displayReviewNeededLabel(aiLabel) : "—"}
          </div>
        </div>
        {humanResult ? (
          <>
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-2">
              <div className="text-[10px] text-[var(--fg-tertiary)]">수기 검토</div>
              <div
                className={`font-bold ${
                  isReviewNeededRaw(humanResult) === true
                    ? "text-[var(--info)]"
                    : isReviewNeededRaw(humanResult) === false
                      ? "text-[var(--c-carrot-500)]"
                      : ""
                }`}
              >
                {displayReviewNeededLabel(humanResult)}
              </div>
            </div>
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-2">
              <div className="text-[10px] text-[var(--fg-tertiary)]">수기 최종</div>
              <div
                className={`font-bold ${
                  humanFinalLabel?.toLowerCase() === "cold"
                    ? "text-[var(--info)]"
                    : humanFinalLabel?.toLowerCase() === "hot"
                      ? "text-[var(--c-carrot-500)]"
                      : ""
                }`}
              >
                {humanFinalLabel ? hotColdLabel(humanFinalLabel.toLowerCase() === "cold" ? "cold" : "hot") : "—"}
              </div>
            </div>
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-2">
              <div className="text-[10px] text-[var(--fg-tertiary)]">검토필요 일치</div>
              <div className="font-bold">
                {match == null ? "—" : match ? "일치" : "불일치"}
              </div>
            </div>
          </>
        ) : null}
        <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-2">
          <div className="text-[10px] text-[var(--fg-tertiary)]">AI 검토필요 항목</div>
          <div className="font-bold tabular-nums">
            {checklist.length ? (
              <>
                {violatedCount}
                <span className="text-[11px] font-medium text-[var(--fg-tertiary)]"> / {checklist.length}</span>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>

      {ev?.error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--danger)]/30 bg-[var(--danger-subtle)] p-3 text-[12px] text-[var(--danger)]">
          {ev.error}
        </div>
      ) : null}

      <AiEvalBlock
        scores={ev?.scores}
        metrics={ev?.metrics}
        overallSummary={ev?.overallSummary}
        snapshot={ev?.outputSchemaSnapshot}
        highRiskFlags={ev?.highRiskFlags}
      />

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1.5 text-[11px] font-bold text-[var(--fg-tertiary)]">
          AI 평가 항목 · 클릭 시 reason/evidence
        </div>
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-[var(--fg-tertiary)]">표시할 항목 없음</p>
          ) : (
            <table className="qms-table text-[11px]">
              <thead>
                <tr>
                  <th>id</th>
                  <th>라벨</th>
                  <th>AI</th>
                  <th>수기</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id, label, res }) => {
                  const open = expandedId === id;
                  const reason = res.reason || "";
                  const evidence = res.evidence ?? [];
                  const aiNeeded = res.violated;
                  const humanReview = humanById.get(id);
                  return (
                    <Fragment key={id}>
                      <tr
                        className={open ? "qms-row-active" : ""}
                        onClick={() => setExpandedId(open ? null : id)}
                      >
                        <td className="font-mono">{id}</td>
                        <td className="whitespace-normal break-words" title={label}>
                          {label}
                          {(reason || evidence.length > 0) && (
                            <span className="ml-1 text-[10px] text-[var(--info)]">{open ? "▲" : "▼"}</span>
                          )}
                        </td>
                        <td>
                          {aiNeeded ? (
                            <Badge size="medium" variant="solid" tone={reviewNeededTone(true)}>
                              {reviewNeededLabel(true)}
                            </Badge>
                          ) : (
                            <span className="text-[var(--fg-tertiary)]">-</span>
                          )}
                        </td>
                        <td>
                          {humanReview ? (
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <Badge
                                size="medium"
                                variant="solid"
                                tone={reviewNeededTone(annotationReviewNeeded(humanReview))}
                              >
                                {reviewNeededLabel(annotationReviewNeeded(humanReview))}
                              </Badge>
                              {annotationReviewNeeded(humanReview) ? (
                                <Badge
                                  size="medium"
                                  variant="solid"
                                  tone={hotColdTone(annotationFinalCold(humanReview) ? "cold" : "hot")}
                                >
                                  {hotColdLabel(annotationFinalCold(humanReview) ? "cold" : "hot")}
                                </Badge>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-[var(--fg-tertiary)]">-</span>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="cursor-default bg-[var(--bg-subtle)]">
                          <td colSpan={4} className="!py-2">
                            {reason ? (
                              <p className="text-[11.5px] leading-relaxed text-[var(--fg-secondary)]">
                                <span className="font-semibold text-[var(--fg-tertiary)]">reason </span>
                                {reason}
                              </p>
                            ) : (
                              <p className="text-[11px] text-[var(--fg-tertiary)]">reason 없음</p>
                            )}
                            {evidence.length > 0 ? (
                              <div className="mt-1">
                                <span className="text-[10px] font-semibold text-[var(--fg-tertiary)]">evidence</span>
                                <EvidenceList evidence={evidence} sttHints={sttHints} onSeek={onSeek} />
                              </div>
                            ) : (
                              <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">evidence 없음</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

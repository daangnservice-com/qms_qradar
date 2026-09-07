"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Clipboard, Loader2, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@seed-design/react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatClock } from "@/lib/format";
import { maskPII } from "@/lib/pii";
import {
  resolveCriterionLabel,
  resolveCriterionOptions,
  resolveCriterionReviewScope,
  type CriterionLabelSource,
} from "@/lib/criterionLabel";
import { badgesBySegment, buildSttChecklistBadges, type SttChecklistBadge } from "@/lib/sttChecklistBadges";
import { isAgentSpeakerLabel } from "@/lib/sttSpeaker";
import type { ChecklistResult, TranscriptSegment, SttSource } from "@/lib/types";
import {
  BEST_MARK_CATEGORIES,
  bestMarkLabel,
  annotationReviewNeeded,
  type BestMarkCategoryId,
  type EvalReviewAnnotation,
  type HumanJudgment,
} from "@/lib/evalReviewTypes";
import {
  hotColdLabel,
  hotColdTone,
  reviewNeededLabel,
  reviewNeededTone,
  SOURCE_AI_TONE,
  SOURCE_HUMAN_TONE,
} from "@/lib/judgmentUi";

type CopyMode = "plain" | "markers";
type CopyFeedback = { mode: CopyMode; ok: boolean };

function SttSourceBadge({ source }: { source?: SttSource | null }) {
  if (source !== "local" && source !== "gcp") return null;
  const local = source === "local";
  return (
    <Badge
      size="medium"
      variant="weak"
      tone={local ? "brand" : "neutral"}
      title={local ? "로컬 배치 STT" : "GCP Speech-to-Text"}
    >
      {local ? "로컬 STT" : "GCP STT"}
    </Badge>
  );
}

type DraftHuman = {
  segmentIndex: number;
  atSec: number;
  quote: string;
  criterionId: number;
  bestCategory: BestMarkCategoryId;
  judgment: HumanJudgment;
  comment: string;
};

type DraftAiReview = {
  badgeKey: string;
  criterionId: number;
  reviewNeeded: boolean;
  judgment: HumanJudgment;
  comment: string;
  annotationId?: string;
};

export default function SttReviewPanel({
  conversationId,
  segments,
  checklist,
  criteria,
  reviews,
  onSeek,
  evaluating,
  progressLabel,
  onSaveReview,
  onDeleteReview,
  busy,
  sttSource,
  observeMode = false,
}: {
  conversationId: string;
  segments: TranscriptSegment[];
  checklist?: ChecklistResult[] | null;
  /** 평가 당시 promptConfig.criteria — 하드코딩 CS_CHECKLIST에 없는 id(예: 340 Best) 라벨용 */
  criteria?: CriterionLabelSource[] | null;
  reviews: EvalReviewAnnotation[];
  onSeek?: (sec: number) => void;
  evaluating?: boolean;
  progressLabel?: string | null;
  onSaveReview?: (input: Omit<EvalReviewAnnotation, "annotationId" | "updatedAt" | "updatedBy"> & { annotationId?: string }) => Promise<void>;
  onDeleteReview?: (annotationId: string) => Promise<void>;
  busy?: boolean;
  sttSource?: SttSource | null;
  /** true면 STT·재생만 — 평가/검수 UI 숨김 */
  observeMode?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [hitsOnly, setHitsOnly] = useState(false);
  const [draftHuman, setDraftHuman] = useState<DraftHuman | null>(null);
  const [draftAi, setDraftAi] = useState<DraftAiReview | null>(null);
  const [saving, setSaving] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const criterionOptions = useMemo(() => resolveCriterionOptions(criteria), [criteria]);
  const aiBadges = useMemo(
    () => buildSttChecklistBadges(segments, checklist, criteria),
    [segments, checklist, criteria],
  );
  const aiBySeg = useMemo(() => badgesBySegment(aiBadges), [aiBadges]);

  const humanBySeg = useMemo(() => {
    const m = new Map<number, EvalReviewAnnotation[]>();
    for (const r of reviews) {
      if (r.source !== "human") continue;
      const idx =
        r.segmentIndex != null && r.segmentIndex >= 0
          ? r.segmentIndex
          : nearestSeg(r.atSec, segments);
      if (idx < 0) continue;
      const list = m.get(idx) ?? [];
      list.push(r);
      m.set(idx, list);
    }
    return m;
  }, [reviews, segments]);

  const aiReviewByKey = useMemo(() => {
    const m = new Map<string, EvalReviewAnnotation>();
    for (const r of reviews) {
      if (r.source !== "ai") continue;
      const key = aiReviewKey(r.aiCriterionId, r.atSec, r.aiQuote);
      m.set(key, r);
    }
    return m;
  }, [reviews]);
  const conversationReviewByCriterion = useMemo(() => {
    const m = new Map<number, EvalReviewAnnotation>();
    for (const r of reviews) {
      if (r.scope !== "conversation" || r.criterionId <= 0) continue;
      const prev = m.get(r.criterionId);
      if (!prev || (r.updatedAt || "") >= (prev.updatedAt || "")) m.set(r.criterionId, r);
    }
    return m;
  }, [reviews]);

  const detCount = aiBadges.filter((b) => b.violated).length + reviews.filter((r) => r.source === "human").length;

  async function copyTranscript(mode: CopyMode) {
    const text =
      mode === "plain"
        ? formatPlainTranscript(segments)
        : formatMarkedTranscript(segments, aiBySeg, humanBySeg, aiReviewByKey, conversationReviewByCriterion, criteria);
    const ok = await copyTextToClipboard(text);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    setCopyFeedback({ mode, ok });
    copyResetTimer.current = setTimeout(() => setCopyFeedback(null), ok ? 1600 : 2400);
  }

  if (evaluating) {
    return (
      <div className="qms-run-panel flex min-h-[200px] items-center justify-center gap-2 text-[13px] text-[var(--fg-tertiary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {progressLabel ?? "평가 중…"}
      </div>
    );
  }

  if (!segments.length) {
    return (
      <div className="qms-run-panel flex flex-col">
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[14px] font-bold">STT 상담 내역</div>
            <SttSourceBadge source={sttSource} />
          </div>
          <div className="text-[11px] text-[var(--fg-tertiary)]">
            {observeMode ? "화자 분리" : "화자 분리 · 수기 검수"}
          </div>
        </div>
        <div className="flex min-h-[200px] items-center justify-center px-6 text-center text-[13px] text-[var(--fg-tertiary)]">
          {observeMode
            ? "이 통화의 STT 전사가 아직 없어요."
            : "평가를 실행하면 화자 분리된 STT가 여기에 표시돼요."}
        </div>
      </div>
    );
  }

  const visibleIndexes = segments
    .map((_, i) => i)
    .filter((i) => {
      if (!hitsOnly) return true;
      return (aiBySeg.get(i)?.length ?? 0) > 0 || (humanBySeg.get(i)?.length ?? 0) > 0;
    });

  return (
    <div className="qms-run-panel flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="text-[14px] font-bold">STT 상담 내역</div>
        <SttSourceBadge source={sttSource} />
        {!observeMode && (
          <span className="text-[11px] text-[var(--fg-tertiary)]">화자 분리 · AI/수기 뱃지</span>
        )}
        {!observeMode && detCount > 0 && (
          <span className="rounded-full bg-[var(--accent-subtle)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--c-green-600)]">
            검출/수기 {detCount}건
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-1">
            <CopyIconButton
              title="STT 전문만 복사"
              ariaLabel="STT 전문만 복사"
              status={copyFeedback?.mode === "plain" ? (copyFeedback.ok ? "ok" : "err") : null}
              onClick={() => void copyTranscript("plain")}
            >
              <Clipboard className="h-3.5 w-3.5" />
            </CopyIconButton>
            {!observeMode && (
              <CopyIconButton
                title="STT + 평가 마커 포함 복사"
                ariaLabel="STT와 평가 마커 포함 복사"
                status={copyFeedback?.mode === "markers" ? (copyFeedback.ok ? "ok" : "err") : null}
                onClick={() => void copyTranscript("markers")}
              >
                <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
                  <Clipboard className="h-3.5 w-3.5" />
                  <MessageSquare className="absolute -bottom-1 -right-1.5 h-2.5 w-2.5 fill-[var(--bg-canvas)] text-[var(--fg-secondary)]" strokeWidth={2.5} />
                </span>
              </CopyIconButton>
            )}
          </div>
          {!observeMode && (
            <div className="flex rounded-full bg-[var(--bg-muted)] p-0.5">
              <button
                type="button"
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  !hitsOnly ? "bg-[var(--bg-canvas)] text-[var(--fg-primary)] shadow-sm" : "text-[var(--fg-tertiary)]"
                }`}
                onClick={() => setHitsOnly(false)}
              >
                전체
              </button>
              <button
                type="button"
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  hitsOnly ? "bg-[var(--bg-canvas)] text-[var(--fg-primary)] shadow-sm" : "text-[var(--fg-tertiary)]"
                }`}
                onClick={() => setHitsOnly(true)}
              >
                뱃지만
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 bg-[var(--bg-subtle)] px-4 py-4">
        {visibleIndexes.map((i) => {
          const s = segments[i];
          const isAgent = isAgentSpeakerLabel(s.speaker);
          const text = maskPII(s.text);
          const segAi = aiBySeg.get(i) ?? [];
          const segHuman = humanBySeg.get(i) ?? [];
          return (
            <div
              key={i}
              data-stt-segment-index={i}
              className={`flex w-full gap-2 ${isAgent ? "justify-end" : "justify-start"}`}
            >
              {!isAgent && (
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-sunken)] text-[11px] font-bold text-[var(--fg-secondary)]">
                  고
                </span>
              )}
              <div className={`max-w-[92%] ${isAgent ? "items-end" : "items-start"} flex flex-col gap-1`}>
                <div className="flex items-end gap-1.5">
                  {isAgent && (
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--fg-tertiary)]">
                      {formatClock(s.atSec)}
                    </span>
                  )}
                  <SeekableTranscriptText
                    text={text}
                    atSec={s.atSec}
                    onSeek={onSeek}
                    className={`rounded-[18px] px-3.5 py-2.5 text-left text-[13.5px] leading-relaxed ${
                      isAgent
                        ? "rounded-br-md bg-[var(--brand)] text-white"
                        : "rounded-bl-md bg-[var(--bg-canvas)] text-[var(--fg-primary)] shadow-sm"
                    }`}
                  />
                  {!isAgent && (
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--fg-tertiary)]">
                      {formatClock(s.atSec)}
                    </span>
                  )}
                  {!observeMode && (
                    <button
                      type="button"
                      title="이 구간에 수기 뱃지 추가"
                      disabled={busy || saving}
                      onClick={() =>
                        setDraftHuman({
                          segmentIndex: i,
                          atSec: s.atSec,
                          quote: s.text,
                          criterionId: criterionOptions[0]?.id ?? 407,
                          bestCategory: BEST_MARK_CATEGORIES[0].id,
                          judgment: "cold",
                          comment: "",
                        })
                      }
                      className="mb-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-canvas)] text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {!observeMode && (segAi.length > 0 || segHuman.length > 0) && (
                  <div className={`flex w-full flex-wrap gap-1.5 ${isAgent ? "justify-end" : "justify-start"}`}>
                    {segAi.map((b) => {
                      const rk = aiReviewKey(b.criterionId, b.evidenceAtSec, b.quote);
                      const review =
                        conversationReviewByCriterion.get(b.criterionId) ?? aiReviewByKey.get(rk);
                      return (
                        <AiBadgeChip
                          key={b.key}
                          badge={b}
                          review={review}
                          open={openKey === b.key}
                          onToggle={() => {
                            setOpenKey(openKey === b.key ? null : b.key);
                            setDraftAi({
                              badgeKey: b.key,
                              criterionId: b.criterionId,
                              reviewNeeded:
                                typeof review?.reviewNeeded === "boolean"
                                  ? review.reviewNeeded
                                  : b.violated,
                              judgment: review?.judgment ?? (b.violated ? "cold" : "hot"),
                              comment: review?.comment ?? "",
                              annotationId: review?.annotationId,
                            });
                          }}
                          onSeek={onSeek}
                          draft={openKey === b.key ? draftAi : null}
                          setDraft={setDraftAi}
                          saving={saving}
                          onSave={async () => {
                            if (!draftAi || draftAi.badgeKey !== b.key || !onSaveReview) return;
                            setSaving(true);
                            try {
                              await onSaveReview({
                                annotationId: draftAi.annotationId,
                                conversationId,
                                source: "ai",
                                atSec: b.evidenceAtSec,
                                segmentIndex: b.segmentIndex,
                                criterionId: draftAi.criterionId,
                                reviewNeeded: draftAi.reviewNeeded,
                                judgment: draftAi.reviewNeeded ? draftAi.judgment : "hot",
                                bestCategory: null,
                                comment: draftAi.comment,
                                aiCriterionId: b.criterionId,
                                aiViolated: b.violated,
                                aiQuote: b.quote,
                                aiReason: b.reason,
                                quote: b.quote,
                                scope: resolveCriterionReviewScope(draftAi.criterionId, criteria),
                              });
                              setOpenKey(null);
                            } finally {
                              setSaving(false);
                            }
                          }}
                        />
                      );
                    })}
                    {segHuman.map((r) => (
                      <HumanBadgeChip
                        key={r.annotationId}
                        review={r}
                        criteria={criteria}
                        open={openKey === r.annotationId}
                        onToggle={() => setOpenKey(openKey === r.annotationId ? null : r.annotationId)}
                        onSeek={onSeek}
                        onDelete={async () => {
                          if (!onDeleteReview) return;
                          setSaving(true);
                          try {
                            await onDeleteReview(r.annotationId);
                            setOpenKey(null);
                          } finally {
                            setSaving(false);
                          }
                        }}
                        saving={saving}
                      />
                    ))}
                  </div>
                )}

                {!observeMode && draftHuman?.segmentIndex === i && (
                  <ReviewForm
                    title="수기 뱃지 추가"
                    criterionOptions={criterionOptions}
                    criterionId={draftHuman.criterionId}
                    bestCategory={draftHuman.bestCategory}
                    judgment={draftHuman.judgment}
                    comment={draftHuman.comment}
                    onChange={(patch) => setDraftHuman({ ...draftHuman, ...patch })}
                    saving={saving}
                    onCancel={() => setDraftHuman(null)}
                    onSave={async () => {
                      if (!onSaveReview) return;
                      setSaving(true);
                      try {
                        await onSaveReview({
                          conversationId,
                          source: "human",
                          atSec: draftHuman.atSec,
                          segmentIndex: draftHuman.segmentIndex,
                          criterionId: draftHuman.judgment === "best" ? 0 : draftHuman.criterionId,
                          judgment: draftHuman.judgment,
                          reviewNeeded: draftHuman.judgment === "best" ? null : true,
                          bestCategory: draftHuman.judgment === "best" ? draftHuman.bestCategory : null,
                          comment: draftHuman.comment,
                          aiCriterionId: null,
                          aiViolated: null,
                          aiQuote: null,
                          aiReason: null,
                          quote: draftHuman.quote,
                          scope: resolveCriterionReviewScope(draftHuman.criterionId, criteria),
                        });
                        setDraftHuman(null);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeekableTranscriptText({
  text,
  atSec,
  onSeek,
  className,
}: {
  text: string;
  atSec: number;
  onSeek?: (sec: number) => void;
  className: string;
}) {
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button === 0) {
          pointerStart.current = { x: e.clientX, y: e.clientY };
          dragged.current = false;
        }
      }}
      onPointerMove={(e) => {
        if (!pointerStart.current || dragged.current) return;
        if (Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y) > 4) {
          dragged.current = true;
        }
      }}
      onPointerUp={() => {
        pointerStart.current = null;
      }}
      onPointerCancel={() => {
        pointerStart.current = null;
        dragged.current = false;
      }}
      onClick={(e) => {
        if (dragged.current) {
          e.preventDefault();
          e.stopPropagation();
          dragged.current = false;
          return;
        }
        onSeek?.(atSec);
      }}
      className={`${className} cursor-pointer select-text`}
    >
      {text}
    </button>
  );
}

function nearestSeg(atSec: number, segments: { atSec: number }[]): number {
  if (!segments.length) return -1;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const d = Math.abs(segments[i].atSec - atSec);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function speakerLabel(speaker: string): string {
  if (isAgentSpeakerLabel(speaker)) return "상담사";
  if (/고객|customer|user/i.test(speaker)) return "고객";
  if (/^화자\s*\d+$/i.test(speaker)) return "고객";
  return speaker || "화자";
}

function formatPlainTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${formatClock(s.atSec)}] ${speakerLabel(s.speaker)}: ${maskPII(s.text)}`)
    .join("\n");
}

function formatMarkedTranscript(
  segments: TranscriptSegment[],
  aiBySeg: Map<number, SttChecklistBadge[]>,
  humanBySeg: Map<number, EvalReviewAnnotation[]>,
  aiReviewByKey: Map<string, EvalReviewAnnotation>,
  conversationReviewByCriterion: Map<number, EvalReviewAnnotation>,
  criteria?: CriterionLabelSource[] | null,
): string {
  const lines: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    lines.push(`[${formatClock(s.atSec)}] ${speakerLabel(s.speaker)}: ${maskPII(s.text)}`);
    for (const b of aiBySeg.get(i) ?? []) {
      const review =
        conversationReviewByCriterion.get(b.criterionId) ??
        aiReviewByKey.get(aiReviewKey(b.criterionId, b.evidenceAtSec, b.quote));
      const judgment = b.violated ? "검토 필요" : "검토 불필요";
      let line = `  └ [AI] ${b.criterionId} ${b.label} · ${judgment}`;
      if (review) {
        const needed = annotationReviewNeeded(review);
        line += ` · 수기 ${needed ? "검토 필요" : "검토 불필요"}`;
        if (needed) line += ` · 최종 ${review.judgment === "cold" ? "Cold" : "Hot"}`;
      }
      if (b.reason) line += ` — ${b.reason}`;
      lines.push(line);
      for (const cq of b.contextQuotes ?? []) {
        lines.push(`     맥락(고객): ${maskPII(cq)}`);
      }
      if (b.quote) lines.push(`     evidence: ${maskPII(b.quote)}`);
      if (review?.comment) lines.push(`     수기 코멘트: ${review.comment}`);
    }
    for (const r of humanBySeg.get(i) ?? []) {
      if (r.judgment === "best") {
        let line = `  └ [Best] ${bestMarkLabel(r.bestCategory)}`;
        if (r.comment) line += ` — ${r.comment}`;
        lines.push(line);
        continue;
      }
      let line = `  └ [수기] ${r.criterionId} ${resolveCriterionLabel(r.criterionId, criteria)} · 검토 필요 · 최종 ${r.judgment === "cold" ? "Cold" : "Hot"}`;
      if (r.comment) line += ` — ${r.comment}`;
      lines.push(line);
    }
  }
  return lines.join("\n");
}

function CopyIconButton({
  title,
  ariaLabel,
  status,
  onClick,
  children,
}: {
  title: string;
  ariaLabel: string;
  status?: "ok" | "err" | null;
  onClick: () => void;
  children: ReactNode;
}) {
  const tip = status === "ok" ? "복사됨" : status === "err" ? "복사 실패 — 브라우저 클립보드 권한을 확인해 주세요" : title;
  return (
    <button
      type="button"
      title={tip}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
        status === "ok"
          ? "border-[var(--accent)]/40 bg-[var(--accent-subtle)] text-[var(--c-green-600)]"
          : status === "err"
            ? "border-[var(--danger)]/40 bg-[var(--danger-subtle,var(--brand-subtle))] text-[var(--danger)]"
            : "border-[var(--border-default)] bg-[var(--bg-canvas)] text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
      }`}
    >
      {status === "ok" ? <Check className="h-3.5 w-3.5" /> : status === "err" ? <X className="h-3.5 w-3.5" /> : children}
    </button>
  );
}

function aiReviewKey(criterionId: number | null | undefined, atSec: number, quote: string | null | undefined): string {
  return `${criterionId ?? ""}|${Math.round((atSec || 0) * 10) / 10}|${(quote ?? "").slice(0, 40)}`;
}

function MarkTag({
  tone,
  children,
}: {
  tone: "informative" | "brand" | "critical" | "positive" | "warning" | "neutral";
  children: ReactNode;
}) {
  return (
    <Badge size="medium" variant="solid" tone={tone} className="pointer-events-none shrink-0">
      {children}
    </Badge>
  );
}

function ReviewForm({
  title,
  criterionOptions,
  criterionId,
  bestCategory,
  judgment,
  comment,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  title: string;
  criterionOptions: CriterionLabelSource[];
  criterionId: number;
  bestCategory: BestMarkCategoryId;
  judgment: HumanJudgment;
  comment: string;
  onChange: (
    p: Partial<{ criterionId: number; bestCategory: BestMarkCategoryId; judgment: HumanJudgment; comment: string }>,
  ) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  return (
    <div className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 shadow-sm">
      <div className="mb-2 text-[11px] font-bold text-[var(--fg-tertiary)]">{title}</div>
      <p className="mb-2 text-[10.5px] leading-snug text-[var(--fg-tertiary)]">
        미검출 추가는 검토 필요로 기록됩니다. Cold/Hot은 최종 감안 판정입니다.
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          className={`flex-1 cursor-pointer rounded-md py-1.5 text-[12px] font-bold ${
            judgment === "cold" ? "bg-[var(--info)] text-white" : "bg-[var(--bg-muted)] text-[var(--fg-secondary)]"
          }`}
          onClick={() => onChange({ judgment: "cold" })}
        >
          최종 Cold
        </button>
        <button
          type="button"
          className={`flex-1 cursor-pointer rounded-md py-1.5 text-[12px] font-bold ${
            judgment === "hot" ? "bg-[var(--c-carrot-500)] text-white" : "bg-[var(--bg-muted)] text-[var(--fg-secondary)]"
          }`}
          onClick={() => onChange({ judgment: "hot" })}
        >
          최종 Hot
        </button>
        <button
          type="button"
          className={`flex-1 cursor-pointer rounded-md py-1.5 text-[12px] font-bold ${
            judgment === "best" ? "bg-[var(--warning)] text-white" : "bg-[var(--bg-muted)] text-[var(--fg-secondary)]"
          }`}
          onClick={() => onChange({ judgment: "best" })}
        >
          Best
        </button>
      </div>
      {judgment === "best" ? (
        <>
          <label className="mb-1 mt-2 block text-[10.5px] font-semibold text-[var(--fg-tertiary)]">Best 카테고리</label>
          <select
            className="qms-select !py-1.5 text-[12px]"
            value={bestCategory}
            onChange={(e) => onChange({ bestCategory: e.target.value as BestMarkCategoryId })}
          >
            {BEST_MARK_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label className="mb-1 mt-2 block text-[10.5px] font-semibold text-[var(--fg-tertiary)]">평가 항목</label>
          <select
            className="qms-select !py-1.5 text-[12px]"
            value={criterionId}
            onChange={(e) => onChange({ criterionId: Number(e.target.value) })}
          >
            {criterionOptions.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.id}] {c.label}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="mb-1 mt-2 block text-[10.5px] font-semibold text-[var(--fg-tertiary)]">코멘트</label>
      <textarea
        className="qms-textarea !min-h-[64px] text-[12px]"
        value={comment}
        placeholder={judgment === "best" ? "Best 사례 코멘트 (선택)" : "수기 검수 코멘트"}
        onChange={(e) => onChange({ comment: e.target.value })}
      />
      <div className="mt-2 flex gap-2">
        <button type="button" className="qms-btn-ghost flex-1" disabled={saving} onClick={onCancel}>
          취소
        </button>
        <button type="button" className="qms-btn-primary flex-1" disabled={saving} onClick={onSave}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}

function reviewSummary(review: EvalReviewAnnotation): { needed: boolean; final: "cold" | "hot" | null } {
  if (review.judgment === "best") return { needed: false, final: null };
  const needed = annotationReviewNeeded(review);
  return { needed, final: needed ? (review.judgment === "hot" ? "hot" : "cold") : null };
}

function AiBadgeChip({
  badge,
  review,
  open,
  onToggle,
  onSeek,
  draft,
  setDraft,
  onSave,
  saving,
}: {
  badge: SttChecklistBadge;
  review?: EvalReviewAnnotation;
  open: boolean;
  onToggle: () => void;
  onSeek?: (sec: number) => void;
  draft: DraftAiReview | null;
  setDraft: (d: DraftAiReview | null) => void;
  onSave: () => void;
  saving?: boolean;
}) {
  const needed = badge.violated;
  const reviewed = Boolean(review);
  const human = review ? reviewSummary(review) : null;
  return (
    <div className={`max-w-full ${open ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-[var(--seed-color-stroke-neutral-muted)] bg-[var(--seed-color-bg-layer-default)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--seed-color-fg-neutral)]"
      >
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-muted)] px-1 py-0.5">
          <MarkTag tone={SOURCE_AI_TONE}>AI</MarkTag>
          {needed ? <MarkTag tone={reviewNeededTone(true)}>{reviewNeededLabel(true)}</MarkTag> : null}
        </span>
        {reviewed && human && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand-subtle)] px-1 py-0.5 ring-1 ring-[var(--brand)]/25">
            <MarkTag tone={SOURCE_HUMAN_TONE}>수기</MarkTag>
            <MarkTag tone={reviewNeededTone(human.needed)}>{reviewNeededLabel(human.needed)}</MarkTag>
            {human.final ? <MarkTag tone={hotColdTone(human.final)}>{hotColdLabel(human.final)}</MarkTag> : null}
          </span>
        )}
        <span className="font-mono tabular-nums text-[var(--seed-color-fg-neutral-muted)]">{badge.criterionId}</span>
        <span className="truncate">{badge.label}</span>
      </button>
      {open && draft && (
        <div className="mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-[var(--fg-tertiary)]">AI 검출 · 수기 검수</div>
              <div className="text-[12.5px] font-semibold">{badge.label}</div>
            </div>
            <button
              type="button"
              className="cursor-pointer font-mono text-[11px] font-semibold text-[var(--info)] hover:underline"
              onClick={() => onSeek?.(badge.evidenceAtSec)}
            >
              {formatClock(badge.evidenceAtSec)}
            </button>
          </div>
          {badge.reason && (
            <p className="mt-1 text-[11.5px] text-[var(--fg-secondary)]">
              <span className="font-semibold text-[var(--fg-tertiary)]">AI reason </span>
              {badge.reason}
            </p>
          )}
          {badge.contextQuotes?.length > 0 && (
            <div className="mt-1 space-y-0.5 text-[11.5px] text-[var(--fg-secondary)]">
              <span className="font-semibold text-[var(--fg-tertiary)]">맥락(고객) </span>
              {badge.contextQuotes.map((q, i) => (
                <p key={i}>“{maskPII(q)}”</p>
              ))}
            </div>
          )}
          {badge.quote && (
            <p className="mt-1 text-[11.5px] text-[var(--fg-secondary)]">
              <span className="font-semibold text-[var(--fg-tertiary)]">evidence </span>“{maskPII(badge.quote)}”
            </p>
          )}
          <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="mb-1 text-[10.5px] font-bold text-[var(--fg-tertiary)]">검토 필요 여부</div>
            <div className="flex gap-1">
              <button
                type="button"
                className={`flex-1 rounded-md py-1.5 text-[12px] font-bold ${
                  draft.reviewNeeded ? "bg-[var(--info)] text-white" : "bg-[var(--bg-muted)]"
                }`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    reviewNeeded: true,
                    judgment: draft.judgment === "best" ? "cold" : draft.judgment,
                  })
                }
              >
                필요
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md py-1.5 text-[12px] font-bold ${
                  !draft.reviewNeeded ? "bg-[var(--c-carrot-500)] text-white" : "bg-[var(--bg-muted)]"
                }`}
                onClick={() => setDraft({ ...draft, reviewNeeded: false, judgment: "hot" })}
              >
                불필요 · 과검출
              </button>
            </div>
            {draft.reviewNeeded ? (
              <>
                <div className="mb-1 mt-2 text-[10.5px] font-bold text-[var(--fg-tertiary)]">최종 판정</div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-[12px] font-bold ${
                      draft.judgment === "cold" ? "bg-[var(--info)] text-white" : "bg-[var(--bg-muted)]"
                    }`}
                    onClick={() => setDraft({ ...draft, judgment: "cold" })}
                  >
                    Cold · 감안 불가
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-[12px] font-bold ${
                      draft.judgment === "hot" ? "bg-[var(--c-carrot-500)] text-white" : "bg-[var(--bg-muted)]"
                    }`}
                    onClick={() => setDraft({ ...draft, judgment: "hot" })}
                  >
                    Hot · 감안
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-[10.5px] leading-snug text-[var(--fg-tertiary)]">
                AI가 검토 필요라고 한 것은 과검출입니다. 최종 감점은 없습니다.
              </p>
            )}
            <textarea
              className="qms-textarea mt-2 !min-h-[56px] text-[12px]"
              placeholder="검수 코멘트 (AI가 맞았는지/왜 다른지)"
              value={draft.comment}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
            />
            <button type="button" className="qms-btn-primary mt-2 w-full" disabled={saving} onClick={onSave}>
              {saving ? "저장 중…" : "수기 검수 저장"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HumanBadgeChip({
  review,
  criteria,
  open,
  onToggle,
  onSeek,
  onDelete,
  saving,
}: {
  review: EvalReviewAnnotation;
  criteria?: CriterionLabelSource[] | null;
  open: boolean;
  onToggle: () => void;
  onSeek?: (sec: number) => void;
  onDelete: () => void;
  saving?: boolean;
}) {
  const isBest = review.judgment === "best";
  const human = isBest ? null : reviewSummary(review);
  const title = isBest ? bestMarkLabel(review.bestCategory) : resolveCriterionLabel(review.criterionId, criteria);
  return (
    <div className={`max-w-full ${open ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--brand)]/40 bg-[var(--brand-subtle)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--seed-color-fg-neutral)]"
      >
        {isBest ? (
          <MarkTag tone="warning">Best</MarkTag>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-canvas)] px-1 py-0.5 ring-1 ring-[var(--brand)]/25">
            <MarkTag tone={SOURCE_HUMAN_TONE}>수기</MarkTag>
            <MarkTag tone={reviewNeededTone(true)}>{reviewNeededLabel(true)}</MarkTag>
            {human?.final ? <MarkTag tone={hotColdTone(human.final)}>{hotColdLabel(human.final)}</MarkTag> : null}
            <span className="font-mono tabular-nums text-[var(--seed-color-fg-neutral-muted)]">{review.criterionId}</span>
          </span>
        )}
        <span className="truncate">{title}</span>
      </button>
      {open && (
        <div className="mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-[var(--fg-tertiary)]">
                {isBest ? "Best 마크" : "수기 평가"}
              </div>
              <div className="text-[12.5px] font-semibold">{title}</div>
            </div>
            <button
              type="button"
              className="cursor-pointer font-mono text-[11px] font-semibold text-[var(--info)] hover:underline"
              onClick={() => onSeek?.(review.atSec)}
            >
              {formatClock(review.atSec)}
            </button>
          </div>
          {review.comment && (
            <p className="mt-1.5 text-[11.5px] text-[var(--fg-secondary)]">{review.comment}</p>
          )}
          {review.quote && (
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">“{maskPII(review.quote)}”</p>
          )}
          <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
            <span>
              {review.updatedBy} · {review.updatedAt.slice(0, 19)}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[var(--danger)] hover:underline"
              disabled={saving}
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

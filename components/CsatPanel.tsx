"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, MessageSquareHeart } from "lucide-react";
import { Badge } from "@seed-design/react";
import { maskPII } from "@/lib/pii";
import type { CallQualityOrg } from "@/lib/callQualityOrg";
import {
  buildDsatToolUrl,
  DSAT_TOOL_MAX_RATE,
  isDsatRate,
  type CsatRecord,
} from "@/lib/csat";
import QmsLoadingOverlay from "@/components/QmsLoadingOverlay";

type BadgeTone = "positive" | "warning" | "critical" | "neutral";

/** 5~4점 = 긍정, 3점 = 주의, 2점 이하 = 불만족(DSAT 구간). */
export function csatRateTone(rate: number | null | undefined): BadgeTone {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "neutral";
  if (rate >= 4) return "positive";
  if (rate >= 3) return "warning";
  return "critical";
}

/** 목록·헤더 공용 CSAT 점수 뱃지. 점수가 없으면(설문 미참여) 아무것도 그리지 않는다. */
export function CsatRateBadge({ rate, className }: { rate: number | null | undefined; className?: string }) {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
  const rounded = Math.round(rate);
  return (
    <Badge
      size="medium"
      variant="weak"
      tone={csatRateTone(rate)}
      className={className}
      title={`고객 설문(CSAT) ${rounded}점`}
    >
      CSAT {rounded}
    </Badge>
  );
}

/** 1~3점: DSAT 도구 딥링크. 4~5점: DSAT 아님 뱃지. 점수 없으면 그리지 않는다. */
function DsatToolSlot({
  rate,
  csatId,
  adminUserId,
}: {
  rate: number | null;
  csatId: string;
  adminUserId: string;
}) {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
  if (!isDsatRate(rate, DSAT_TOOL_MAX_RATE)) {
    return (
      <Badge size="medium" variant="weak" tone="neutral" title="고객 설문이 4~5점이라 DSAT 대상이 아닙니다">
        DSAT 아님
      </Badge>
    );
  }
  const href = buildDsatToolUrl(csatId, adminUserId);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="qms-btn-ghost inline-flex !h-7 items-center gap-1 !px-2 text-[11px]"
      title="DSAT 후속 처리 도구 열기"
    >
      <ExternalLink className="h-3 w-3" />
      DSAT 보기
    </a>
  );
}

function Stars({ rate }: { rate: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rate)));
  return (
    <span className="text-[13px] tracking-[1px] text-[var(--warning)]" aria-label={`${filled}점`}>
      {"★".repeat(filled)}
      <span className="text-[var(--border-strong)]">{"★".repeat(5 - filled)}</span>
    </span>
  );
}

function csatFetchUrl({
  conversationId,
  phoneInquiryId,
  org,
  csatId,
}: {
  conversationId?: string | null;
  phoneInquiryId?: string | null;
  org?: CallQualityOrg;
  csatId?: string | null;
}): string | null {
  if ((conversationId || phoneInquiryId) && org) {
    const q = new URLSearchParams({ org });
    if (conversationId) q.set("conversationId", conversationId);
    if (phoneInquiryId) q.set("phoneInquiryId", phoneInquiryId);
    return `/api/call-quality/csat?${q.toString()}`;
  }
  if (csatId) return `/api/evaluations/feedback/csat?csatId=${encodeURIComponent(csatId)}`;
  return null;
}

/**
 * 녹취·인앱 문의 화면의 고객 설문(CSAT) 패널.
 * 설문 미참여 건이 많아 항상 접을 수 있게 두고, 볼 게 있을 때(코멘트·낮은 점수)만 펼친 채로 시작한다.
 */
export default function CsatPanel({
  conversationId,
  phoneInquiryId,
  org,
  csatId,
  inquiryLabel = "상담이력",
}: {
  conversationId?: string | null;
  /** 알고 있으면 넘긴다 — 없으면 서버가 conversationId로 역조회한다. */
  phoneInquiryId?: string | null;
  org?: CallQualityOrg;
  /** 인앱 문의 집계의 csat_id. 없으면 설문 미참여로 본다. */
  csatId?: string | null;
  inquiryLabel?: string;
}) {
  const [csat, setCsat] = useState<CsatRecord | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const dataKey = `${conversationId ?? ""}|${phoneInquiryId ?? ""}|${org ?? ""}|${csatId ?? ""}`;
  const fetchUrl = csatFetchUrl({ conversationId, phoneInquiryId, org, csatId });
  const stale = Boolean(fetchUrl) && loadedKey !== dataKey;

  useEffect(() => {
    if (!fetchUrl) {
      setCsat(null);
      setFailed(false);
      setLoadedKey(dataKey);
      return;
    }

    let alive = true;
    setFailed(false);
    fetch(fetchUrl)
      .then((r) => (r.ok ? (r.json() as Promise<{ csat: CsatRecord | null }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        setCsat(d.csat ?? null);
        const c = d.csat;
        setOpen(Boolean(c && (c.comment.trim() || (typeof c.rate === "number" && c.rate <= 3))));
        setLoadedKey(dataKey);
      })
      .catch(() => {
        if (!alive) return;
        setCsat(null);
        setFailed(true);
        setLoadedKey(dataKey);
      });
    return () => {
      alive = false;
    };
  }, [fetchUrl, dataKey]);

  const negatives = (csat?.choices ?? []).filter((c) => c.sentiment === "negative");

  return (
    <div className="qms-run-panel relative flex flex-col">
      <QmsLoadingOverlay show={stale} label="고객 설문 불러오는 중…" />
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
          aria-expanded={open}
        >
          <MessageSquareHeart className="h-4 w-4 shrink-0 text-[var(--brand)]" />
          <span className="text-[14px] font-bold">고객 설문 (CSAT)</span>
          {stale ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--fg-tertiary)]" />
          ) : csat ? (
            <>
              <CsatRateBadge rate={csat.rate} />
              {negatives.length > 0 && (
                <Badge size="medium" variant="weak" tone="critical">
                  불만족 {negatives.length}
                </Badge>
              )}
              {csat.comment.trim() && (
                <Badge size="medium" variant="weak" tone="neutral">
                  코멘트
                </Badge>
              )}
            </>
          ) : (
            <span className="text-[11px] text-[var(--fg-tertiary)]">
              {failed ? "불러오지 못했어요" : "설문 미참여"}
            </span>
          )}
        </button>
        {csat && (
          <DsatToolSlot rate={csat.rate} csatId={csat.csatId} adminUserId={csat.adminUserId} />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-[var(--fg-tertiary)]"
          aria-label={open ? "고객 설문 접기" : "고객 설문 펼치기"}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          {!csat ? (
            <p className="text-[12px] text-[var(--fg-tertiary)]">
              {failed
                ? "CSAT을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
                : "이 건에 매칭된 설문 응답이 없어요. 고객이 설문에 참여하지 않으면 CSAT은 남지 않습니다."}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {typeof csat.rate === "number" ? (
                  <>
                    <Stars rate={csat.rate} />
                    <span className="text-[13px] font-bold tabular-nums">{Math.round(csat.rate)} / 5</span>
                  </>
                ) : (
                  <span className="text-[12px] text-[var(--fg-tertiary)]">점수 없음</span>
                )}
                <DsatToolSlot rate={csat.rate} csatId={csat.csatId} adminUserId={csat.adminUserId} />
                {csat.resolved != null && (
                  <Badge size="medium" variant="weak" tone={csat.resolved ? "positive" : "warning"}>
                    {csat.resolved ? "해결됨" : "미해결"}
                  </Badge>
                )}
                {csat.isProfane && (
                  <Badge size="medium" variant="weak" tone="critical">
                    비속어
                  </Badge>
                )}
              </div>

              {csat.choices.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                    선택 항목
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {csat.choices.map((c) => (
                      <Badge
                        key={c.key}
                        size="medium"
                        variant="weak"
                        tone={c.sentiment === "negative" ? "critical" : c.sentiment === "positive" ? "positive" : "neutral"}
                        title={c.issueType ? `${c.issueType} 이슈` : c.key}
                      >
                        {c.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {csat.comment.trim() && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                    고객 코멘트
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--bg-subtle)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--fg-primary)]">
                    {maskPII(csat.comment)}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-[var(--fg-tertiary)]">
                {csat.createdAt && <span>응답 {csat.createdAt.slice(0, 19).replace("T", " ")} (KST)</span>}
                {csat.issueType && <span>· 이슈 {csat.issueType}</span>}
                <span className="font-mono">· {inquiryLabel} {csat.phoneInquiryId}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

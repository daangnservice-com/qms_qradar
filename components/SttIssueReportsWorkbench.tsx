"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@seed-design/react";
import { AudioLines, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { buildCallQualityDeepLink } from "@/lib/callQualityDeepLink";
import { maskPII } from "@/lib/pii";
import {
  STT_ISSUE_TYPES,
  sttIssueTypeLabel,
  type SttIssueReport,
  type SttIssueTypeId,
} from "@/lib/sttIssueTypes";

function IssueSnapshot({ report }: { report: SttIssueReport }) {
  const segments = report.segments ?? [];
  if (!report.remoteJobId && !report.sttOptions && segments.length === 0) return null;
  const start = segments.reduce((min, s) => Math.min(min, s.atSec), Number.POSITIVE_INFINITY);
  const end = segments.reduce((max, s) => Math.max(max, s.endSec), 0);
  const low = segments.filter((s) => s.avgLogprob != null && s.avgLogprob < -1).length;
  return (
    <p className="mb-2 break-all font-mono text-[11px] leading-relaxed text-[var(--fg-tertiary)]">
      {report.remoteJobId ? `job ${report.remoteJobId}` : "job 없음"}
      {report.sttOptions ? ` · ${JSON.stringify(report.sttOptions)}` : ""}
      {segments.length
        ? ` · 세그먼트 ${segments.length} · ${start.toFixed(1)}s–${end.toFixed(1)}s · logprob 낮음 ${low}`
        : ""}
    </p>
  );
}

function formatTs(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19).replace("T", " ");
  return d.toLocaleString("ko-KR");
}

export default function SttIssueReportsWorkbench() {
  const [issueType, setIssueType] = useState<SttIssueTypeId | "">("");
  const [reports, setReports] = useState<SttIssueReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (issueType) q.set("issueType", issueType);
    return q.toString();
  }, [issueType]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/call-quality/stt/issues${query ? `?${query}` : ""}`);
      const d = (await r.json()) as { reports?: SttIssueReport[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? "목록을 불러오지 못했어요");
      setReports(d.reports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="qms-page flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">
          <AudioLines className="h-3.5 w-3.5" />
          평가 운영
        </div>
        <h1 className="mt-0.5 text-[20px] font-extrabold tracking-tight">STT 이슈 리포팅</h1>
        <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)]">
          평가 진행에서 리포팅한 STT 이상을 모읍니다. 어떤 엔진(로컬/GCP)으로 나온 전사인지, 당시 원문을 볼 수 있어요.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
        <select
          className="qms-select !h-8 !w-auto min-w-[12rem] text-[12px]"
          value={issueType}
          onChange={(e) => setIssueType((e.target.value || "") as SttIssueTypeId | "")}
        >
          <option value="">이슈 타입 전체</option>
          {STT_ISSUE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" className="qms-btn-ghost !h-8 !px-2 text-[12px]" onClick={() => void load()}>
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
        <span className="text-[11px] text-[var(--fg-tertiary)]">{reports.length}건</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <p className="text-[13px] text-[var(--danger)]">{error}</p>
        ) : loading && reports.length === 0 ? (
          <div className="flex items-center gap-2 py-16 text-[13px] text-[var(--fg-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중…
          </div>
        ) : reports.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-[var(--fg-tertiary)]">리포팅된 STT 이슈가 없어요</p>
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => {
              const open = openId === r.reportId;
              return (
                <li key={r.reportId} className="qms-run-panel overflow-hidden">
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                    onClick={() => setOpenId(open ? null : r.reportId)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-bold">{sttIssueTypeLabel(r.issueType)}</span>
                        <Badge size="medium" variant="weak" tone={r.sttSource === "local" ? "brand" : "neutral"}>
                          {r.sttSource === "local" ? "로컬 STT" : r.sttSource === "gcp" ? "GCP STT" : "STT 미상"}
                        </Badge>
                        {r.agentName ? (
                          <span className="text-[12px] text-[var(--fg-secondary)]">{r.agentName}</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-[var(--fg-tertiary)]">
                        {r.conversationId}
                        {r.callDate ? ` · ${r.callDate}` : ""}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
                        {r.reportedBy} · {formatTs(r.reportedAt)}
                      </div>
                      {r.comment ? (
                        <p className="mt-1.5 text-[12.5px] text-[var(--fg-secondary)]">{r.comment}</p>
                      ) : null}
                    </div>
                    <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[var(--fg-tertiary)] ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className="border-t border-[var(--border-subtle)] px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-bold text-[var(--fg-tertiary)]">리포팅 당시 STT 원문</div>
                        <Link
                          href={buildCallQualityDeepLink(r.conversationId, { from: "stt-issues" })}
                          className="text-[11px] font-semibold text-[var(--info)] hover:underline"
                        >
                          평가 진행에서 열기
                        </Link>
                      </div>
                      <IssueSnapshot report={r} />
                      {r.transcriptText.trim() ? (
                        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-primary)]">
                          {maskPII(r.transcriptText)}
                        </pre>
                      ) : (
                        <p className="text-[12px] text-[var(--fg-tertiary)]">저장된 전사가 없어요.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

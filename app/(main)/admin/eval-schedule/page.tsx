"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { CalendarClock, RefreshCw } from "lucide-react";
import { isAdmin } from "@/lib/adminEmails";
import type { EvalScheduleJob } from "@/lib/evalSchedule";

type SchedulePayload = {
  active: EvalScheduleJob[];
  recent: EvalScheduleJob[];
  generatedAt: string;
};

const STATUS_LABEL: Record<EvalScheduleJob["status"], string> = {
  running: "진행 중",
  completed: "완료",
  failed: "실패",
  rejected_duplicate: "중복 거부",
};

const STEP_LABEL: Record<string, string> = {
  queued: "대기",
  genesys: "녹취 URL",
  download: "다운로드",
  transcode: "변환",
  audio: "오디오",
  analyze: "분석",
  save: "저장",
  done: "완료",
  error: "오류",
};

const PURPOSE_LABEL: Record<string, string> = {
  call_eval: "콜 평가",
  qa_eval: "QA 평가",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(d);
}

function elapsedLabel(createdAt: string, finishedAt: string | null): string {
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}분 ${s}초`;
}

function statusClass(status: EvalScheduleJob["status"]): string {
  switch (status) {
    case "running":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "failed":
      return "bg-red-50 text-red-700 ring-red-200";
    case "rejected_duplicate":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    default:
      return "bg-gray-50 text-gray-600 ring-gray-200";
  }
}

function JobTable({ jobs, empty }: { jobs: EvalScheduleJob[]; empty: string }) {
  if (!jobs.length) {
    return <p className="py-8 text-center text-sm text-gray-400">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <th className="px-4 py-2.5">상태</th>
            <th className="px-4 py-2.5">Conversation</th>
            <th className="px-4 py-2.5">목적</th>
            <th className="px-4 py-2.5">단계</th>
            <th className="px-4 py-2.5">STT</th>
            <th className="px-4 py-2.5">요청자</th>
            <th className="px-4 py-2.5">시작</th>
            <th className="px-4 py-2.5">소요</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.jobId} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-2.5">
                <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${statusClass(j.status)}`}>
                  {STATUS_LABEL[j.status]}
                </span>
              </td>
              <td className="max-w-[180px] truncate px-4 py-2.5 font-mono text-xs text-gray-800" title={j.conversationId}>
                {j.conversationId}
              </td>
              <td className="px-4 py-2.5 text-gray-600">{PURPOSE_LABEL[j.purpose] ?? j.purpose}</td>
              <td className="px-4 py-2.5 text-gray-600">{STEP_LABEL[j.step] ?? j.step}</td>
              <td className="px-4 py-2.5 text-gray-600">
                {j.sttReused == null ? "—" : j.sttReused ? "재활용" : "신규"}
              </td>
              <td className="max-w-[160px] truncate px-4 py-2.5 text-gray-600" title={j.requestedBy ?? undefined}>
                {j.requestedBy ?? "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-500">{fmtDateTime(j.createdAt)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-500">
                {elapsedLabel(j.createdAt, j.finishedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {jobs.some((j) => j.error) && (
        <div className="space-y-1 border-t border-gray-100 px-4 py-3">
          {jobs
            .filter((j) => j.error)
            .map((j) => (
              <p key={`${j.jobId}-err`} className="text-xs text-red-600">
                <span className="font-mono text-gray-400">{j.conversationId.slice(0, 8)}…</span> {j.error}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

export default function EvalSchedulePage() {
  const { data: session, status } = useSession();
  const admin = isAdmin(session?.user?.email);

  const [data, setData] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/eval-schedule");
      if (!res.ok) throw new Error(res.status === 403 ? "접근 권한이 없어요." : `조회 실패 (HTTP ${res.status})`);
      setData((await res.json()) as SchedulePayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회에 실패했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [admin, load]);

  if (status === "loading") {
    return <div className="mx-auto w-full max-w-5xl px-6 py-8 text-sm text-gray-400">불러오는 중…</div>;
  }
  if (!admin) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-gray-500">이 페이지는 관리자만 볼 수 있어요.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <CalendarClock className="h-5 w-5 text-navy" />
            LLM 평가 스케줄
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">
            현재 진행 중인 LLM 평가 호출과 최근 완료·중복 거부 이력을 확인해요. 동일 conversation은 한 건만 진행됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </header>

      {error && <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <div className={`mt-6 space-y-6 ${loading && !data ? "opacity-60" : ""}`}>
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-gray-700">
              진행 중 <span className="font-normal text-gray-400">({data?.active.length ?? 0})</span>
            </h2>
            {data?.generatedAt && (
              <span className="text-[11px] text-gray-400">갱신 {fmtDateTime(data.generatedAt)}</span>
            )}
          </div>
          <JobTable jobs={data?.active ?? []} empty="진행 중인 평가가 없어요" />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white">
          <h2 className="border-b border-gray-100 px-5 py-3.5 text-sm font-semibold text-gray-700">
            최근 이력 <span className="font-normal text-gray-400">(최대 1시간 · 100건)</span>
          </h2>
          <JobTable jobs={data?.recent ?? []} empty="최근 이력이 없어요" />
        </section>
      </div>
    </div>
  );
}

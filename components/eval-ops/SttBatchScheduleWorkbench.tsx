"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  CalendarRange,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
} from "lucide-react";
import { Text } from "@seed-design/react";
import type {
  SttBatchAgentStat,
  SttBatchDailyStat,
  SttBatchJob,
  SttBatchJobStatus,
  SttBatchRun,
  SttBatchSchedule,
  SttBatchScheduleInput,
  SttBatchScheduleStats,
  SttBatchServerHealth,
} from "@/lib/sttBatchTypes";

type Board = {
  schedules: SttBatchSchedule[];
  selectedId: string | null;
  latestRun: SttBatchRun | null;
  jobs: SttBatchJob[];
  agents: SttBatchAgentStat[];
  stats: SttBatchScheduleStats | null;
  targetCallDate: string | null;
  health: SttBatchServerHealth;
};

const STATUS_LABEL: Record<SttBatchJobStatus, string> = {
  pending_upload: "업로드 중",
  queued: "STT 큐",
  running: "전사 중",
  done: "전사 완료",
  failed: "실패",
  skipped: "스킵",
};

function statusClass(s: SttBatchJobStatus): string {
  switch (s) {
    case "done":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "failed":
      return "bg-red-50 text-red-700 ring-red-200";
    case "running":
      return "bg-indigo-50 text-indigo-700 ring-indigo-200";
    case "queued":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "pending_upload":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    default:
      return "bg-gray-50 text-gray-600 ring-gray-200";
  }
}

function fmtDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function padTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function emptyForm(): SttBatchScheduleInput {
  return {
    name: "일일 STT 배치",
    enabled: true,
    hour: 2,
    minute: 0,
    perAgentCount: 3,
    maxTotal: 400,
    callDateOffsetDays: 1,
    minDurationSec: 60,
    maxDurationSec: 900,
    teams: [],
  };
}

export default function SttBatchScheduleWorkbench() {
  const [board, setBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SttBatchScheduleInput>(emptyForm());
  const [runDate, setRunDate] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async (id?: string | null) => {
    const q = id ? `?scheduleId=${encodeURIComponent(id)}` : "";
    const res = await fetch(`/api/eval-ops/stt-batch${q}`, { cache: "no-store" });
    const data = (await res.json()) as Board & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    setBoard(data);
    setSelectedId(data.selectedId);
    if (!runDate && data.targetCallDate) setRunDate(data.targetCallDate);
    return data;
  }, [runDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(selectedId)
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // 최초 1회
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => board?.schedules.find((s) => s.id === selectedId) ?? null,
    [board, selectedId],
  );

  useEffect(() => {
    if (!board) return;
    const tracking = board.jobs.some(
      (j) => j.status === "pending_upload" || j.status === "queued" || j.status === "running",
    );
    if (!tracking && board.latestRun?.status !== "running") return;
    const t = window.setInterval(() => {
      void load(selectedId).catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [board, load, selectedId]);

  const selectSchedule = async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    try {
      const data = await load(id);
      if (data.targetCallDate) setRunDate(data.targetCallDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (s: SttBatchSchedule) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      enabled: s.enabled,
      hour: s.hour,
      minute: s.minute,
      perAgentCount: s.perAgentCount,
      maxTotal: s.maxTotal,
      callDateOffsetDays: s.callDateOffsetDays,
      minDurationSec: s.minDurationSec,
      maxDurationSec: s.maxDurationSec,
      teams: s.teams,
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    setSaveBusy(true);
    try {
      const res = await fetch("/api/eval-ops/stt-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { ...form, id: editingId } : form),
      });
      const data = (await res.json()) as { schedule?: SttBatchSchedule; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFormOpen(false);
      flash(editingId ? "스케줄을 저장했어요" : "스케줄을 만들었어요");
      await load(data.schedule?.id ?? selectedId);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const toggleEnabled = async (s: SttBatchSchedule) => {
    try {
      const res = await fetch("/api/eval-ops/stt-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: s.id,
          name: s.name,
          enabled: !s.enabled,
          hour: s.hour,
          minute: s.minute,
          perAgentCount: s.perAgentCount,
          maxTotal: s.maxTotal,
          callDateOffsetDays: s.callDateOffsetDays,
          minDurationSec: s.minDurationSec,
          maxDurationSec: s.maxDurationSec,
          teams: s.teams,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load(s.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  };

  const runNow = async () => {
    if (!selected) return;
    setRunBusy(true);
    try {
      const res = await fetch("/api/eval-ops/stt-batch/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: selected.id, callDate: runDate || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      flash("배치를 시작했어요. 로컬 STT 큐에 넣는 중입니다. 전사는 서버가 유휴할 때 돌아갑니다.");
      await load(selected.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  };

  const controlNow = async (overrideMinutes: number) => {
    setControlBusy(true);
    try {
      const res = await fetch("/api/eval-ops/stt-batch/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideMinutes }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      flash(overrideMinutes > 0 ? `${overrideMinutes}분간 유휴 창을 무시하고 처리합니다.` : "원래 스케줄로 되돌렸어요.");
      await load(selectedId);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setControlBusy(false);
    }
  };

  const health = board?.health;
  const jobs = board?.jobs ?? [];
  const agents = board?.agents ?? [];
  const latestRun = board?.latestRun ?? null;
  const stats = board?.stats;
  const daily = stats?.daily ?? [];
  const totals = stats?.totals;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <AudioLines className="h-6 w-6 text-[var(--brand)]" />
            <h1 className="text-[22px] font-bold text-[var(--fg-primary)]">STT 배치 스케줄</h1>
          </div>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted" className="mt-1">
            하루 콜을 구성원당 N건 모아 로컬 STT 큐에 넣습니다. 평가 진행의 GCP 온디맨드 STT와는 별도입니다.
            로컬 서버는 유휴 자원이 있을 때만 큐를 처리합니다.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toast ? (
            <span className="text-[12px] text-emerald-600" aria-live="polite">
              {toast}
            </span>
          ) : null}
          <button
            type="button"
            className="qms-btn-secondary inline-flex h-9 items-center gap-1.5 px-3"
            onClick={() => void load(selectedId).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
          </button>
          <button type="button" className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-3" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            스케줄 만들기
          </button>
        </div>
      </div>

      <section className="qms-card flex flex-wrap items-center gap-3 p-4">
        <Server className="h-4 w-4 text-[var(--fg-tertiary)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--fg-primary)]">로컬 STT 서버</p>
          <p className="text-[12px] text-[var(--fg-tertiary)]">
            {health?.configured ? health.baseUrl : "LOCAL_STT_BASE_URL 미설정"}
            {health?.queueDepth != null ? ` · 서버 큐 ${health.queueDepth}건` : ""}
            {health?.gpuUtilPct != null ? ` · GPU ${Math.round(health.gpuUtilPct)}%` : ""}
            {health?.busy ? " · 처리 중" : ""}
          </p>
          {health?.reason ? (
            <p className="mt-0.5 text-[12px] text-[var(--fg-secondary)]">{health.reason}</p>
          ) : null}
        </div>
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${
            health?.ok && health.acceptingWork
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : health?.ok
                ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-red-50 text-red-700 ring-red-200"
          }`}
        >
          {!health?.configured
            ? "미설정"
            : !health?.ok
              ? (health?.error ?? "연결 안 됨")
              : health.acceptingWork
                ? "처리 가능"
                : "대기 중"}
        </span>
        <button
          type="button"
          className="qms-btn-secondary h-9 px-3 text-[12px] disabled:opacity-50"
          disabled={controlBusy || !health?.configured || !health?.ok}
          onClick={() => void controlNow(health?.overrideUntil ? 0 : 60)}
        >
          {health?.overrideUntil ? "스케줄 복귀" : "지금 처리 (60분)"}
        </button>
      </section>

      {error ? <p className="text-[13px] text-red-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="qms-card overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-[13px] font-semibold text-[var(--fg-primary)]">스케줄</p>
            <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{board?.schedules.length ?? 0}개</p>
          </div>
          {(board?.schedules.length ?? 0) === 0 && !loading ? (
            <p className="px-4 py-8 text-center text-[12px] text-[var(--fg-tertiary)]">스케줄을 만들어 주세요.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {(board?.schedules ?? []).map((s) => {
                const active = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
                        active ? "bg-[var(--brand-subtle)]" : "hover:bg-[var(--bg-muted)]"
                      }`}
                      onClick={() => void selectSchedule(s.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-[var(--fg-primary)]">{s.name}</span>
                        <span
                          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                            s.enabled
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : "bg-gray-50 text-gray-500 ring-gray-200"
                          }`}
                        >
                          {s.enabled ? "ON" : "OFF"}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--fg-tertiary)]">
                        매일 {padTime(s.hour, s.minute)} · 구성원당 {s.perAgentCount}콜
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="space-y-4">
          {loading && !selected ? (
            <div className="qms-card flex items-center justify-center gap-2 p-8 text-[13px] text-[var(--fg-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중
            </div>
          ) : !selected ? (
            <div className="qms-card p-8 text-center text-[13px] text-[var(--fg-tertiary)]">
              스케줄을 선택하거나 새로 만들어 주세요.
            </div>
          ) : (
            <>
              <section className="qms-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[16px] font-bold text-[var(--fg-primary)]">{selected.name}</h2>
                    <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
                      매일 {padTime(selected.hour, selected.minute)} KST · 대상일 오프셋 {selected.callDateOffsetDays}일
                      {selected.minDurationSec != null ? ` · ${selected.minDurationSec}s` : " · —"}
                      {" ~ "}
                      {selected.maxDurationSec != null ? `${selected.maxDurationSec}s` : "제한없음"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="qms-btn-secondary inline-flex h-9 items-center gap-1.5 px-3"
                      onClick={() => void toggleEnabled(selected)}
                    >
                      {selected.enabled ? (
                        <>
                          <Pause className="h-4 w-4" /> OFF
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" /> ON
                        </>
                      )}
                    </button>
                    <button type="button" className="qms-btn-secondary h-9 px-3" onClick={() => openEdit(selected)}>
                      수정
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="text-[12px] font-medium text-[var(--fg-secondary)]">
                    대상 콜 날짜
                    <input
                      type="date"
                      className="qms-input mt-1 w-44"
                      value={runDate}
                      onChange={(e) => setRunDate(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-50"
                    disabled={runBusy || !health?.configured}
                    onClick={() => void runNow()}
                  >
                    {runBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
                    지금 시작
                  </button>
                  <p className="text-[11px] text-[var(--fg-tertiary)]">
                    스케줄은 매일 지정 시각에 콜을 큐에 넣습니다. 지금 시작은 선택한 날짜를 바로 넣습니다. 전사는 서버가 유휴할 때만 돌아갑니다.
                  </p>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi label="누적 전사 완료" value={totals?.done ?? 0} hint="이 스케줄로 STT가 끝난 콜" />
                  <Kpi label="누적 실패" value={totals?.failed ?? 0} />
                  <Kpi label="진행 중" value={totals?.inProgress ?? 0} hint="업로드·큐·전사 중" />
                  <Kpi label="누적 선택" value={totals?.selected ?? 0} hint="지금까지 고른 콜 합" />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi label="이번 선택" value={latestRun?.selectedCount ?? 0} hint="최신 실행에서 고른 콜" />
                  <Kpi label="이번 STT 큐" value={latestRun?.queuedCount ?? jobs.filter((j) => j.status === "queued").length} />
                  <Kpi label="이번 실패" value={latestRun?.failedCount ?? jobs.filter((j) => j.status === "failed").length} />
                  <Kpi
                    label="최신 실행"
                    value={latestRun ? 1 : 0}
                    hint={latestRun ? `${latestRun.trigger === "manual" ? "수동" : "스케줄"} · ${latestRun.status}` : "아직 없음"}
                  />
                </div>
              </section>

              {daily.length > 0 ? (
                <section className="qms-card overflow-hidden">
                  <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                    <p className="text-[13px] font-semibold">일별 처리</p>
                    <p className="text-[11px] text-[var(--fg-tertiary)]">콜 대상일 기준 · 전사 완료 건수</p>
                  </div>
                  <div className="px-4 pt-4">
                    <DailyDoneBars daily={daily} />
                  </div>
                  <div className="mt-2 overflow-x-auto border-t border-[var(--border-subtle)]">
                    <table className="w-full min-w-[560px] text-left text-[12px]">
                      <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                        <tr>
                          <th className="px-4 py-2 font-medium">콜 일자</th>
                          <th className="px-4 py-2 font-medium">선택</th>
                          <th className="px-4 py-2 font-medium">전사 완료</th>
                          <th className="px-4 py-2 font-medium">실패</th>
                          <th className="px-4 py-2 font-medium">진행 중</th>
                          <th className="px-4 py-2 font-medium">완료율</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {daily.map((d) => {
                          const rate = d.selected > 0 ? Math.round((d.done / d.selected) * 100) : 0;
                          return (
                            <tr key={d.callDate}>
                              <td className="px-4 py-2.5 font-medium tabular-nums">{d.callDate}</td>
                              <td className="px-4 py-2.5 tabular-nums">{d.selected}</td>
                              <td className="px-4 py-2.5 tabular-nums text-emerald-700">{d.done}</td>
                              <td className="px-4 py-2.5 tabular-nums text-red-600">{d.failed}</td>
                              <td className="px-4 py-2.5 tabular-nums">{d.inProgress}</td>
                              <td className="px-4 py-2.5 tabular-nums text-[var(--fg-tertiary)]">{rate}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="qms-card overflow-hidden">
                <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                  <p className="text-[13px] font-semibold">구성원별</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)]">구성원당 {selected.perAgentCount}콜 · 최신 실행</p>
                </div>
                {agents.length === 0 ? (
                  <p className="px-4 py-6 text-[12px] text-[var(--fg-tertiary)]">이번 실행 데이터가 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-[12px]">
                      <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                        <tr>
                          <th className="px-4 py-2 font-medium">구성원</th>
                          <th className="px-4 py-2 font-medium">팀</th>
                          <th className="px-4 py-2 font-medium">선택</th>
                          <th className="px-4 py-2 font-medium">큐</th>
                          <th className="px-4 py-2 font-medium">실패</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {agents.map((a) => (
                          <tr key={a.agentName}>
                            <td className="px-4 py-2.5">{a.agentName}</td>
                            <td className="px-4 py-2.5">{a.team || "—"}</td>
                            <td className="px-4 py-2.5">
                              {a.selected} / {a.target}
                            </td>
                            <td className="px-4 py-2.5">{a.queued}</td>
                            <td className="px-4 py-2.5">{a.failed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="qms-card overflow-hidden">
                <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                  <p className="text-[13px] font-semibold">큐 트래킹</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)]">
                    등록된 잡은 로컬 STT 서버가 유휴할 때 처리합니다.
                  </p>
                </div>
                {jobs.length === 0 ? (
                  <p className="px-4 py-6 text-[12px] text-[var(--fg-tertiary)]">아직 넣은 콜이 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-[12px]">
                      <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                        <tr>
                          <th className="px-4 py-2 font-medium">conversation</th>
                          <th className="px-4 py-2 font-medium">구성원</th>
                          <th className="px-4 py-2 font-medium">일자</th>
                          <th className="px-4 py-2 font-medium">길이</th>
                          <th className="px-4 py-2 font-medium">상태</th>
                          <th className="px-4 py-2 font-medium">진행</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {jobs.map((d) => (
                          <tr key={d.id}>
                            <td className="px-4 py-2.5 font-mono text-[11px]">{d.conversationId}</td>
                            <td className="px-4 py-2.5">{d.agentName}</td>
                            <td className="px-4 py-2.5">{d.callDate}</td>
                            <td className="px-4 py-2.5">{fmtDuration(d.durationSec)}</td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${statusClass(d.status)}`}
                                title={d.error ?? d.stage ?? undefined}
                              >
                                {STATUS_LABEL[d.status]}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-[11px] text-[var(--fg-tertiary)]">
                              {d.status === "running" && d.progress != null
                                ? `${Math.round(d.progress * 100)}%${d.stage ? ` · ${d.stage}` : ""}`
                                : d.segmentCount != null
                                  ? `${d.segmentCount}세그먼트`
                                  : d.error
                                    ? d.error
                                    : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {formOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saveBusy) setFormOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[16px] border border-[var(--border-subtle)] bg-white p-5 shadow-lg">
            <h3 className="text-[16px] font-bold">{editingId ? "스케줄 수정" : "스케줄 만들기"}</h3>
            <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
              저장해도 바로 돌지는 않습니다. 매일 시각에 돌아가거나, 화면에서 지금 시작을 누르면 큐에 넣습니다.
            </p>

            <label className="mt-4 block text-[12px] font-medium text-[var(--fg-secondary)]">
              이름
              <input
                className="qms-input mt-1 w-full"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                매일 실행 시각 (KST)
                <input
                  type="time"
                  className="qms-input mt-1 w-full"
                  value={padTime(form.hour, form.minute)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":");
                    setForm((f) => ({ ...f, hour: Number(h) || 0, minute: Number(m) || 0 }));
                  }}
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                대상일 오프셋
                <input
                  type="number"
                  min={0}
                  max={14}
                  className="qms-input mt-1 w-full"
                  value={form.callDateOffsetDays}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, callDateOffsetDays: Math.max(0, Number(e.target.value) || 0) }))
                  }
                />
                <span className="mt-1 block text-[11px] font-normal text-[var(--fg-tertiary)]">1이면 전날 콜</span>
              </label>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                구성원당 N콜
                <input
                  type="number"
                  min={1}
                  className="qms-input mt-1 w-full"
                  value={form.perAgentCount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, perAgentCount: Math.max(1, Number(e.target.value) || 1) }))
                  }
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                총 상한
                <input
                  type="number"
                  min={1}
                  className="qms-input mt-1 w-full"
                  value={form.maxTotal}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxTotal: Math.max(1, Number(e.target.value) || 1) }))
                  }
                />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                최소 음성 길이(초)
                <input
                  type="number"
                  min={0}
                  className="qms-input mt-1 w-full"
                  value={form.minDurationSec ?? ""}
                  placeholder="없음"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, minDurationSec: v === "" ? null : Math.max(0, Number(v) || 0) }));
                  }}
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                최대 음성 길이(초)
                <input
                  type="number"
                  min={0}
                  className="qms-input mt-1 w-full"
                  value={form.maxDurationSec ?? ""}
                  placeholder="없음"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, maxDurationSec: v === "" ? null : Math.max(0, Number(v) || 0) }));
                  }}
                />
              </label>
            </div>

            <label className="mt-3 block text-[12px] font-medium text-[var(--fg-secondary)]">
              팀 필터 (쉼표 구분, 비우면 전체)
              <input
                className="qms-input mt-1 w-full"
                value={form.teams.join(", ")}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    teams: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>

            <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--fg-secondary)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              스케줄 자동 실행
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="qms-btn-secondary h-9 px-4" disabled={saveBusy} onClick={() => setFormOpen(false)}>
                취소
              </button>
              <button type="button" className="qms-btn-primary h-9 px-4 disabled:opacity-50" disabled={saveBusy} onClick={() => void saveForm()}>
                {saveBusy ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--fg-tertiary)]" title={hint}>
        {label}
      </p>
      <p className="mt-0.5 text-[20px] font-bold tracking-tight text-[var(--fg-primary)]">{value}</p>
    </div>
  );
}

/** 일별 전사 완료 막대 (외부 차트 라이브러리 없이 SVG 대체). */
function DailyDoneBars({ daily }: { daily: SttBatchDailyStat[] }) {
  // 차트는 시간순(오래된 → 최신)
  const rows = [...daily].reverse();
  const max = Math.max(1, ...rows.map((d) => d.done));
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 140 }}>
      {rows.map((d) => (
        <div
          key={d.callDate}
          className="flex min-w-[28px] flex-1 flex-col items-center justify-end gap-1"
          title={`${d.callDate} · 완료 ${d.done} · 실패 ${d.failed} · 진행 ${d.inProgress}`}
        >
          <span className="text-[10px] tabular-nums text-[var(--fg-tertiary)]">{d.done || ""}</span>
          <div
            className="w-full max-w-[36px] rounded-t bg-[var(--brand)]/80 transition-all hover:bg-[var(--brand)]"
            style={{ height: `${(d.done / max) * 100}px` }}
          />
          <span className="whitespace-nowrap text-[9px] text-[var(--fg-tertiary)]">{d.callDate.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Loader2, Pause, Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Text } from "@seed-design/react";
import type {
  EvalBatchAgentStat,
  EvalBatchJob,
  EvalBatchJobStatus,
  EvalBatchRun,
  EvalBatchSchedule,
  EvalBatchScheduleInput,
  EvalBatchSttRequirement,
} from "@/lib/evalBatchTypes";
import { evalBatchStatusLabel } from "@/lib/evalBatchTypes";

type Board = {
  schedules: EvalBatchSchedule[];
  selectedId: string | null;
  latestRun: EvalBatchRun | null;
  jobs: EvalBatchJob[];
  agents: EvalBatchAgentStat[];
  targetCallDate: string | null;
};

function statusClass(s: EvalBatchJobStatus): string {
  switch (s) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "failed":
      return "bg-red-50 text-red-700 ring-red-200";
    case "running_eval":
    case "queued_eval":
      return "bg-indigo-50 text-indigo-700 ring-indigo-200";
    case "waiting_stt":
    case "pending_stt":
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

const STT_OPTS: Array<{ id: EvalBatchSttRequirement; label: string; hint: string }> = [
  { id: "done", label: "STT 완료만", hint: "전사가 있는 콜만 고릅니다" },
  { id: "pending", label: "STT 미완료만", hint: "고른 콜을 로컬 STT 대기열에 넣습니다" },
  { id: "any", label: "전체", hint: "STT 없는 콜은 로컬 STT 대기열에 넣습니다" },
];

function emptyForm(): EvalBatchScheduleInput {
  return {
    name: "일일 AI 평가",
    enabled: true,
    hour: 6,
    minute: 0,
    perAgentCount: 3,
    maxTotal: 120,
    callDateOffsetDays: 1,
    minDurationMin: 1,
    maxDurationMin: 15,
    teams: [],
    sttRequirement: "done",
  };
}

export default function EvalBatchScheduleWorkbench() {
  const [board, setBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EvalBatchScheduleInput>(emptyForm());
  const [runDate, setRunDate] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async (id?: string | null) => {
    const q = id ? `?scheduleId=${encodeURIComponent(id)}` : "";
    const res = await fetch(`/api/eval-ops/eval-batch${q}`, { cache: "no-store" });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => board?.schedules.find((s) => s.id === selectedId) ?? null,
    [board, selectedId],
  );

  useEffect(() => {
    if (!board) return;
    const tracking = board.jobs.some(
      (j) =>
        j.status === "pending_stt" ||
        j.status === "waiting_stt" ||
        j.status === "queued_eval" ||
        j.status === "running_eval",
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

  const openEdit = (s: EvalBatchSchedule) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      enabled: s.enabled,
      hour: s.hour,
      minute: s.minute,
      perAgentCount: s.perAgentCount,
      maxTotal: s.maxTotal,
      callDateOffsetDays: s.callDateOffsetDays,
      minDurationMin: s.minDurationMin,
      maxDurationMin: s.maxDurationMin,
      teams: s.teams,
      sttRequirement: s.sttRequirement,
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    setSaveBusy(true);
    try {
      const res = await fetch("/api/eval-ops/eval-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { ...form, id: editingId } : form),
      });
      const data = (await res.json()) as { schedule?: EvalBatchSchedule; error?: string };
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

  const toggleEnabled = async (s: EvalBatchSchedule) => {
    try {
      const res = await fetch("/api/eval-ops/eval-batch", {
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
          minDurationMin: s.minDurationMin,
          maxDurationMin: s.maxDurationMin,
          teams: s.teams,
          sttRequirement: s.sttRequirement,
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
      const res = await fetch("/api/eval-ops/eval-batch/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: selected.id, callDate: runDate || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      flash("AI 평가 배치를 시작했어요. STT가 없으면 로컬 대기열에 넣은 뒤 평가합니다.");
      await load(selected.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  };

  const jobs = board?.jobs ?? [];
  const agents = board?.agents ?? [];
  const latestRun = board?.latestRun ?? null;
  const sttLabel = STT_OPTS.find((o) => o.id === selected?.sttRequirement)?.label ?? selected?.sttRequirement;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-[var(--brand)]" />
            <h1 className="text-[22px] font-bold text-[var(--fg-primary)]">AI 평가 배치</h1>
          </div>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted" className="mt-1">
            스케줄 시각에 대상 콜을 골라 Gemini 품질평가를 돌립니다. STT가 없으면 로컬 STT 대기열에 넣은 뒤 이어서
            평가합니다.
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
                        매일 {padTime(s.hour, s.minute)} · 상담원당 {s.perAgentCount}콜
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
                      매일 {padTime(selected.hour, selected.minute)} KST · {sttLabel} · 오프셋{" "}
                      {selected.callDateOffsetDays}일
                      {selected.minDurationMin != null ? ` · ${selected.minDurationMin}분` : " · —"}
                      {" ~ "}
                      {selected.maxDurationMin != null ? `${selected.maxDurationMin}분` : "제한없음"}
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
                    disabled={runBusy}
                    onClick={() => void runNow()}
                  >
                    {runBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
                    지금 시작
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi label="이번 선택" value={latestRun?.selectedCount ?? 0} />
                  <Kpi label="평가 완료" value={latestRun?.completedCount ?? jobs.filter((j) => j.status === "completed").length} />
                  <Kpi label="STT 대기" value={latestRun?.waitingSttCount ?? jobs.filter((j) => j.status === "waiting_stt" || j.status === "pending_stt").length} />
                  <Kpi label="실패" value={latestRun?.failedCount ?? jobs.filter((j) => j.status === "failed").length} />
                </div>
              </section>

              <section className="qms-card overflow-hidden">
                <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                  <p className="text-[13px] font-semibold">상담원별</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)]">상담원당 {selected.perAgentCount}콜 · 최신 실행</p>
                </div>
                {agents.length === 0 ? (
                  <p className="px-4 py-6 text-[12px] text-[var(--fg-tertiary)]">이번 실행 데이터가 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-[12px]">
                      <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                        <tr>
                          <th className="px-4 py-2 font-medium">상담원</th>
                          <th className="px-4 py-2 font-medium">팀</th>
                          <th className="px-4 py-2 font-medium">선택</th>
                          <th className="px-4 py-2 font-medium">완료</th>
                          <th className="px-4 py-2 font-medium">STT 대기</th>
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
                            <td className="px-4 py-2.5">{a.completed}</td>
                            <td className="px-4 py-2.5">{a.waitingStt}</td>
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
                  <p className="text-[13px] font-semibold">평가 트래킹</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)]">STT 대기 중인 콜은 전사가 끝나면 자동으로 LLM 평가를 이어서 돌립니다.</p>
                </div>
                {jobs.length === 0 ? (
                  <p className="px-4 py-6 text-[12px] text-[var(--fg-tertiary)]">아직 넣은 콜이 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-[12px]">
                      <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                        <tr>
                          <th className="px-4 py-2 font-medium">conversation</th>
                          <th className="px-4 py-2 font-medium">상담원</th>
                          <th className="px-4 py-2 font-medium">일자</th>
                          <th className="px-4 py-2 font-medium">길이</th>
                          <th className="px-4 py-2 font-medium">상태</th>
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
                                title={d.error ?? undefined}
                              >
                                {evalBatchStatusLabel(d.status)}
                              </span>
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
              저장해도 바로 돌지는 않습니다. 매일 시각에 돌아가거나, 화면에서 지금 시작을 누르면 평가를 넣습니다.
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

            <fieldset className="mt-3">
              <legend className="text-[12px] font-medium text-[var(--fg-secondary)]">STT 조건</legend>
              <div className="mt-1 flex flex-col gap-1.5">
                {STT_OPTS.map((o) => (
                  <label key={o.id} className="flex items-start gap-2 text-[12px] text-[var(--fg-secondary)]">
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={form.sttRequirement === o.id}
                      onChange={() => setForm((f) => ({ ...f, sttRequirement: o.id }))}
                    />
                    <span>
                      <span className="font-medium text-[var(--fg-primary)]">{o.label}</span>
                      <span className="block text-[11px] text-[var(--fg-tertiary)]">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                상담원당 최대
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
                총 한도
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
                최소 통화 시간(분)
                <input
                  type="number"
                  min={0}
                  className="qms-input mt-1 w-full"
                  value={form.minDurationMin ?? ""}
                  placeholder="없음"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, minDurationMin: v === "" ? null : Math.max(0, Number(v) || 0) }));
                  }}
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                최대 통화 시간(분)
                <input
                  type="number"
                  min={0}
                  className="qms-input mt-1 w-full"
                  value={form.maxDurationMin ?? ""}
                  placeholder="없음"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, maxDurationMin: v === "" ? null : Math.max(0, Number(v) || 0) }));
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

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--fg-tertiary)]">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tracking-tight text-[var(--fg-primary)]">{value}</p>
    </div>
  );
}

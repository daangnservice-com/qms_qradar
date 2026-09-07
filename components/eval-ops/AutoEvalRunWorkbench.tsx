"use client";

import { useMemo, useState } from "react";
import {
  CalendarRange,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  AlertTriangle,
} from "lucide-react";
import { Text } from "@seed-design/react";
import type {
  AutoEvalAgentProgress,
  AutoEvalDispatchRow,
  AutoEvalDispatchStatus,
  AutoEvalRecurrence,
  AutoEvalScheduleDraft,
  AutoEvalScheduleStats,
} from "@/lib/autoEvalRunTypes";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const STATUS_LABEL: Record<AutoEvalDispatchStatus, string> = {
  queued_batch: "배치 대기",
  batch_done: "배치 완료",
  awaiting_ondemand_confirm: "온디맨드 확인 대기",
  running_ondemand: "온디맨드 평가 중",
  completed: "평가 완료",
  failed: "실패",
  skipped_shortage: "샘플 부족 스킵",
};

function statusClass(s: AutoEvalDispatchStatus): string {
  switch (s) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "failed":
      return "bg-red-50 text-red-700 ring-red-200";
    case "awaiting_ondemand_confirm":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "running_ondemand":
    case "queued_batch":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "batch_done":
      return "bg-indigo-50 text-indigo-700 ring-indigo-200";
    default:
      return "bg-gray-50 text-gray-600 ring-gray-200";
  }
}

function recurrenceLabel(r: AutoEvalRecurrence): string {
  if (r.kind === "once") return "1회";
  if (r.kind === "weekly") return `매주 ${WEEKDAYS[r.weekday] ?? "?"}요일`;
  return `매월 ${r.dayOfMonth}일`;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function emptyForm(): Omit<AutoEvalScheduleDraft, "id" | "createdAt" | "updatedAt" | "enabled"> {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const end = new Date(today);
  end.setDate(end.getDate() - 1);
  const start = new Date(today);
  start.setDate(start.getDate() - 14);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return {
    name: `${y}-${m} 주간 자동평가`,
    rangeStart: fmt(start),
    rangeEnd: fmt(end),
    recurrence: { kind: "weekly", weekday: 1 },
    perAgentTarget: 3,
    maxTotal: 120,
    sampleFilter: { minDurationSec: 60, maxDurationSec: 900 },
    sttMode: "v2_dynamic_batch",
  };
}

/** 초안용 목 데이터 — API 연동 전 */
function seedSchedules(): AutoEvalScheduleDraft[] {
  const now = new Date().toISOString();
  return [
    {
      id: "aes-demo-1",
      name: "주간 Cold 샘플 (월)",
      enabled: true,
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-14",
      recurrence: { kind: "weekly", weekday: 1 },
      perAgentTarget: 3,
      maxTotal: 90,
      sampleFilter: { minDurationSec: 90, maxDurationSec: 720 },
      sttMode: "v2_dynamic_batch",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "aes-demo-2",
      name: "월말 보충 배치",
      enabled: false,
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-31",
      recurrence: { kind: "monthly", dayOfMonth: 28 },
      perAgentTarget: 5,
      maxTotal: 200,
      sampleFilter: { minDurationSec: 120, maxDurationSec: null },
      sttMode: "v2_dynamic_batch",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function seedStats(scheduleId: string, perAgent: number): AutoEvalScheduleStats {
  const agents: AutoEvalAgentProgress[] = [
    { agentName: "김상담", target: perAgent, evaluated: 3, availableCandidates: 12, shortage: false },
    { agentName: "이상담", target: perAgent, evaluated: 2, availableCandidates: 8, shortage: false },
    { agentName: "박상담", target: perAgent, evaluated: 1, availableCandidates: 1, shortage: true },
    { agentName: "최상담", target: perAgent, evaluated: 0, availableCandidates: 0, shortage: true },
  ];
  const evaluated = agents.reduce((a, x) => a + x.evaluated, 0);
  return {
    scheduleId,
    goalMet: agents.every((a) => a.evaluated >= a.target || a.shortage),
    agents,
    dispatchedCount: 11,
    completedCount: evaluated,
    pendingBatchCount: 2,
    awaitingConfirmCount: 3,
    shortageAgentCount: agents.filter((a) => a.shortage).length,
  };
}

function seedDispatches(scheduleId: string): AutoEvalDispatchRow[] {
  const base = [
    ["c-1001", "김상담", "completed", 245],
    ["c-1002", "김상담", "completed", 312],
    ["c-1003", "이상담", "awaiting_ondemand_confirm", 188],
    ["c-1004", "이상담", "awaiting_ondemand_confirm", 401],
    ["c-1005", "박상담", "awaiting_ondemand_confirm", 156],
    ["c-1006", "김상담", "queued_batch", 220],
    ["c-1007", "최상담", "skipped_shortage", 0],
  ] as const;
  const now = Date.now();
  return base.map((row, i) => {
    const [conversationId, agentName, status, durationSec] = row;
    return {
      id: `d-${scheduleId}-${i}`,
      scheduleId,
      conversationId,
      agentName,
      callDate: `2026-08-${String(10 + (i % 10)).padStart(2, "0")}`,
      durationSec,
      status: status as AutoEvalDispatchStatus,
      submittedAt: new Date(now - i * 3600_000).toISOString(),
      batchFinishedAt:
        status === "queued_batch" || status === "skipped_shortage"
          ? null
          : new Date(now - i * 1800_000).toISOString(),
      analysisId: status === "completed" ? `an-${i}` : null,
      error: null,
    };
  });
}

const INITIAL_SCHEDULES = seedSchedules();

export default function AutoEvalRunWorkbench() {
  const [schedules, setSchedules] = useState<AutoEvalScheduleDraft[]>(INITIAL_SCHEDULES);
  const [selectedId, setSelectedId] = useState<string | null>(INITIAL_SCHEDULES[0]?.id ?? null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recurrenceKind, setRecurrenceKind] = useState<"once" | "weekly" | "monthly">("weekly");
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(28);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toast, setToast] = useState("");

  const selected = schedules.find((s) => s.id === selectedId) ?? null;
  const stats = useMemo(
    () => (selected ? seedStats(selected.id, selected.perAgentTarget) : null),
    [selected],
  );
  const dispatches = useMemo(
    () => (selected ? seedDispatches(selected.id) : []),
    [selected],
  );
  const awaiting = dispatches.filter((d) => d.status === "awaiting_ondemand_confirm");

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2800);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setRecurrenceKind("weekly");
    setWeekday(1);
    setDayOfMonth(28);
    setFormOpen(true);
  };

  const openEdit = (s: AutoEvalScheduleDraft) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      rangeStart: s.rangeStart,
      rangeEnd: s.rangeEnd,
      recurrence: s.recurrence,
      perAgentTarget: s.perAgentTarget,
      maxTotal: s.maxTotal,
      sampleFilter: { ...s.sampleFilter },
      sttMode: s.sttMode,
    });
    setRecurrenceKind(s.recurrence.kind);
    if (s.recurrence.kind === "weekly") setWeekday(s.recurrence.weekday);
    if (s.recurrence.kind === "monthly") setDayOfMonth(s.recurrence.dayOfMonth);
    setFormOpen(true);
  };

  const saveForm = () => {
    const recurrence: AutoEvalRecurrence =
      recurrenceKind === "once"
        ? { kind: "once" }
        : recurrenceKind === "weekly"
          ? { kind: "weekly", weekday }
          : { kind: "monthly", dayOfMonth: Math.min(28, Math.max(1, dayOfMonth)) };
    const now = new Date().toISOString();
    if (editingId) {
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === editingId
            ? { ...s, ...form, recurrence, updatedAt: now }
            : s,
        ),
      );
      flash("스케줄이 저장됐어요 (초안·로컬)");
    } else {
      const id = `aes-${Date.now()}`;
      const next: AutoEvalScheduleDraft = {
        id,
        enabled: true,
        ...form,
        recurrence,
        createdAt: now,
        updatedAt: now,
      };
      setSchedules((prev) => [next, ...prev]);
      setSelectedId(id);
      flash("스케줄이 만들어졌어요 (초안·로컬)");
    }
    setFormOpen(false);
  };

  const toggleEnabled = (id: string) => {
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled, updatedAt: new Date().toISOString() } : s)),
    );
  };

  const runBatchNow = () => {
    if (!selected) return;
    flash(`「${selected.name}」배치 디스패치 요청 (초안 — API 미연동)`);
  };

  const confirmOndemand = async () => {
    setConfirmBusy(true);
    await new Promise((r) => window.setTimeout(r, 600));
    setConfirmBusy(false);
    setConfirmOpen(false);
    flash(`${awaiting.length}건 온디맨드 평가 시작 (초안 — API 미연동)`);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Rocket className="h-6 w-6 text-[var(--brand)]" />
            <h1 className="text-[22px] font-bold text-[var(--fg-primary)]">자동 평가 실행</h1>
          </div>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted" className="mt-1">
            기간·상담사당 N·상한·음성 길이 조건을 정해 스케줄을 만들고, STT v2 Dynamic Batch로 AI 평가를
            돌립니다. (초안 UI · API 미연동)
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toast ? (
            <span className="text-[12px] text-emerald-600" aria-live="polite">
              {toast}
            </span>
          ) : null}
          <button type="button" className="qms-btn-secondary inline-flex h-9 items-center gap-1.5 px-3" disabled>
            <RefreshCw className="h-4 w-4" />
            새로고침
          </button>
          <button
            type="button"
            className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-3"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            스케줄 만들기
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 스케줄 목록 */}
        <aside className="qms-card overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-[13px] font-semibold text-[var(--fg-primary)]">스케줄</p>
            <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{schedules.length}개</p>
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {schedules.map((s) => {
              const active = s.id === selectedId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
                      active ? "bg-[var(--brand-subtle)]" : "hover:bg-[var(--bg-muted)]"
                    }`}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-[var(--fg-primary)]">
                        {s.name}
                      </span>
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
                      {s.rangeStart} ~ {s.rangeEnd} · {recurrenceLabel(s.recurrence)}
                    </span>
                    <span className="text-[11px] text-[var(--fg-secondary)]">
                      인당 {s.perAgentTarget} · 상한 {s.maxTotal}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* 상세 */}
        <div className="space-y-4">
          {!selected || !stats ? (
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
                      STT {selected.sttMode} · 음성{" "}
                      {selected.sampleFilter.minDurationSec != null
                        ? `${selected.sampleFilter.minDurationSec}s`
                        : "—"}
                      {" ~ "}
                      {selected.sampleFilter.maxDurationSec != null
                        ? `${selected.sampleFilter.maxDurationSec}s`
                        : "제한없음"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="qms-btn-secondary inline-flex h-9 items-center gap-1.5 px-3"
                      onClick={() => toggleEnabled(selected.id)}
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
                    <button
                      type="button"
                      className="qms-btn-secondary inline-flex h-9 items-center gap-1.5 px-3"
                      onClick={() => openEdit(selected)}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-3"
                      onClick={runBatchNow}
                      disabled={!selected.enabled}
                    >
                      <CalendarRange className="h-4 w-4" />
                      지금 배치 실행
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi label="디스패치" value={stats.dispatchedCount} hint="이 스케줄로 보낸 분석 요청" />
                  <Kpi label="평가 완료" value={stats.completedCount} />
                  <Kpi label="배치 대기" value={stats.pendingBatchCount} />
                  <Kpi
                    label="온디맨드 확인"
                    value={stats.awaitingConfirmCount}
                    hint="배치 완료 → 평가 시작 전"
                    accent={stats.awaitingConfirmCount > 0}
                  />
                </div>
              </section>

              <section className="qms-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
                  <div>
                    <p className="text-[13px] font-semibold">목표 달성</p>
                    <p className="text-[11px] text-[var(--fg-tertiary)]">
                      상담사당 {selected.perAgentTarget}건 · 샘플 부족 시 shortage로 표시
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ${
                      stats.goalMet
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-amber-50 text-amber-800 ring-amber-200"
                    }`}
                  >
                    {stats.goalMet ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" /> 목표 충족(또는 부족 확인됨)
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5" /> 미달 {stats.shortageAgentCount}명 부족 가능
                      </>
                    )}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-[12px]">
                    <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                      <tr>
                        <th className="px-4 py-2 font-medium">상담사</th>
                        <th className="px-4 py-2 font-medium">평가</th>
                        <th className="px-4 py-2 font-medium">목표</th>
                        <th className="px-4 py-2 font-medium">후보 콜</th>
                        <th className="px-4 py-2 font-medium">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {stats.agents.map((a) => (
                        <tr key={a.agentName}>
                          <td className="px-4 py-2.5 font-medium text-[var(--fg-primary)]">{a.agentName}</td>
                          <td className="px-4 py-2.5">{a.evaluated}</td>
                          <td className="px-4 py-2.5">{a.target}</td>
                          <td className="px-4 py-2.5">{a.availableCandidates}</td>
                          <td className="px-4 py-2.5">
                            {a.evaluated >= a.target ? (
                              <span className="text-emerald-600">달성</span>
                            ) : a.shortage ? (
                              <span className="text-amber-700">샘플 부족</span>
                            ) : (
                              <span className="text-[var(--fg-secondary)]">진행 중</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="qms-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
                  <div>
                    <p className="text-[13px] font-semibold">분석 요청 트래킹</p>
                    <p className="text-[11px] text-[var(--fg-tertiary)]">
                      배치로 보낸 뒤, 온디맨드 평가는 확인 팝업 후에만 시작
                    </p>
                  </div>
                  <button
                    type="button"
                    className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-50"
                    disabled={awaiting.length === 0}
                    onClick={() => setConfirmOpen(true)}
                  >
                    온디맨드 평가 시작 ({awaiting.length})
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[12px]">
                    <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                      <tr>
                        <th className="px-4 py-2 font-medium">conversation</th>
                        <th className="px-4 py-2 font-medium">상담사</th>
                        <th className="px-4 py-2 font-medium">일자</th>
                        <th className="px-4 py-2 font-medium">길이</th>
                        <th className="px-4 py-2 font-medium">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {dispatches.map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 py-2.5 font-mono text-[11px]">{d.conversationId}</td>
                          <td className="px-4 py-2.5">{d.agentName}</td>
                          <td className="px-4 py-2.5">{d.callDate}</td>
                          <td className="px-4 py-2.5">
                            {d.durationSec > 0 ? fmtDuration(d.durationSec) : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${statusClass(d.status)}`}
                            >
                              {STATUS_LABEL[d.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* 스케줄 생성/수정 */}
      {formOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFormOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[16px] border border-[var(--border-subtle)] bg-white p-5 shadow-lg">
            <h3 className="text-[16px] font-bold">{editingId ? "스케줄 수정" : "스케줄 만들기"}</h3>
            <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
              저장 시 STT v2 Dynamic Batch로 샘플을 모읍니다. (초안)
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
                기간 시작
                <input
                  type="date"
                  className="qms-input mt-1 w-full"
                  value={form.rangeStart}
                  onChange={(e) => setForm((f) => ({ ...f, rangeStart: e.target.value }))}
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                기간 끝
                <input
                  type="date"
                  className="qms-input mt-1 w-full"
                  value={form.rangeEnd}
                  onChange={(e) => setForm((f) => ({ ...f, rangeEnd: e.target.value }))}
                />
              </label>
            </div>

            <fieldset className="mt-3">
              <legend className="text-[12px] font-medium text-[var(--fg-secondary)]">반복</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {(
                  [
                    ["once", "1회"],
                    ["weekly", "매주"],
                    ["monthly", "매월"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-[12px] ring-1 ${
                      recurrenceKind === k
                        ? "bg-[var(--brand-subtle)] font-semibold text-[var(--brand-fg)] ring-[var(--brand)]"
                        : "bg-white text-[var(--fg-secondary)] ring-[var(--border-default)]"
                    }`}
                    onClick={() => setRecurrenceKind(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {recurrenceKind === "weekly" ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {WEEKDAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      className={`h-8 w-8 rounded-md text-[12px] ring-1 ${
                        weekday === i
                          ? "bg-[var(--brand)] font-bold text-white ring-[var(--brand)]"
                          : "ring-[var(--border-default)]"
                      }`}
                      onClick={() => setWeekday(i)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              ) : null}
              {recurrenceKind === "monthly" ? (
                <label className="mt-2 block text-[12px] text-[var(--fg-secondary)]">
                  일자 (1–28)
                  <input
                    type="number"
                    min={1}
                    max={28}
                    className="qms-input mt-1 w-24"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value) || 1)}
                  />
                </label>
              ) : null}
            </fieldset>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                상담사당 N
                <input
                  type="number"
                  min={1}
                  className="qms-input mt-1 w-full"
                  value={form.perAgentTarget}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, perAgentTarget: Math.max(1, Number(e.target.value) || 1) }))
                  }
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                총 개수 맥스
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
                  value={form.sampleFilter.minDurationSec ?? ""}
                  placeholder="없음"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({
                      ...f,
                      sampleFilter: {
                        ...f.sampleFilter,
                        minDurationSec: v === "" ? null : Math.max(0, Number(v) || 0),
                      },
                    }));
                  }}
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--fg-secondary)]">
                최대 음성 길이(초)
                <input
                  type="number"
                  min={0}
                  className="qms-input mt-1 w-full"
                  value={form.sampleFilter.maxDurationSec ?? ""}
                  placeholder="없음"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({
                      ...f,
                      sampleFilter: {
                        ...f.sampleFilter,
                        maxDurationSec: v === "" ? null : Math.max(0, Number(v) || 0),
                      },
                    }));
                  }}
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="qms-btn-secondary h-9 px-4" onClick={() => setFormOpen(false)}>
                취소
              </button>
              <button type="button" className="qms-btn-primary h-9 px-4" onClick={saveForm}>
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 배치 → 온디맨드 확인 */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !confirmBusy) setConfirmOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-[16px] border border-[var(--border-subtle)] bg-white p-5 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-amber-50 p-2 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[var(--fg-primary)]">지금 당장 평가할까요?</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-secondary)]">
                  이 {awaiting.length}건은 이미 <strong>STT v2 배치</strong>로 전사가 끝난 콜이에요.
                  지금 온디맨드 API로 Gemini 채점·평가를 시작하면 바로 비용·부하가 발생합니다.
                </p>
                <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-md bg-[var(--bg-muted)] p-2 text-[11px] text-[var(--fg-secondary)]">
                  {awaiting.map((d) => (
                    <li key={d.id} className="font-mono">
                      {d.conversationId} · {d.agentName}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="qms-btn-secondary h-9 px-4"
                disabled={confirmBusy}
                onClick={() => setConfirmOpen(false)}
              >
                나중에
              </button>
              <button
                type="button"
                className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-4"
                disabled={confirmBusy}
                onClick={() => void confirmOndemand()}
              >
                {confirmBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                지금 평가 시작
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
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-[12px] border px-3 py-2.5 ${
        accent ? "border-amber-200 bg-amber-50/60" : "border-[var(--border-subtle)] bg-[var(--bg-muted)]"
      }`}
    >
      <p className="text-[11px] text-[var(--fg-tertiary)]" title={hint}>
        {label}
      </p>
      <p className="mt-0.5 text-[20px] font-bold tracking-tight text-[var(--fg-primary)]">{value}</p>
    </div>
  );
}

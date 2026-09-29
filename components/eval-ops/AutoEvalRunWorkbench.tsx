"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  ClipboardPen,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Text } from "@seed-design/react";
import type {
  ReviewAssignItem,
  ReviewAssignRecurrence,
  ReviewAssignRule,
  ReviewAssignRuleInput,
  ReviewAssignRun,
} from "@/lib/reviewAssignTypes";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

type Board = {
  rules: ReviewAssignRule[];
  selectedId: string | null;
  latestRun: ReviewAssignRun | null;
  items: ReviewAssignItem[];
  reservoirCount: number;
};

function padTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function recurrenceLabel(r: ReviewAssignRecurrence): string {
  if (r.kind === "once") return "1회";
  if (r.kind === "weekly") return `매주 ${WEEKDAYS[r.weekday] ?? "?"}요일`;
  return `매월 ${r.dayOfMonth}일`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function emptyForm(): ReviewAssignRuleInput {
  const today = new Date();
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const end = new Date(today);
  end.setDate(end.getDate() - 1);
  const start = new Date(today);
  start.setDate(start.getDate() - 7);
  return {
    name: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")} 수기 검수 할당`,
    enabled: true,
    rangeStart: fmt(start),
    rangeEnd: fmt(end),
    recurrence: { kind: "weekly", weekday: 1 },
    hour: 10,
    minute: 0,
    perAgentTarget: 3,
    maxTotal: 80,
    perEvaluatorQuota: 20,
    minDurationMin: 1,
    maxDurationMin: 15,
    teams: [],
  };
}

export default function AutoEvalRunWorkbench() {
  const [board, setBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewAssignRuleInput>(emptyForm());
  const [recurrenceKind, setRecurrenceKind] = useState<"once" | "weekly" | "monthly">("weekly");
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(28);
  const [runBusy, setRunBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2800);
  };

  const load = useCallback(async (id?: string | null) => {
    const q = id ? `?ruleId=${encodeURIComponent(id)}` : "";
    const res = await fetch(`/api/eval-ops/review-assign${q}`, { cache: "no-store" });
    const data = (await res.json()) as Board & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    setBoard(data);
    setSelectedId(data.selectedId);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(null)
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const selected = useMemo(
    () => board?.rules.find((s) => s.id === selectedId) ?? null,
    [board, selectedId],
  );
  const items = board?.items ?? [];
  const latestRun = board?.latestRun ?? null;

  const openCreate = () => {
    setEditingId(null);
    const next = emptyForm();
    setForm(next);
    setRecurrenceKind("weekly");
    setWeekday(1);
    setDayOfMonth(28);
    setFormOpen(true);
  };

  const openEdit = (s: ReviewAssignRule) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      enabled: s.enabled,
      rangeStart: s.rangeStart,
      rangeEnd: s.rangeEnd,
      recurrence: s.recurrence,
      hour: s.hour,
      minute: s.minute,
      perAgentTarget: s.perAgentTarget,
      maxTotal: s.maxTotal,
      perEvaluatorQuota: s.perEvaluatorQuota,
      minDurationMin: s.minDurationMin,
      maxDurationMin: s.maxDurationMin,
      teams: s.teams,
    });
    setRecurrenceKind(s.recurrence.kind);
    if (s.recurrence.kind === "weekly") setWeekday(s.recurrence.weekday);
    if (s.recurrence.kind === "monthly") setDayOfMonth(s.recurrence.dayOfMonth);
    setFormOpen(true);
  };

  const saveForm = async () => {
    const recurrence: ReviewAssignRecurrence =
      recurrenceKind === "once"
        ? { kind: "once" }
        : recurrenceKind === "weekly"
          ? { kind: "weekly", weekday }
          : { kind: "monthly", dayOfMonth: Math.min(28, Math.max(1, dayOfMonth)) };
    setSaveBusy(true);
    try {
      const res = await fetch("/api/eval-ops/review-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { ...form, recurrence, id: editingId } : { ...form, recurrence }),
      });
      const data = (await res.json()) as { rule?: ReviewAssignRule; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFormOpen(false);
      flash(editingId ? "규칙을 저장했어요" : "규칙을 만들었어요");
      await load(data.rule?.id ?? selectedId);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const toggleEnabled = async (s: ReviewAssignRule) => {
    try {
      const res = await fetch("/api/eval-ops/review-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: s.id,
          name: s.name,
          enabled: !s.enabled,
          rangeStart: s.rangeStart,
          rangeEnd: s.rangeEnd,
          recurrence: s.recurrence,
          hour: s.hour,
          minute: s.minute,
          perAgentTarget: s.perAgentTarget,
          maxTotal: s.maxTotal,
          perEvaluatorQuota: s.perEvaluatorQuota,
          minDurationMin: s.minDurationMin,
          maxDurationMin: s.maxDurationMin,
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
      const res = await fetch("/api/eval-ops/review-assign/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: selected.id }),
      });
      const data = (await res.json()) as { run?: ReviewAssignRun; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      flash(`${data.run?.selectedCount ?? 0}건을 공용 레저부어에 넣었어요`);
      await load(selected.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardPen className="h-6 w-6 text-[var(--brand)]" />
            <h1 className="text-[22px] font-bold text-[var(--fg-primary)]">수기 검수 할당</h1>
          </div>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted" className="mt-1">
            AI 평가가 끝난 콜을 골라 공용 레저부어에 넣습니다. 평가자가 찜하지 않고 「검수 요청」에서 이어서 검수합니다.
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
            규칙 만들기
          </button>
        </div>
      </div>

      {error ? <p className="text-[13px] text-red-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="qms-card overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-[13px] font-semibold text-[var(--fg-primary)]">할당 규칙</p>
            <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">{board?.rules.length ?? 0}개</p>
          </div>
          {(board?.rules.length ?? 0) === 0 && !loading ? (
            <p className="px-4 py-8 text-center text-[12px] text-[var(--fg-tertiary)]">규칙을 만들어 주세요.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {(board?.rules ?? []).map((s) => {
                const active = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
                        active ? "bg-[var(--brand-subtle)]" : "hover:bg-[var(--bg-muted)]"
                      }`}
                      onClick={() => {
                        setSelectedId(s.id);
                        void load(s.id);
                      }}
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
                        {s.rangeStart} ~ {s.rangeEnd} · {recurrenceLabel(s.recurrence)}
                      </span>
                      <span className="text-[11px] text-[var(--fg-secondary)]">
                        상담원당 {s.perAgentTarget} · 상한 {s.maxTotal} · 할당량 {s.perEvaluatorQuota}
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
              규칙을 선택하거나 새로 만들어 주세요.
            </div>
          ) : (
            <>
              <section className="qms-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[16px] font-bold text-[var(--fg-primary)]">{selected.name}</h2>
                    <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
                      {padTime(selected.hour, selected.minute)} KST · {recurrenceLabel(selected.recurrence)} · 음성{" "}
                      {selected.minDurationMin != null ? `${selected.minDurationMin}분` : "—"}
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
                    <button
                      type="button"
                      className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-3 disabled:opacity-50"
                      disabled={runBusy}
                      onClick={() => void runNow()}
                    >
                      {runBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
                      지금 할당
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi label="이번 할당" value={latestRun?.selectedCount ?? 0} />
                  <Kpi label="이번 스킵" value={latestRun?.skippedCount ?? 0} hint="이미 레저부어에 있는 콜" />
                  <Kpi label="이 규칙 누적" value={items.length} />
                  <Kpi label="평가자 할당량" value={selected.perEvaluatorQuota} hint="검수 요청 뱃지 기준" />
                </div>
              </section>

              <section className="qms-card overflow-hidden">
                <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                  <p className="text-[13px] font-semibold">공용 레저부어</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)]">
                    전체 평가 → 검수 요청에 그대로 보입니다. 구성원이 찜하지 않습니다.
                  </p>
                </div>
                {items.length === 0 ? (
                  <p className="px-4 py-6 text-[12px] text-[var(--fg-tertiary)]">아직 할당된 콜이 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-[12px]">
                      <thead className="bg-[var(--bg-muted)] text-[var(--fg-tertiary)]">
                        <tr>
                          <th className="px-4 py-2 font-medium">conversation</th>
                          <th className="px-4 py-2 font-medium">상담원</th>
                          <th className="px-4 py-2 font-medium">일자</th>
                          <th className="px-4 py-2 font-medium">길이</th>
                          <th className="px-4 py-2 font-medium">할당 시각</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {items.map((d) => (
                          <tr key={d.id}>
                            <td className="px-4 py-2.5 font-mono text-[11px]">{d.conversationId}</td>
                            <td className="px-4 py-2.5">{d.agentName}</td>
                            <td className="px-4 py-2.5">{d.callDate}</td>
                            <td className="px-4 py-2.5">{fmtDuration(d.durationSec)}</td>
                            <td className="px-4 py-2.5 text-[var(--fg-tertiary)]">
                              {d.assignedAt.replace("T", " ").slice(0, 16)}
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
            <h3 className="text-[16px] font-bold">{editingId ? "규칙 수정" : "규칙 만들기"}</h3>
            <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
              AI 평가가 끝난 콜만 고릅니다. 할당량은 평가자 1명이 검수해야 할 건수입니다.
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

            <label className="mt-3 block text-[12px] font-medium text-[var(--fg-secondary)]">
              실행 시각 (KST)
              <input
                type="time"
                className="qms-input mt-1 w-40"
                value={padTime(form.hour, form.minute)}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":");
                  setForm((f) => ({ ...f, hour: Number(h) || 0, minute: Number(m) || 0 }));
                }}
              />
            </label>

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
                상담원당 최대
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

            <label className="mt-3 block text-[12px] font-medium text-[var(--fg-secondary)]">
              평가자 할당량
              <input
                type="number"
                min={1}
                className="qms-input mt-1 w-full"
                value={form.perEvaluatorQuota}
                onChange={(e) =>
                  setForm((f) => ({ ...f, perEvaluatorQuota: Math.max(1, Number(e.target.value) || 1) }))
                }
              />
              <span className="mt-1 block text-[11px] font-normal text-[var(--fg-tertiary)]">
                검수 요청 뱃지 = 이 숫자 − 내가 완료한 건수
              </span>
            </label>

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

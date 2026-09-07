"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { CalendarClock, Download, RefreshCw } from "lucide-react";
import { Text } from "@seed-design/react";
import type {
  EvalOpsPersonalEvent,
  EvalOpsScheduleBoardItem,
} from "@/lib/evalOpsScheduleStore";
import { ymNow } from "@/lib/evalOpsSchedule";
import ScheduleTodoPanel from "./schedule/ScheduleTodoPanel";
import ScheduleCalendar, { type DragState } from "./schedule/ScheduleCalendar";
import SchedulePersonalModal from "./schedule/SchedulePersonalModal";

type SchedulePayload = {
  month: string;
  historyId: string | null;
  items: EvalOpsScheduleBoardItem[];
  personal: EvalOpsPersonalEvent[];
  effectiveEmail: string;
  realEmail: string;
  sudoActive: boolean;
  totalCs: number;
  totalJob: number;
  completionRate: number;
  seeded?: boolean;
  unmatchedReason?: string;
};

type ItemPatchFields = {
  start?: string | null;
  end?: string | null;
  evalDone?: boolean;
  leaderDone?: boolean;
  selfDone?: boolean;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

function applyLocalPatch(it: EvalOpsScheduleBoardItem, fields: ItemPatchFields): EvalOpsScheduleBoardItem {
  const next = { ...it };
  if ("start" in fields) next.startDate = fields.start ?? null;
  if ("end" in fields) next.endDate = fields.end ?? null;
  if (typeof fields.evalDone === "boolean") {
    next.evalDone = fields.evalDone;
    if (!fields.evalDone) {
      next.leaderDone = false;
      next.selfDone = false;
    }
  }
  if (typeof fields.leaderDone === "boolean") {
    next.leaderDone = next.evalDone ? fields.leaderDone : false;
  }
  if (typeof fields.selfDone === "boolean") {
    next.selfDone = next.evalDone ? fields.selfDone : false;
  }
  return next;
}

export default function EvalScheduleView() {
  const { data: session } = useSession();
  const [month, setMonth] = useState(ymNow);
  const [items, setItems] = useState<EvalOpsScheduleBoardItem[]>([]);
  const [personal, setPersonal] = useState<EvalOpsPersonalEvent[]>([]);
  const [meta, setMeta] = useState<Omit<SchedulePayload, "items" | "personal"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [splitBusyId, setSplitBusyId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [personalEditing, setPersonalEditing] = useState<EvalOpsPersonalEvent | null>(null);
  const [personalDefaultDate, setPersonalDefaultDate] = useState<string | null>(null);
  const [personalSaving, setPersonalSaving] = useState(false);

  /** Sequential persist queue — UI updates immediately; BQ writes never race. */
  const patchQueueRef = useRef<Array<{ id: string; fields: ItemPatchFields }>>([]);
  const patchFlushingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyPayload = useCallback((json: SchedulePayload) => {
    setItems(json.items ?? []);
    setPersonal(json.personal ?? []);
    setMeta({
      month: json.month,
      historyId: json.historyId,
      effectiveEmail: json.effectiveEmail,
      realEmail: json.realEmail,
      sudoActive: json.sudoActive,
      totalCs: json.totalCs,
      totalJob: json.totalJob,
      completionRate: json.completionRate,
      seeded: json.seeded,
      unmatchedReason: json.unmatchedReason,
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/eval-ops/schedule?month=${encodeURIComponent(month)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "불러오기 실패");
      applyPayload(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setPersonal([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [month, applyPayload]);

  useEffect(() => {
    patchQueueRef.current = [];
    patchFlushingRef.current = false;
    setSaveStatus("idle");
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const bootstrap = async (force: boolean) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/eval-ops/schedule/bootstrap?month=${encodeURIComponent(month)}${force ? "&force=1" : ""}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) },
      );
      const json = await res.json();
      if (res.status === 409) {
        if (confirm(`${json.error || "배치된 항목이 있습니다."}\n강제 불러오기를 할까요? (기존 일정·체크가 초기화됩니다)`)) {
          await bootstrap(true);
          return;
        }
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(json.error || "불러오기 실패");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  const flushPatchQueue = useCallback(async () => {
    if (patchFlushingRef.current) return;
    patchFlushingRef.current = true;
    setSaveStatus("saving");
    setError("");

    try {
      while (patchQueueRef.current.length) {
        // Merge consecutive patches for the same id into one request
        const first = patchQueueRef.current.shift()!;
        let merged: ItemPatchFields = { ...first.fields };
        while (patchQueueRef.current[0]?.id === first.id) {
          const next = patchQueueRef.current.shift()!;
          merged = { ...merged, ...next.fields };
          if (merged.evalDone === false) {
            merged.leaderDone = false;
            merged.selfDone = false;
          }
        }

        const res = await fetch(`/api/eval-ops/schedule/items/${encodeURIComponent(first.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(merged),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "저장 실패");

        // Avoid clobbering newer local edits still in the queue
        const pendingSame = patchQueueRef.current.some((q) => q.id === first.id);
        if (json.item && !pendingSame) {
          setItems((prev) => prev.map((it) => (it.id === first.id ? json.item : it)));
        }
      }
      setSaveStatus("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (e) {
      setSaveStatus("error");
      setError(e instanceof Error ? e.message : String(e));
      patchQueueRef.current = [];
      await load();
    } finally {
      patchFlushingRef.current = false;
      if (patchQueueRef.current.length) void flushPatchQueue();
    }
  }, [load]);

  /** Immediate local update + queued sequential persist (qa_scheduler `upd` pattern). */
  const patchItem = useCallback(
    (id: string, fields: ItemPatchFields) => {
      setItems((prev) => prev.map((it) => (it.id === id ? applyLocalPatch(it, fields) : it)));
      patchQueueRef.current.push({ id, fields });
      void flushPatchQueue();
    },
    [flushPatchQueue],
  );

  const onSplit = async (id: string) => {
    if (patchQueueRef.current.length || patchFlushingRef.current) {
      setError("저장이 끝날 때까지 잠시 후 다시 시도하세요.");
      return;
    }
    setSplitBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/eval-ops/schedule/items/${encodeURIComponent(id)}/split`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "쪼개기 실패");
      setItems((prev) => {
        const without = prev.filter((i) => i.id !== id);
        return [...without, json.original, json.created].sort(
          (a, b) =>
            a.teamName.localeCompare(b.teamName, "ko") ||
            a.roundLabel.localeCompare(b.roundLabel, "ko") ||
            a.channel.localeCompare(b.channel, "ko"),
        );
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSplitBusyId(null);
    }
  };

  const openPersonal = (id: string | null, defaultDate: string | null) => {
    if (id) {
      const ev = personal.find((p) => p.id === id) ?? null;
      setPersonalEditing(ev);
      setPersonalDefaultDate(ev?.startDate ?? defaultDate);
    } else {
      setPersonalEditing(null);
      setPersonalDefaultDate(defaultDate);
    }
    setPersonalOpen(true);
  };

  const savePersonal = async (payload: {
    id?: string;
    title: string;
    startDate: string;
    endDate: string;
    color: string;
  }) => {
    setPersonalSaving(true);
    try {
      const res = await fetch("/api/eval-ops/schedule/personal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, evalMonth: month }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "저장 실패");
      setPersonal((prev) => {
        const rest = prev.filter((p) => p.id !== json.event.id);
        return [...rest, json.event].sort((a, b) => a.startDate.localeCompare(b.startDate));
      });
      setPersonalOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPersonalSaving(false);
    }
  };

  const deletePersonal = async (id: string) => {
    setPersonalSaving(true);
    try {
      const res = await fetch(`/api/eval-ops/schedule/personal/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "삭제 실패");
      setPersonal((prev) => prev.filter((p) => p.id !== id));
      setPersonalOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPersonalSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-[var(--brand)]" />
            <h1 className="text-[22px] font-bold text-[var(--fg-primary)]">평가 스케줄</h1>
          </div>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted" className="mt-1">
            월별 평가 일정을 배치하고, 완료·리더검토·본인확정을 추적합니다.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-[12px] ${
              saveStatus === "error"
                ? "text-red-600"
                : saveStatus === "saving"
                  ? "text-[var(--fg-tertiary)]"
                  : saveStatus === "saved"
                    ? "text-emerald-600"
                    : "text-transparent"
            }`}
            aria-live="polite"
          >
            {saveStatus === "saving"
              ? "저장 중…"
              : saveStatus === "saved"
                ? "저장됨"
                : saveStatus === "error"
                  ? "저장 실패"
                  : "·"}
          </span>
          <input
            type="month"
            className="qms-input h-9 px-3"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <button
            type="button"
            className="qms-btn-secondary inline-flex h-9 items-center gap-1.5 px-3"
            onClick={() => void load()}
            disabled={loading || saveStatus === "saving"}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </button>
          <button
            type="button"
            className="qms-btn-primary inline-flex h-9 items-center gap-1.5 px-3"
            onClick={() => void bootstrap(false)}
            disabled={loading || saveStatus === "saving"}
          >
            <Download className="h-4 w-4" />
            배분에서 불러오기
          </button>
        </div>
      </div>

      {meta?.sudoActive && (
        <div className="rounded-[12px] border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <strong>sudo 모드</strong> — {meta.effectiveEmail} 화면을 보고 있습니다 (관리자: {meta.realEmail})
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[16px] border border-[var(--border-subtle)] bg-white p-4 text-center shadow-sm">
          <div className="text-[26px] font-extrabold text-[var(--brand)]">{items.length || "—"}</div>
          <div className="text-[12px] text-[var(--fg-tertiary)]">총 항목</div>
        </div>
        <div className="rounded-[16px] border border-[var(--border-subtle)] bg-white p-4 text-center shadow-sm">
          <div className="text-[26px] font-extrabold text-[var(--brand)]">{meta?.totalJob ?? "—"}</div>
          <div className="text-[12px] text-[var(--fg-tertiary)]">직무 (건)</div>
        </div>
        <div className="rounded-[16px] border border-[var(--border-subtle)] bg-white p-4 text-center shadow-sm">
          <div className="text-[26px] font-extrabold text-[var(--brand)]">{meta?.totalCs ?? "—"}</div>
          <div className="text-[12px] text-[var(--fg-tertiary)]">CS (건)</div>
        </div>
        <div className="rounded-[16px] border border-[var(--border-subtle)] bg-white p-4 text-center shadow-sm">
          <div className="text-[26px] font-extrabold text-[var(--brand)]">
            {meta ? `${meta.completionRate}%` : "—"}
          </div>
          <div className="text-[12px] text-[var(--fg-tertiary)]">평가 완료율</div>
        </div>
      </div>

      {error && (
        <div className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          {error}
        </div>
      )}

      {!loading && meta?.unmatchedReason && items.length === 0 && (
        <div className="rounded-[12px] border border-[var(--border-subtle)] bg-white px-4 py-3 text-[13px] text-[var(--fg-tertiary)]">
          {meta.unmatchedReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        <div>
          <h2 className="mb-2 text-[14px] font-bold text-[var(--fg-primary)]">평가 대상</h2>
          {loading && !items.length ? (
            <div className="rounded-[16px] border border-[var(--border-subtle)] bg-white p-6 text-[13px] text-[var(--fg-tertiary)]">
              불러오는 중…
            </div>
          ) : (
            <ScheduleTodoPanel
              items={items}
              busyId={splitBusyId}
              onPatch={(id, fields) => patchItem(id, fields)}
              onSplit={(id) => void onSplit(id)}
              onDragStart={(id) => setDragState({ mode: "assign", id })}
              onDragEnd={() => setDragState(null)}
            />
          )}
          <p className="mt-2 truncate text-[11px] text-[var(--fg-tertiary)]">
            {meta?.effectiveEmail || session?.user?.email || ""}
          </p>
        </div>

        <ScheduleCalendar
          month={month}
          items={items}
          personal={personal}
          dragState={dragState}
          setDragState={setDragState}
          onItemDates={(id, start, end) => patchItem(id, { start, end })}
          onCancelSchedule={(id) => {
            const item = items.find((i) => i.id === id);
            if (!item) return;
            if (
              confirm(
                `[${item.teamName} ${item.evalType} ${item.roundLabel} ${item.channel}]\n일정을 취소할까요?`,
              )
            ) {
              patchItem(id, { start: null, end: null });
            }
          }}
          onOpenPersonal={openPersonal}
          onAddPersonalClick={() => openPersonal(null, `${month}-01`)}
        />
      </div>

      <SchedulePersonalModal
        open={personalOpen}
        month={month}
        editing={personalEditing}
        defaultDate={personalDefaultDate}
        saving={personalSaving}
        onClose={() => setPersonalOpen(false)}
        onSave={(p) => void savePersonal(p)}
        onDelete={(id) => void deletePersonal(id)}
      />
    </div>
  );
}

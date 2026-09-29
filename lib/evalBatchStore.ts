import { randomUUID } from "node:crypto";
import { createJsonFileStore } from "./jsonFileStore";
import { clampHour, clampMinute, clampPositiveInt, initialLastRunDateKst } from "./sttBatchKst";
import type {
  EvalBatchAgentStat,
  EvalBatchJob,
  EvalBatchRun,
  EvalBatchRunStatus,
  EvalBatchSchedule,
  EvalBatchScheduleInput,
  EvalBatchSttRequirement,
} from "./evalBatchTypes";
import { isInFlightEvalStatus } from "./evalBatchTypes";

const MAX_JOBS = 4000;
const MAX_RUNS = 200;

type State = {
  schedules: EvalBatchSchedule[];
  jobs: EvalBatchJob[];
  runs: EvalBatchRun[];
};

const empty = (): State => ({ schedules: [], jobs: [], runs: [] });

const store = createJsonFileStore<State>({
  name: "eval-batch",
  empty,
  prepareSave: (state) => ({
    ...state,
    jobs: state.jobs.length > MAX_JOBS ? state.jobs.slice(-MAX_JOBS) : state.jobs,
    runs: state.runs.length > MAX_RUNS ? state.runs.slice(-MAX_RUNS) : state.runs,
  }),
});

function nowIso() {
  return new Date().toISOString();
}

function parseSttRequirement(v: unknown): EvalBatchSttRequirement {
  return v === "pending" || v === "any" || v === "done" ? v : "done";
}

function nullableMin(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export function normalizeEvalBatchInput(input: EvalBatchScheduleInput): EvalBatchScheduleInput {
  return {
    name: input.name.trim() || "AI 평가 배치",
    enabled: Boolean(input.enabled),
    hour: clampHour(input.hour),
    minute: clampMinute(input.minute),
    perAgentCount: clampPositiveInt(input.perAgentCount, 3, 50),
    maxTotal: clampPositiveInt(input.maxTotal, 50, 20_000),
    callDateOffsetDays: Math.min(14, Math.max(0, Math.trunc(input.callDateOffsetDays))),
    minDurationMin: nullableMin(input.minDurationMin),
    maxDurationMin: nullableMin(input.maxDurationMin),
    teams: (input.teams ?? []).map((s) => s.trim()).filter(Boolean),
    sttRequirement: parseSttRequirement(input.sttRequirement),
  };
}

function asState(parsed: Partial<State>): State {
  return {
    schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
  };
}

export async function listEvalBatchState(): Promise<State> {
  return store.withLock(async () => asState(await store.load()));
}

export async function upsertEvalBatchSchedule(
  input: EvalBatchScheduleInput & { id?: string },
  email: string | null,
): Promise<EvalBatchSchedule> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    const body = normalizeEvalBatchInput(input);
    const now = nowIso();
    const existing = input.id ? state.schedules.find((s) => s.id === input.id) : undefined;
    if (existing) {
      const next: EvalBatchSchedule = { ...existing, ...body, updatedAt: now };
      state.schedules = state.schedules.map((s) => (s.id === next.id ? next : s));
      await store.save(state);
      return next;
    }
    const created: EvalBatchSchedule = {
      id: randomUUID(),
      ...body,
      lastRunAt: null,
      lastRunDateKst: initialLastRunDateKst(body.hour, body.minute),
      createdAt: now,
      updatedAt: now,
      createdBy: email,
    };
    state.schedules.unshift(created);
    await store.save(state);
    return created;
  });
}

export async function getEvalBatchSchedule(id: string): Promise<EvalBatchSchedule | null> {
  const state = await listEvalBatchState();
  return state.schedules.find((s) => s.id === id) ?? null;
}

export async function createEvalBatchRun(input: {
  schedule: EvalBatchSchedule;
  trigger: EvalBatchRun["trigger"];
  callDate: string;
  executionDateKst: string;
  requestedBy: string | null;
  jobs: Omit<EvalBatchJob, "id" | "runId" | "scheduleId" | "createdAt" | "updatedAt" | "finishedAt">[];
}): Promise<{ run: EvalBatchRun; jobs: EvalBatchJob[] }> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    if (hasActiveEvalBatchRun(state.runs, input.schedule.id)) {
      throw new Error("이 스케줄의 AI 평가 배치가 이미 실행 중입니다.");
    }
    const now = nowIso();
    const runId = randomUUID();
    const jobs: EvalBatchJob[] = input.jobs.map((j) => ({
      ...j,
      id: randomUUID(),
      runId,
      scheduleId: input.schedule.id,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    }));
    const run: EvalBatchRun = {
      id: runId,
      scheduleId: input.schedule.id,
      trigger: input.trigger,
      callDate: input.callDate,
      status: "running",
      requestedBy: input.requestedBy,
      selectedCount: jobs.length,
      completedCount: 0,
      skippedCount: jobs.filter((j) => j.status === "skipped").length,
      failedCount: 0,
      waitingSttCount: jobs.filter((j) => j.status === "pending_stt" || j.status === "waiting_stt").length,
      error: null,
      startedAt: now,
      finishedAt: null,
    };
    state.runs.push(run);
    state.jobs.push(...jobs);
    const sched = state.schedules.find((s) => s.id === input.schedule.id);
    if (sched) {
      sched.lastRunAt = now;
      sched.lastRunDateKst = input.executionDateKst;
      sched.updatedAt = now;
    }
    await store.save(state);
    return { run, jobs };
  });
}

export async function patchEvalBatchJob(
  id: string,
  patch: Partial<Pick<EvalBatchJob, "status" | "analysisId" | "error" | "finishedAt">>,
): Promise<EvalBatchJob | null> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    const idx = state.jobs.findIndex((j) => j.id === id);
    if (idx < 0) return null;
    const next: EvalBatchJob = { ...state.jobs[idx], ...patch, updatedAt: nowIso() };
    state.jobs[idx] = next;
    await store.save(state);
    return next;
  });
}

export async function finishEvalBatchRun(
  runId: string,
  outcome: { status: EvalBatchRunStatus; error?: string | null },
): Promise<EvalBatchRun | null> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    const idx = state.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return null;
    const jobs = state.jobs.filter((j) => j.runId === runId);
    const next: EvalBatchRun = {
      ...state.runs[idx],
      status: outcome.status,
      error: outcome.error ?? null,
      completedCount: jobs.filter((j) => j.status === "completed").length,
      skippedCount: jobs.filter((j) => j.status === "skipped").length,
      failedCount: jobs.filter((j) => j.status === "failed").length,
      waitingSttCount: jobs.filter((j) => j.status === "pending_stt" || j.status === "waiting_stt").length,
      finishedAt: nowIso(),
    };
    state.runs[idx] = next;
    await store.save(state);
    return next;
  });
}

export function jobsForEvalBatchRun(jobs: EvalBatchJob[], runId: string): EvalBatchJob[] {
  return jobs.filter((j) => j.runId === runId);
}

export function latestEvalBatchRun(runs: EvalBatchRun[], scheduleId: string): EvalBatchRun | null {
  const list = runs.filter((r) => r.scheduleId === scheduleId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return list[0] ?? null;
}

export function hasActiveEvalBatchRun(runs: EvalBatchRun[], scheduleId: string): boolean {
  return runs.some((r) => r.scheduleId === scheduleId && r.status === "running");
}

export function evalBatchSkipIds(jobs: EvalBatchJob[], callDate: string): Set<string> {
  const skip = new Set<string>();
  for (const j of jobs) {
    if (j.callDate !== callDate) continue;
    if (j.status === "failed" || j.status === "skipped") continue;
    skip.add(j.conversationId);
  }
  return skip;
}

export function inFlightEvalBatchJobs(jobs: EvalBatchJob[]): EvalBatchJob[] {
  return jobs.filter((j) => isInFlightEvalStatus(j.status));
}

export function summarizeEvalBatchAgents(jobs: EvalBatchJob[], perAgent: number): EvalBatchAgentStat[] {
  const map = new Map<string, EvalBatchAgentStat>();
  for (const j of jobs) {
    const key = j.agentName || "(없음)";
    const row = map.get(key) ?? {
      agentName: key,
      team: j.team,
      target: perAgent,
      selected: 0,
      completed: 0,
      failed: 0,
      waitingStt: 0,
      skipped: 0,
    };
    row.selected += 1;
    if (j.status === "completed") row.completed += 1;
    else if (j.status === "failed") row.failed += 1;
    else if (j.status === "skipped") row.skipped += 1;
    else if (j.status === "pending_stt" || j.status === "waiting_stt") row.waitingStt += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.agentName.localeCompare(b.agentName, "ko"));
}

export async function _resetEvalBatchStoreForTests(): Promise<void> {
  await store.withLock(async () => {
    await store.save(empty());
  });
}

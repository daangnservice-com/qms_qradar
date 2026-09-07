import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { clampHour, clampMinute, clampPositiveInt, kstClock } from "./sttBatchKst";
import type { TranscriptSegment } from "./types";
import type {
  SttBatchJob,
  SttBatchRun,
  SttBatchRunStatus,
  SttBatchSchedule,
  SttBatchScheduleInput,
} from "./sttBatchTypes";

const DIR = path.join(process.cwd(), ".data", "stt-batch");
const FILE = path.join(DIR, "state.json");
const LOCK = path.join(DIR, "state.json.lock");
const TRANSCRIPT_DIR = path.join(DIR, "transcripts");
const MAX_JOBS = 3000;
const MAX_RUNS = 200;

type TranscriptFile = {
  conversationId: string;
  durationSec: number;
  transcribedAt: string;
  remoteJobId: string | null;
  transcript: TranscriptSegment[];
};

function safeCid(cid: string): string {
  return cid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function transcriptPath(conversationId: string): string {
  return path.join(TRANSCRIPT_DIR, `${safeCid(conversationId)}.json`);
}

/** 스케줄 생성 시각이 이미 오늘 due를 지났으면 오늘 실행을 건너뛴다. */
export function initialLastRunDateKst(hour: number, minute: number, now = new Date()): string | null {
  const clock = kstClock(now);
  const nowMin = clock.hour * 60 + clock.minute;
  const dueMin = clampHour(hour) * 60 + clampMinute(minute);
  return nowMin >= dueMin ? clock.date : null;
}

type State = {
  schedules: SttBatchSchedule[];
  jobs: SttBatchJob[];
  runs: SttBatchRun[];
};

const empty = (): State => ({ schedules: [], jobs: [], runs: [] });

let chain: Promise<unknown> = Promise.resolve();

function firstJsonObjectEnd(raw: string): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

async function acquireFileLock(): Promise<() => Promise<void>> {
  await mkdir(DIR, { recursive: true });
  for (let i = 0; i < 400; i++) {
    try {
      const st = await stat(LOCK);
      if (Date.now() - st.mtimeMs > 20_000) await unlink(LOCK).catch(() => {});
    } catch {
      /* no lock */
    }
    try {
      await writeFile(LOCK, String(process.pid), { flag: "wx" });
      return async () => {
        await unlink(LOCK).catch(() => {});
      };
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  throw new Error("stt-batch store lock timeout");
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(
    async () => {
      const release = await acquireFileLock();
      try {
        return await fn();
      } finally {
        await release();
      }
    },
    async () => {
      const release = await acquireFileLock();
      try {
        return await fn();
      } finally {
        await release();
      }
    },
  );
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function asState(parsed: Partial<State>): State {
  return {
    schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
  };
}

async function load(): Promise<State> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch {
    return empty();
  }
  try {
    return asState(JSON.parse(raw) as Partial<State>);
  } catch {
    const end = firstJsonObjectEnd(raw);
    if (end < 0) throw new Error("stt-batch state.json is not valid JSON");
    return asState(JSON.parse(raw.slice(0, end + 1)) as Partial<State>);
  }
}

async function save(state: State): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const jobs = state.jobs.length > MAX_JOBS ? state.jobs.slice(-MAX_JOBS) : state.jobs;
  const runs = state.runs.length > MAX_RUNS ? state.runs.slice(-MAX_RUNS) : state.runs;
  const payload = JSON.stringify({ ...state, jobs, runs }, null, 2);
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, payload, "utf8");
  try {
    await rename(tmp, FILE);
  } catch {
    await copyFile(tmp, FILE);
    await unlink(tmp).catch(() => {});
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeInput(input: SttBatchScheduleInput): SttBatchScheduleInput {
  return {
    name: input.name.trim() || "STT 배치",
    enabled: Boolean(input.enabled),
    hour: clampHour(input.hour),
    minute: clampMinute(input.minute),
    perAgentCount: clampPositiveInt(input.perAgentCount, 3, 50),
    maxTotal: clampPositiveInt(input.maxTotal, 50, 20_000),
    callDateOffsetDays: Math.min(14, Math.max(0, Math.trunc(input.callDateOffsetDays))),
    minDurationSec:
      input.minDurationSec == null || !Number.isFinite(input.minDurationSec)
        ? null
        : Math.max(0, Math.trunc(input.minDurationSec)),
    maxDurationSec:
      input.maxDurationSec == null || !Number.isFinite(input.maxDurationSec)
        ? null
        : Math.max(0, Math.trunc(input.maxDurationSec)),
    teams: (input.teams ?? []).map((s) => s.trim()).filter(Boolean),
  };
}

export async function listSttBatchState(): Promise<State> {
  return withLock(() => load());
}

export async function upsertSttBatchSchedule(
  input: SttBatchScheduleInput & { id?: string },
  email: string | null,
): Promise<SttBatchSchedule> {
  return withLock(async () => {
    const state = await load();
    const body = normalizeInput(input);
    const now = nowIso();
    const existing = input.id ? state.schedules.find((s) => s.id === input.id) : undefined;
    if (existing) {
      const next: SttBatchSchedule = {
        ...existing,
        ...body,
        updatedAt: now,
      };
      state.schedules = state.schedules.map((s) => (s.id === next.id ? next : s));
      await save(state);
      return next;
    }
    const created: SttBatchSchedule = {
      id: randomUUID(),
      ...body,
      lastRunAt: null,
      lastRunDateKst: initialLastRunDateKst(body.hour, body.minute),
      createdAt: now,
      updatedAt: now,
      createdBy: email,
    };
    state.schedules.unshift(created);
    await save(state);
    return created;
  });
}

export async function getSttBatchSchedule(id: string): Promise<SttBatchSchedule | null> {
  const state = await listSttBatchState();
  return state.schedules.find((s) => s.id === id) ?? null;
}

export async function createSttBatchRun(input: {
  schedule: SttBatchSchedule;
  trigger: SttBatchRun["trigger"];
  callDate: string;
  /** 스케줄 due 판정용 실행일(KST). 대상 콜 날짜와 다를 수 있다. */
  executionDateKst: string;
  requestedBy: string | null;
  jobs: Omit<SttBatchJob, "id" | "runId" | "scheduleId" | "createdAt" | "updatedAt" | "queuedAt" | "finishedAt">[];
}): Promise<{ run: SttBatchRun; jobs: SttBatchJob[] }> {
  return withLock(async () => {
    const state = await load();
    const now = nowIso();
    const runId = randomUUID();
    const jobs: SttBatchJob[] = input.jobs.map((j) => ({
      ...j,
      id: randomUUID(),
      runId,
      scheduleId: input.schedule.id,
      progress: j.progress ?? null,
      stage: j.stage ?? null,
      segmentCount: j.segmentCount ?? null,
      createdAt: now,
      updatedAt: now,
      queuedAt: null,
      finishedAt: null,
    }));
    const run: SttBatchRun = {
      id: runId,
      scheduleId: input.schedule.id,
      trigger: input.trigger,
      callDate: input.callDate,
      status: "running",
      requestedBy: input.requestedBy,
      selectedCount: jobs.length,
      queuedCount: 0,
      skippedCount: jobs.filter((j) => j.status === "skipped").length,
      failedCount: 0,
      error: null,
      startedAt: now,
      finishedAt: null,
    };
    state.runs.push(run);
    state.jobs.push(...jobs);
    state.schedules = state.schedules.map((s) =>
      s.id === input.schedule.id
        ? { ...s, lastRunAt: now, lastRunDateKst: input.executionDateKst, updatedAt: now }
        : s,
    );
    await save(state);
    return { run, jobs };
  });
}

export async function patchSttBatchJob(
  jobId: string,
  patch: Partial<
    Pick<
      SttBatchJob,
      "status" | "remoteJobId" | "error" | "queuedAt" | "finishedAt" | "progress" | "stage" | "segmentCount" | "durationSec"
    >
  >,
): Promise<SttBatchJob | null> {
  return withLock(async () => {
    const state = await load();
    const idx = state.jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) return null;
    const next: SttBatchJob = { ...state.jobs[idx], ...patch, updatedAt: nowIso() };
    state.jobs[idx] = next;
    await save(state);
    return next;
  });
}

export async function finishSttBatchRun(
  runId: string,
  outcome: { status: SttBatchRunStatus; error?: string | null },
): Promise<SttBatchRun | null> {
  return withLock(async () => {
    const state = await load();
    const idx = state.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return null;
    const jobs = state.jobs.filter((j) => j.runId === runId);
    const next: SttBatchRun = {
      ...state.runs[idx],
      status: outcome.status,
      error: outcome.error ?? null,
      queuedCount: jobs.filter((j) => j.status === "queued" || j.status === "done").length,
      skippedCount: jobs.filter((j) => j.status === "skipped").length,
      failedCount: jobs.filter((j) => j.status === "failed").length,
      finishedAt: nowIso(),
    };
    state.runs[idx] = next;
    await save(state);
    return next;
  });
}

export function jobsForRun(jobs: SttBatchJob[], runId: string): SttBatchJob[] {
  return jobs.filter((j) => j.runId === runId);
}

export function latestRunForSchedule(runs: SttBatchRun[], scheduleId: string): SttBatchRun | null {
  const list = runs.filter((r) => r.scheduleId === scheduleId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return list[0] ?? null;
}

export function hasActiveRun(runs: SttBatchRun[], scheduleId: string): boolean {
  return runs.some((r) => r.scheduleId === scheduleId && r.status === "running");
}

export function queuedConversationIds(jobs: SttBatchJob[], callDate: string): Set<string> {
  const skip = new Set<string>();
  for (const j of jobs) {
    if (j.callDate !== callDate) continue;
    if (j.status === "failed" || j.status === "skipped") continue;
    skip.add(j.conversationId);
  }
  return skip;
}

export function summarizeAgents(
  jobs: SttBatchJob[],
  perAgent: number,
): import("./sttBatchTypes").SttBatchAgentStat[] {
  const map = new Map<
    string,
    import("./sttBatchTypes").SttBatchAgentStat
  >();
  for (const j of jobs) {
    const key = j.agentName || "(없음)";
    const row = map.get(key) ?? {
      agentName: key,
      team: j.team,
      target: perAgent,
      selected: 0,
      queued: 0,
      done: 0,
      failed: 0,
      skipped: 0,
    };
    row.selected += 1;
    if (j.status === "queued" || j.status === "running" || j.status === "pending_upload") row.queued += 1;
    if (j.status === "done") {
      row.queued += 1;
      row.done += 1;
    } else if (j.status === "failed") row.failed += 1;
    else if (j.status === "skipped") row.skipped += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.agentName.localeCompare(b.agentName, "ko"));
}

export function pendingHarvestJobs(jobs: SttBatchJob[]): SttBatchJob[] {
  return jobs.filter(
    (j) => (j.status === "queued" || j.status === "running") && Boolean(j.remoteJobId),
  );
}

export async function findSttBatchJobByRemoteId(remoteJobId: string): Promise<SttBatchJob | null> {
  const id = remoteJobId.trim();
  if (!id) return null;
  const state = await listSttBatchState();
  return state.jobs.find((j) => j.remoteJobId === id) ?? null;
}

export async function findSttBatchJobByConversation(conversationId: string): Promise<SttBatchJob | null> {
  const cid = conversationId.trim();
  if (!cid) return null;
  const state = await listSttBatchState();
  const list = state.jobs
    .filter((j) => j.conversationId === cid)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return list[0] ?? null;
}

export async function saveSttBatchTranscript(input: {
  conversationId: string;
  durationSec: number;
  remoteJobId: string | null;
  transcript: TranscriptSegment[];
}): Promise<void> {
  await mkdir(TRANSCRIPT_DIR, { recursive: true });
  const payload: TranscriptFile = {
    conversationId: input.conversationId,
    durationSec: input.durationSec,
    transcribedAt: nowIso(),
    remoteJobId: input.remoteJobId,
    transcript: input.transcript,
  };
  await writeFile(transcriptPath(input.conversationId), JSON.stringify(payload), "utf8");
}

/** 로컬 배치 전사가 있는 conversation_id 집합 */
export async function listBatchTranscriptConversationIds(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const files = await readdir(TRANSCRIPT_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(TRANSCRIPT_DIR, f), "utf8");
        const parsed = JSON.parse(raw) as Partial<TranscriptFile>;
        const cid = String(parsed.conversationId ?? "").trim();
        const transcript = Array.isArray(parsed.transcript)
          ? parsed.transcript.filter((t) => (t?.text ?? "").trim().length > 0)
          : [];
        if (cid && transcript.length) out.add(cid);
      } catch {
        /* skip corrupt file */
      }
    }
  } catch {
    /* no dir */
  }
  return out;
}

/** 배치 STT가 끝난 콜의 전사. 평가 진행의 GCP 온디맨드 호출 대신 재사용한다. */
export async function getLatestBatchTranscript(conversationId: string): Promise<{
  conversationId: string;
  analysisId: string;
  analyzedAt: string;
  durationSec: number;
  transcript: TranscriptSegment[];
} | null> {
  const cid = conversationId.trim();
  if (!cid) return null;
  try {
    const raw = await readFile(transcriptPath(cid), "utf8");
    const parsed = JSON.parse(raw) as Partial<TranscriptFile>;
    const transcript = Array.isArray(parsed.transcript)
      ? parsed.transcript.filter((t) => (t?.text ?? "").trim().length > 0)
      : [];
    if (!transcript.length) return null;
    return {
      conversationId: cid,
      analysisId: `stt-batch:${parsed.remoteJobId ?? cid}`,
      analyzedAt: parsed.transcribedAt ?? "",
      durationSec: Number(parsed.durationSec ?? 0) || 0,
      transcript,
    };
  } catch {
    return null;
  }
}

/** 스케줄은 남기고 잡·런·로컬 전사 파일을 지운다. 잘못된 파라미터로 넣은 배치를 다시 돌릴 때. */
export async function wipeSttBatchWork(): Promise<{ jobs: number; runs: number; transcripts: number }> {
  return withLock(async () => {
    const state = await load();
    const jobs = state.jobs.length;
    const runs = state.runs.length;
    state.jobs = [];
    state.runs = [];
    await save(state);
    let transcripts = 0;
    try {
      const files = await readdir(TRANSCRIPT_DIR);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        await unlink(path.join(TRANSCRIPT_DIR, f));
        transcripts += 1;
      }
    } catch {
      /* no dir */
    }
    return { jobs, runs, transcripts };
  });
}

export async function deleteSttBatchTranscriptFiles(): Promise<number> {
  let n = 0;
  try {
    const files = await readdir(TRANSCRIPT_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      await unlink(path.join(TRANSCRIPT_DIR, f));
      n += 1;
    }
  } catch {
    /* no dir */
  }
  return n;
}

/** 테스트용 */
export async function _resetSttBatchStoreForTests(): Promise<void> {
  await withLock(async () => {
    await save(empty());
  });
}

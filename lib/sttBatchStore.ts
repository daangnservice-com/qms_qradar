import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BATCH_STT_VERSION_ID, batchSttVersionId, transcriptFingerprint } from "./callArtifactVersions";
import { clampHour, clampMinute, clampPositiveInt, initialLastRunDateKst } from "./sttBatchKst";
import { isAffirmationLoop, isPromptEcho, type LocalSttSegmentDetail } from "./localSttQuality";
import { cacheInvalidate, cached, SERVER_CACHE_TTL } from "./serverCache";
import type { TranscriptSegment } from "./types";
import {
  isInFlightSttStatus,
  ONDEMAND_SCHEDULE_ID,
  ONDEMAND_STT_PRIORITY,
  type SttBatchJob,
  type SttBatchRun,
  type SttBatchRunStatus,
  type SttBatchSchedule,
  type SttBatchScheduleInput,
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
  options?: Record<string, unknown> | null;
  transcript: TranscriptSegment[];
  details?: LocalSttSegmentDetail[];
};

function keepTranscriptLine(segment: TranscriptSegment | null | undefined): segment is TranscriptSegment {
  const text = segment?.text ?? "";
  return text.trim().length > 0 && !isPromptEcho(text) && !isAffirmationLoop(text);
}

function safeCid(cid: string): string {
  return cid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function transcriptPath(conversationId: string): string {
  return path.join(TRANSCRIPT_DIR, `${safeCid(conversationId)}.json`);
}

/** 이전 회차. 최신 파일과 같은 폴더에 두면 파일명 stem이 콜 id로 잡힌다. */
function transcriptVersionsDir(conversationId: string): string {
  return path.join(TRANSCRIPT_DIR, "versions", safeCid(conversationId));
}

function archiveKey(remoteJobId: string | null | undefined, transcribedAt: string | null | undefined): string {
  const job = (remoteJobId ?? "").trim();
  if (job) return safeCid(job);
  const at = (transcribedAt ?? "").trim();
  if (at) return safeCid(at) || "prev";
  return "prev";
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
  /** true면 같은 콜 날짜에 이미 처리된 콜도 다시 넣는다. */
  reprocess?: boolean;
  jobs: Omit<SttBatchJob, "id" | "runId" | "scheduleId" | "createdAt" | "updatedAt" | "queuedAt" | "finishedAt">[];
}): Promise<{ run: SttBatchRun; jobs: SttBatchJob[] }> {
  return withLock(async () => {
    const state = await load();
    // 호출부의 확인과 여기 사이에 후보 조회(수 초)가 끼어 있어, 락 밖에서만 보면 동시에 뜬 tick이
    // 모두 통과해 같은 run을 여러 개 만든다(2026-09-11: 한 스케줄에 4~5개). 락 안에서 다시 본다.
    if (hasActiveRun(state.runs, input.schedule.id)) {
      throw new Error("이 스케줄의 배치가 이미 실행 중입니다.");
    }
    if (input.trigger === "schedule") {
      const current = state.schedules.find((s) => s.id === input.schedule.id);
      if (current?.lastRunDateKst === input.executionDateKst) {
        throw new Error("이 스케줄은 오늘 이미 실행됐습니다.");
      }
    }
    const taken = input.reprocess ? new Set<string>() : queuedConversationIds(state.jobs, input.callDate);
    const now = nowIso();
    const runId = randomUUID();
    const jobs: SttBatchJob[] = input.jobs
      .filter((j) => !taken.has(j.conversationId))
      .map((j) => ({
        ...j,
        id: randomUUID(),
        runId,
        scheduleId: input.schedule.id,
        progress: j.progress ?? null,
        stage: j.stage ?? null,
        segmentCount: j.segmentCount ?? null,
        priority: j.priority ?? 0,
        skipReuse: Boolean(j.skipReuse),
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

export type SttBatchJobPatch = Partial<
  Pick<
    SttBatchJob,
    "status" | "remoteJobId" | "error" | "queuedAt" | "finishedAt" | "progress" | "stage" | "segmentCount" | "durationSec"
  >
>;

export async function patchSttBatchJob(jobId: string, patch: SttBatchJobPatch): Promise<SttBatchJob | null> {
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

/** 여러 잡을 한 번의 읽기·쓰기로 고친다. 같은 원격 잡을 가리키는 잡들을 한꺼번에 닫을 때. 고친 수를 돌려준다. */
export async function patchSttBatchJobs(patches: { id: string; patch: SttBatchJobPatch }[]): Promise<number> {
  if (patches.length === 0) return 0;
  return withLock(async () => {
    const state = await load();
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    const now = nowIso();
    let n = 0;
    state.jobs = state.jobs.map((j) => {
      const patch = byId.get(j.id);
      if (!patch) return j;
      n += 1;
      return { ...j, ...patch, updatedAt: now };
    });
    if (n > 0) await save(state);
    return n;
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

function emptyDaily(callDate: string): import("./sttBatchTypes").SttBatchDailyStat {
  return { callDate, selected: 0, done: 0, failed: 0, inProgress: 0, skipped: 0 };
}

/** 스케줄에 속한 전체 job의 누적·콜일자별 집계 */
export function summarizeScheduleStats(
  jobs: SttBatchJob[],
  scheduleId: string,
): import("./sttBatchTypes").SttBatchScheduleStats {
  const scoped = jobs.filter((j) => j.scheduleId === scheduleId);
  const totals = { selected: 0, done: 0, failed: 0, inProgress: 0, skipped: 0 };
  const byDate = new Map<string, import("./sttBatchTypes").SttBatchDailyStat>();

  for (const j of scoped) {
    totals.selected += 1;
    const day = byDate.get(j.callDate) ?? emptyDaily(j.callDate);
    day.selected += 1;

    if (j.status === "done") {
      totals.done += 1;
      day.done += 1;
    } else if (j.status === "failed") {
      totals.failed += 1;
      day.failed += 1;
    } else if (j.status === "skipped") {
      totals.skipped += 1;
      day.skipped += 1;
    } else if (
      j.status === "pending_upload" ||
      j.status === "queued" ||
      j.status === "running"
    ) {
      totals.inProgress += 1;
      day.inProgress += 1;
    }

    byDate.set(j.callDate, day);
  }

  const daily = [...byDate.values()].sort((a, b) => b.callDate.localeCompare(a.callDate));
  return { totals, daily };
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

export function inFlightSttJobs(jobs: SttBatchJob[]): SttBatchJob[] {
  return jobs.filter((j) => isInFlightSttStatus(j.status));
}

export async function listInFlightSttJobs(): Promise<SttBatchJob[]> {
  const { jobs } = await listSttBatchState();
  return inFlightSttJobs(jobs);
}

/** 평가 진행에서 넣는 단건. 스케줄 lastRun을 건드리지 않고, 같은 스케줄 동시 실행 가드도 타지 않는다. */
export async function createOndemandSttJob(input: {
  conversationId: string;
  agentName: string;
  team: string;
  callDate: string;
  durationSec: number | null;
  requestedBy: string | null;
  skipReuse: boolean;
  /** 없으면 평가 진행 최우선(ONDEMAND_STT_PRIORITY). AI 평가 배치는 0. */
  priority?: number;
}): Promise<{ run: SttBatchRun; job: SttBatchJob }> {
  return withLock(async () => {
    const state = await load();
    const now = nowIso();
    const runId = randomUUID();
    const job: SttBatchJob = {
      id: randomUUID(),
      runId,
      scheduleId: ONDEMAND_SCHEDULE_ID,
      conversationId: input.conversationId.trim(),
      agentName: input.agentName,
      team: input.team,
      callDate: input.callDate,
      durationSec: input.durationSec,
      status: "pending_upload",
      remoteJobId: null,
      error: null,
      progress: null,
      stage: null,
      segmentCount: null,
      priority: input.priority ?? ONDEMAND_STT_PRIORITY,
      skipReuse: input.skipReuse,
      createdAt: now,
      updatedAt: now,
      queuedAt: null,
      finishedAt: null,
    };
    const run: SttBatchRun = {
      id: runId,
      scheduleId: ONDEMAND_SCHEDULE_ID,
      trigger: "ondemand",
      callDate: input.callDate,
      status: "running",
      requestedBy: input.requestedBy,
      selectedCount: 1,
      queuedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      error: null,
      startedAt: now,
      finishedAt: null,
    };
    state.runs.push(run);
    state.jobs.push(job);
    await save(state);
    return { run, job };
  });
}

export type BatchTranscriptSnapshot = {
  remoteJobId: string | null;
  options: Record<string, unknown> | null;
  details: LocalSttSegmentDetail[];
};

export async function getBatchTranscriptSnapshot(conversationId: string): Promise<BatchTranscriptSnapshot | null> {
  const cid = conversationId.trim();
  if (!cid) return null;
  try {
    const raw = await readFile(transcriptPath(cid), "utf8");
    const parsed = JSON.parse(raw) as Partial<TranscriptFile>;
    const details = Array.isArray(parsed.details) ? parsed.details.filter((d) => (d?.text ?? "").trim()) : [];
    return {
      remoteJobId: parsed.remoteJobId ?? null,
      options: parsed.options && typeof parsed.options === "object" ? parsed.options : null,
      details,
    };
  } catch {
    return null;
  }
}

async function archivePreviousTranscript(conversationId: string, next: TranscriptFile): Promise<void> {
  const currentPath = transcriptPath(conversationId);
  let raw: string;
  try {
    raw = await readFile(currentPath, "utf8");
  } catch {
    return;
  }
  let parsed: Partial<TranscriptFile>;
  try {
    parsed = JSON.parse(raw) as Partial<TranscriptFile>;
  } catch {
    return;
  }
  const prevLines = Array.isArray(parsed.transcript) ? parsed.transcript.filter(keepTranscriptLine) : [];
  const prevJob = (parsed.remoteJobId ?? "").trim();
  const nextJob = (next.remoteJobId ?? "").trim();
  if (prevJob && prevJob === nextJob) return;
  if (!transcriptFingerprint(prevLines) || transcriptFingerprint(prevLines) === transcriptFingerprint(next.transcript)) {
    return;
  }
  const dir = transcriptVersionsDir(conversationId);
  await mkdir(dir, { recursive: true });
  let key = archiveKey(parsed.remoteJobId, parsed.transcribedAt);
  let dest = path.join(dir, `${key}.json`);
  try {
    await access(dest);
    const at = safeCid(parsed.transcribedAt ?? "") || "prev";
    key = `${key}__${at}`;
    dest = path.join(dir, `${key}.json`);
  } catch {
    /* first archive for this job */
  }
  await writeFile(dest, raw, "utf8");
}

export async function saveSttBatchTranscript(input: {
  conversationId: string;
  durationSec: number;
  remoteJobId: string | null;
  transcript: TranscriptSegment[];
  options?: Record<string, unknown> | null;
  details?: LocalSttSegmentDetail[];
}): Promise<void> {
  await mkdir(TRANSCRIPT_DIR, { recursive: true });
  const payload: TranscriptFile = {
    conversationId: input.conversationId,
    durationSec: input.durationSec,
    transcribedAt: nowIso(),
    remoteJobId: input.remoteJobId,
    options: input.options ?? null,
    transcript: input.transcript.filter(keepTranscriptLine),
    details: input.details ?? [],
  };
  await archivePreviousTranscript(input.conversationId, payload);
  await writeFile(transcriptPath(input.conversationId), JSON.stringify(payload), "utf8");
  cacheInvalidate("batch-transcript-ids");
}

/** 특정 conversation에 로컬 배치 전사 파일이 있는지 — JSON 파싱 없이 경로 존재만 본다. */
export async function listBatchTranscriptPresenceByConversationIds(
  conversationIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(conversationIds.map((s) => s.trim()).filter(Boolean))];
  const out = new Set<string>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        await access(transcriptPath(id));
        out.add(id);
      } catch {
        /* missing */
      }
    }),
  );
  return out;
}

/**
 * 로컬 배치 전사가 있는 conversation_id 집합.
 * 파일명 stem을 id로 쓴다(저장 시 safeCid). JSON 전량 파싱하지 않는다.
 */
export async function listBatchTranscriptConversationIds(): Promise<Set<string>> {
  return cached("batch-transcript-ids", SERVER_CACHE_TTL.batchTranscriptIds, async () => {
    const out = new Set<string>();
    try {
      const files = await readdir(TRANSCRIPT_DIR);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const stem = f.slice(0, -".json".length).trim();
        if (stem) out.add(stem);
      }
    } catch {
      /* no dir */
    }
    return out;
  });
}

export type BatchTranscriptVersion = {
  versionId: string;
  conversationId: string;
  analysisId: string;
  analyzedAt: string;
  durationSec: number;
  transcript: TranscriptSegment[];
  remoteJobId: string | null;
};

function versionFromFile(cid: string, parsed: Partial<TranscriptFile>, versionId: string): BatchTranscriptVersion | null {
  const transcript = Array.isArray(parsed.transcript) ? parsed.transcript.filter(keepTranscriptLine) : [];
  if (!transcript.length) return null;
  return {
    versionId,
    conversationId: cid,
    analysisId: `stt-batch:${parsed.remoteJobId ?? cid}`,
    analyzedAt: parsed.transcribedAt ?? "",
    durationSec: Number(parsed.durationSec ?? 0) || 0,
    transcript,
    remoteJobId: parsed.remoteJobId ?? null,
  };
}

/** 최신 로컬 전사(`batch`)와 재처리 전에 남겨 둔 회차(`batch:{jobId}`). */
export async function listBatchTranscriptVersions(conversationId: string): Promise<BatchTranscriptVersion[]> {
  const cid = conversationId.trim();
  if (!cid) return [];
  const out: BatchTranscriptVersion[] = [];
  try {
    const raw = await readFile(transcriptPath(cid), "utf8");
    const latest = versionFromFile(cid, JSON.parse(raw) as Partial<TranscriptFile>, BATCH_STT_VERSION_ID);
    if (latest) out.push(latest);
  } catch {
    /* no latest */
  }
  try {
    const files = await readdir(transcriptVersionsDir(cid));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const key = file.slice(0, -".json".length).trim();
      if (!key) continue;
      try {
        const raw = await readFile(path.join(transcriptVersionsDir(cid), file), "utf8");
        const version = versionFromFile(cid, JSON.parse(raw) as Partial<TranscriptFile>, batchSttVersionId(key));
        if (version) out.push(version);
      } catch {
        /* skip broken archive */
      }
    }
  } catch {
    /* no archive dir */
  }
  out.sort((a, b) => (a.analyzedAt < b.analyzedAt ? 1 : a.analyzedAt > b.analyzedAt ? -1 : 0));
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
    const transcript = Array.isArray(parsed.transcript) ? parsed.transcript.filter(keepTranscriptLine) : [];
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
    await rm(path.join(TRANSCRIPT_DIR, "versions"), { recursive: true, force: true }).catch(() => {});
    cacheInvalidate("batch-transcript-ids");
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
  await rm(path.join(TRANSCRIPT_DIR, "versions"), { recursive: true, force: true }).catch(() => {});
  cacheInvalidate("batch-transcript-ids");
  return n;
}

/** 테스트용 */
export async function _resetSttBatchStoreForTests(): Promise<void> {
  await withLock(async () => {
    await save(empty());
  });
}

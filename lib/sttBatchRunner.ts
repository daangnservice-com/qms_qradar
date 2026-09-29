import { cleanupPaths, prepareUploadAudio } from "./qaAudio";
import {
  cancelLocalSttJob,
  enqueueLocalSttJob,
  findReusableLocalSttJob,
  getLocalSttHealth,
  getLocalSttJob,
  getLocalSttResult,
  localSttJobOptions,
  localSttConfigured,
  formatFetchError,
} from "./localSttClient";
import { addDaysYmd, currentDateKst } from "./sttBatchKst";
import { listSttBatchCandidates, pickNPerAgent } from "./sttBatchSelect";
import {
  createOndemandSttJob,
  createSttBatchRun,
  finishSttBatchRun,
  findSttBatchJobByConversation,
  hasActiveRun,
  listSttBatchState,
  patchSttBatchJob,
  patchSttBatchJobs,
  pendingHarvestJobs,
  queuedConversationIds,
  saveSttBatchTranscript,
  upsertSttBatchSchedule,
  type SttBatchJobPatch,
} from "./sttBatchStore";
import {
  ISSUE_REPROCESS_SCHEDULE_NAME,
  ISSUE_REPROCESS_STT_PRIORITY,
  isInFlightSttStatus,
  ONDEMAND_STT_PRIORITY,
  type SttBatchJob,
  type SttBatchRun,
  type SttBatchSchedule,
} from "./sttBatchTypes";
import { type SttIssueEnqueueTarget } from "./sttIssueTypes";

const UPLOAD_CONCURRENCY = 2;
const HARVEST_CONCURRENCY = 4;
/** tick당 조회할 원격 잡 수(qradar 잡 수가 아니다). */
const HARVEST_LIMIT = 40;

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function targetCallDate(schedule: SttBatchSchedule, now = new Date()): string {
  return addDaysYmd(currentDateKst(now), -schedule.callDateOffsetDays);
}

export async function startSttBatchRun(opts: {
  schedule: SttBatchSchedule;
  trigger: SttBatchRun["trigger"];
  callDate?: string;
  requestedBy?: string | null;
}): Promise<SttBatchRun> {
  if (!localSttConfigured()) {
    throw new Error("로컬 STT 서버 URL이 없습니다. LOCAL_STT_BASE_URL 을 설정하세요.");
  }
  const state = await listSttBatchState();
  if (hasActiveRun(state.runs, opts.schedule.id)) {
    throw new Error("이 스케줄의 배치가 이미 실행 중입니다.");
  }

  const callDate = (opts.callDate ?? targetCallDate(opts.schedule)).trim();
  const executionDateKst = currentDateKst();
  const skip = queuedConversationIds(state.jobs, callDate);

  const candidates = await listSttBatchCandidates({
    callDate,
    perAgentCount: opts.schedule.perAgentCount,
    maxTotal: opts.schedule.maxTotal,
    teams: opts.schedule.teams,
    minDurationSec: opts.schedule.minDurationSec,
    maxDurationSec: opts.schedule.maxDurationSec,
  });
  const picked = pickNPerAgent(candidates, opts.schedule.perAgentCount, skip, opts.schedule.maxTotal);

  const { run, jobs } = await createSttBatchRun({
    schedule: opts.schedule,
    trigger: opts.trigger,
    callDate,
    executionDateKst,
    requestedBy: opts.requestedBy ?? null,
    jobs: picked.map((c) => ({
      conversationId: c.conversationId,
      agentName: c.agentName,
      team: c.team,
      callDate: c.callDate,
      durationSec: c.durationSec,
      status: "pending_upload" as const,
      remoteJobId: null,
      error: null,
      progress: null,
      stage: null,
      segmentCount: null,
    })),
  });

  void processRun(run.id).catch((e) => {
    console.error("[stt-batch] processRun", e);
  });
  return run;
}

/**
 * run별 업로드 워커. 재진입·중복 시작을 막기 위해 Promise를 공유한다.
 * 라우트 번들·HMR마다 모듈이 따로 평가되므로 모듈 변수가 아니라 프로세스(globalThis)에 둔다.
 */
const g = globalThis as typeof globalThis & {
  __qradarSttUploadingRuns?: Map<string, Promise<void>>;
  __qradarSttHarvesting?: { on: boolean };
  __qradarSttHarvestCheckedAt?: Map<string, number>;
};
const uploadingRuns = (g.__qradarSttUploadingRuns ??= new Map<string, Promise<void>>());
const harvestFlag = (g.__qradarSttHarvesting ??= { on: false });
/** 원격 잡별 마지막 회수 시각(ms). tick마다 가장 오래 안 본 원격 잡부터 본다. */
const harvestCheckedAt = (g.__qradarSttHarvestCheckedAt ??= new Map<string, number>());

/** 업로드가 중간에 끊긴 run의 pending_upload 잡을 이어서 넣는다. */
export async function resumePendingSttBatchUploads(runId: string): Promise<void> {
  await processRun(runId);
}

/** pending_upload가 남은 run을 재개한다. 배포/재시작으로 processRun이 죽은 뒤 스케줄러가 다시 올린다. */
export async function resumeAllPendingSttBatchUploads(): Promise<number> {
  if (!localSttConfigured()) return 0;
  const { jobs } = await listSttBatchState();
  const pendingByRun = new Map<string, number>();
  for (const j of jobs) {
    if (j.status !== "pending_upload") continue;
    pendingByRun.set(j.runId, (pendingByRun.get(j.runId) ?? 0) + 1);
  }
  let kicked = 0;
  for (const [runId, n] of pendingByRun) {
    if (uploadingRuns.has(runId)) continue;
    kicked += 1;
    console.log(`[stt-batch] resuming pending uploads run=${runId} count=${n}`);
    void processRun(runId).catch((e) => {
      console.error(`[stt-batch] resume processRun run=${runId}`, e);
    });
  }
  return kicked;
}

async function processRun(runId: string): Promise<void> {
  const existing = uploadingRuns.get(runId);
  if (existing) return existing;

  const work = (async () => {
    try {
      const { jobs, runs } = await listSttBatchState();
      const pending = jobs.filter((j) => j.runId === runId && j.status === "pending_upload");
      if (pending.length === 0) {
        const run = runs.find((r) => r.id === runId);
        const stillActive = jobs.some(
          (j) => j.runId === runId && (j.status === "queued" || j.status === "running"),
        );
        // 업로드 워커만 죽은 채 run이 running으로 남은 경우 정리
        if (run?.status === "running" && !stillActive) {
          await finishSttBatchRun(runId, { status: "completed" });
        }
        return;
      }

      await mapPool(pending, UPLOAD_CONCURRENCY, async (job) => {
        try {
          // 같은 콜이 로컬 STT에 이미 살아 있거나 끝나 있으면 다시 받지도 올리지도 않고 그 잡을 붙인다.
          if (!job.skipReuse) {
            const live = await findReusableLocalSttJob(job.conversationId);
            if (live) {
              await patchSttBatchJob(job.id, {
                status: "queued",
                remoteJobId: live.remoteJobId,
                queuedAt: new Date().toISOString(),
                error: null,
              });
              return;
            }
          }
          const audio = await prepareUploadAudio(job.conversationId);
          try {
            const enq = await enqueueLocalSttJob({
              conversationId: job.conversationId,
              audioPath: audio.wavPath,
              priority: job.priority ?? 0,
              // 재처리: client_ref는 conversation id 그대로, 폼 필드 force=true (INTEGRATION.md).
              force: Boolean(job.skipReuse),
            });
            await patchSttBatchJob(job.id, {
              status: "queued",
              remoteJobId: enq.remoteJobId,
              queuedAt: new Date().toISOString(),
              error: null,
            });
          } finally {
            await cleanupPaths(audio.tempPaths);
          }
        } catch (e) {
          await patchSttBatchJob(job.id, {
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
            finishedAt: new Date().toISOString(),
          });
        }
      });

      const after = await listSttBatchState();
      const stillPending = after.jobs.some((j) => j.runId === runId && j.status === "pending_upload");
      if (!stillPending) {
        await finishSttBatchRun(runId, { status: "completed" });
      }
    } catch (e) {
      await finishSttBatchRun(runId, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      uploadingRuns.delete(runId);
    }
  })();

  uploadingRuns.set(runId, work);
  return work;
}

/**
 * 이번 tick에 조회할 원격 잡과, 그 원격 잡을 가리키는 qradar 잡들.
 * 같은 원격 잡은 한 번만 보고(중복 run·재선정으로 qradar 잡 여럿이 한 원격 잡을 가리킨다),
 * 가장 오래 안 본 것부터 고른다. 배열 앞에서 잘라 쓰던 때는 원격에서 아직 대기 중인 앞쪽 잡만
 * 매 tick 다시 보느라 뒤쪽의 이미 끝난 잡을 몇 시간씩 회수하지 못했다.
 * 더는 회수 대상이 아닌 원격 잡은 checkedAt에서 지운다.
 */
export function pickHarvestBatch(
  jobs: SttBatchJob[],
  checkedAt: Map<string, number>,
  limit: number,
): [string, SttBatchJob[]][] {
  const groups = new Map<string, SttBatchJob[]>();
  for (const j of pendingHarvestJobs(jobs)) {
    const id = j.remoteJobId as string;
    const list = groups.get(id);
    if (list) list.push(j);
    else groups.set(id, [j]);
  }
  for (const id of checkedAt.keys()) {
    if (!groups.has(id)) checkedAt.delete(id);
  }
  return [...groups]
    .sort(([a], [b]) => (checkedAt.get(a) ?? 0) - (checkedAt.get(b) ?? 0))
    .slice(0, limit);
}

/**
 * 큐에 넣어 둔 잡의 상태를 로컬 STT 서버에서 회수한다. 전사를 기다리지 않고 폴링만 한다.
 * 주 경로는 콜백(LOCAL_STT_CALLBACK_URL)이고, 이건 콜백을 놓친 잡을 위한 보완이다.
 */
export async function harvestSttBatchJobs(): Promise<number> {
  if (!localSttConfigured()) return 0;
  if (harvestFlag.on) return 0;
  harvestFlag.on = true;
  let updated = 0;
  try {
    const health = await getLocalSttHealth();
    if (!health.ok) {
      console.warn("[stt-batch] harvest skipped, STT server unreachable:", health.error);
      return 0;
    }
    const { jobs } = await listSttBatchState();
    const batch = pickHarvestBatch(jobs, harvestCheckedAt, HARVEST_LIMIT);
    await mapPool(batch, HARVEST_CONCURRENCY, async ([remoteId, targets]) => {
      harvestCheckedAt.set(remoteId, Date.now());
      const n = await harvestRemoteJob(remoteId, targets);
      updated += n;
    });
  } catch (e) {
    console.warn("[stt-batch] harvest failed:", e instanceof Error ? e.message : e);
  } finally {
    harvestFlag.on = false;
  }
  return updated;
}

function patchAll(jobs: SttBatchJob[], patch: SttBatchJobPatch): Promise<number> {
  return patchSttBatchJobs(jobs.map((j) => ({ id: j.id, patch })));
}

/** 원격 잡이 끝났을 때 그 잡을 가리키는 qradar 잡을 모두 닫는다. 결과는 한 번만 받는다. 바뀐 잡 수를 돌려준다. */
export async function applyRemoteSttTerminal(opts: {
  remoteJobId: string;
  jobs: SttBatchJob[];
  status: "done" | "failed" | "canceled";
  error?: string | null;
}): Promise<number> {
  const finishedAt = new Date().toISOString();
  if (opts.status !== "done") {
    return patchAll(opts.jobs, {
      status: "failed",
      error: opts.error ?? (opts.status === "canceled" ? "canceled" : "failed"),
      finishedAt,
    });
  }
  try {
    const result = await getLocalSttResult(opts.remoteJobId);
    const fallbackSec = opts.jobs.find((j) => j.durationSec)?.durationSec ?? 0;
    for (const conversationId of new Set(opts.jobs.map((j) => j.conversationId))) {
      await saveSttBatchTranscript({
        conversationId,
        durationSec: result.durationSec || fallbackSec,
        remoteJobId: opts.remoteJobId,
        transcript: result.transcript,
        options: localSttJobOptions(),
        details: result.details,
      });
    }
    return await patchAll(opts.jobs, {
      status: "done",
      progress: 1,
      stage: null,
      error: null,
      segmentCount: result.transcript.length,
      ...(result.durationSec ? { durationSec: result.durationSec } : {}),
      finishedAt,
    });
  } catch (e) {
    return patchAll(opts.jobs, {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      finishedAt,
    });
  }
}

/** 원격 잡 하나를 조회해 그 잡을 가리키는 qradar 잡들에 반영한다. 바뀐 qradar 잡 수를 돌려준다. */
async function harvestRemoteJob(remoteId: string, targets: SttBatchJob[]): Promise<number> {
  try {
    const view = await getLocalSttJob(remoteId);
    if (view.status === "done" || view.status === "failed" || view.status === "canceled") {
      return await applyRemoteSttTerminal({
        remoteJobId: remoteId,
        jobs: targets,
        status: view.status,
        error: view.error,
      });
    }
    if (view.status === "unknown") {
      return await patchAll(targets, {
        status: "failed",
        error: view.error ?? "원격 job을 찾을 수 없습니다",
        finishedAt: new Date().toISOString(),
      });
    }
    const nextStatus = view.status === "running" ? "running" : "queued";
    const stale = targets.filter(
      (j) =>
        j.status !== nextStatus ||
        j.progress !== view.progress ||
        (j.stage ?? null) !== (view.stage ?? null),
    );
    return await patchAll(stale, {
      status: nextStatus,
      progress: view.progress,
      stage: view.stage,
      ...(view.durationSec != null ? { durationSec: view.durationSec } : {}),
      // 실패로 잘못 닫혔던 잡이 콜백으로 되살아나는 경우를 위해 흔적을 지운다.
      error: null,
      finishedAt: null,
    });
  } catch (e) {
    console.warn(`[stt-batch] harvest remote=${remoteId}:`, formatFetchError(e));
    return 0;
  }
}

/**
 * 콜백으로 들어온 원격 잡을 회수한다. failed로 닫힌 잡도 다시 본다 — 서버가 잠깐 안 보였거나
 * 엉뚱한 서버가 404를 준 탓에 실패 처리됐어도, 원격 잡이 살아서 끝났다면 결과를 받아야 한다.
 * 같은 원격 잡을 여러 qradar 잡이 가리킬 수 있어(재선정 후 재사용) 모두 갱신한다.
 */
export async function harvestSttBatchJobByRemoteId(remoteJobId: string): Promise<boolean> {
  const id = remoteJobId.trim();
  if (!id) return false;
  const { jobs } = await listSttBatchState();
  const targets = jobs.filter(
    (j) => j.remoteJobId === id && j.status !== "done" && j.status !== "skipped",
  );
  if (targets.length === 0) return jobs.some((j) => j.remoteJobId === id);
  return (await harvestRemoteJob(id, targets)) > 0;
}

export type OndemandSttEnqueueResult = {
  job: SttBatchJob;
  alreadyActive: boolean;
};

/**
 * 평가 진행에서 넣는 최우선 로컬 STT.
 * 전사를 기다리지 않는다. 업로드는 백그라운드 processRun이 하고, 결과는 콜백·harvest가 회수한다.
 */
export async function enqueueOndemandLocalStt(input: {
  conversationId: string;
  agentName?: string;
  team?: string;
  callDate?: string;
  durationSec?: number | null;
  requestedBy?: string | null;
  force?: boolean;
  priority?: number;
}): Promise<OndemandSttEnqueueResult> {
  if (!localSttConfigured()) {
    throw new Error("로컬 STT 서버 URL이 없습니다. LOCAL_STT_BASE_URL 을 설정하세요.");
  }
  const conversationId = input.conversationId.trim();
  if (!conversationId) throw new Error("conversationId가 필요합니다.");

  const latest = await findSttBatchJobByConversation(conversationId);
  if (latest && isInFlightSttStatus(latest.status)) {
    if (input.force) {
      // 재처리: 원격 잡은 끊지 않는다. 로컬 추적만 새 잡으로 넘긴다.
      await patchSttBatchJob(latest.id, {
        status: "skipped",
        error: "재처리 요청으로 대체",
        finishedAt: new Date().toISOString(),
      });
    } else {
      const highPri = (latest.priority ?? 0) >= ONDEMAND_STT_PRIORITY;
      if (latest.status === "running" || latest.status === "pending_upload") {
        return { job: latest, alreadyActive: true };
      }
      if (highPri) {
        return { job: latest, alreadyActive: true };
      }
      if (latest.remoteJobId) {
        await cancelLocalSttJob(latest.remoteJobId).catch((e) => {
          console.warn("[stt-batch] ondemand cancel:", formatFetchError(e));
        });
      }
      await patchSttBatchJob(latest.id, {
        status: "skipped",
        error: "평가 진행 최우선 요청으로 대체",
        finishedAt: new Date().toISOString(),
      });
    }
  }

  const { run, job } = await createOndemandSttJob({
    conversationId,
    agentName: (input.agentName ?? "").trim() || "(미상)",
    team: (input.team ?? "").trim(),
    callDate: (input.callDate ?? currentDateKst()).trim() || currentDateKst(),
    durationSec: input.durationSec ?? null,
    requestedBy: input.requestedBy ?? null,
    skipReuse: Boolean(input.force),
    priority: input.priority,
  });
  void processRun(run.id).catch((e) => {
    console.error("[stt-batch] ondemand processRun", e);
  });
  return { job, alreadyActive: false };
}

export type IssueReprocessEnqueueResult = {
  scheduleId: string;
  runId: string;
  conversationIds: string[];
};

/**
 * 이슈 리포트 콜을 재처리 스케줄에 넣는다.
 * 우선순위는 야간 배치와 평가 온디맨드보다 높다. 같은 콜의 이전 전사는 덮기 전에 버전으로 남는다.
 */
export async function enqueueSttIssueReportCalls(input: {
  targets: SttIssueEnqueueTarget[];
  requestedBy?: string | null;
}): Promise<IssueReprocessEnqueueResult> {
  if (!localSttConfigured()) {
    throw new Error("로컬 STT 서버 URL이 없습니다. LOCAL_STT_BASE_URL 을 설정하세요.");
  }
  const targets = input.targets.filter((t) => t.conversationId.trim());
  if (targets.length === 0) throw new Error("넣을 로컬 STT 이슈 리포트가 없습니다.");

  const state = await listSttBatchState();
  let schedule = state.schedules.find((s) => s.name === ISSUE_REPROCESS_SCHEDULE_NAME) ?? null;
  if (!schedule) {
    schedule = await upsertSttBatchSchedule(
      {
        name: ISSUE_REPROCESS_SCHEDULE_NAME,
        enabled: false,
        hour: 22,
        minute: 0,
        perAgentCount: 50,
        maxTotal: 500,
        callDateOffsetDays: 1,
        minDurationSec: null,
        maxDurationSec: null,
        teams: [],
      },
      input.requestedBy ?? null,
    );
  }
  if (hasActiveRun((await listSttBatchState()).runs, schedule.id)) {
    throw new Error("이슈 리포트 재처리가 이미 올라가는 중입니다.");
  }

  for (const target of targets) {
    const latest = await findSttBatchJobByConversation(target.conversationId);
    if (!latest || !isInFlightSttStatus(latest.status)) continue;
    await patchSttBatchJob(latest.id, {
      status: "skipped",
      error: "이슈 리포트 재처리로 대체",
      finishedAt: new Date().toISOString(),
    });
  }

  const callDate = currentDateKst();
  const { run, jobs } = await createSttBatchRun({
    schedule,
    trigger: "manual",
    callDate,
    executionDateKst: callDate,
    requestedBy: input.requestedBy ?? "stt-issue-reprocess",
    reprocess: true,
    jobs: targets.map((target) => ({
      conversationId: target.conversationId,
      agentName: target.agentName.trim() || "(미상)",
      team: target.team.trim(),
      callDate: target.callDate.trim() || callDate,
      durationSec: null,
      status: "pending_upload" as const,
      remoteJobId: null,
      error: null,
      progress: null,
      stage: null,
      segmentCount: null,
      priority: ISSUE_REPROCESS_STT_PRIORITY,
      skipReuse: true,
    })),
  });

  void processRun(run.id).catch((e) => {
    console.error("[stt-batch] issue reprocess processRun", e);
  });
  return {
    scheduleId: schedule.id,
    runId: run.id,
    conversationIds: jobs.map((job) => job.conversationId),
  };
}

/** 선택 콜 상태 폴링용. 원격이 있으면 한 번 조회해 로컬 state에 반영한다. */
export async function refreshLocalSttJob(conversationId: string): Promise<SttBatchJob | null> {
  const job = await findSttBatchJobByConversation(conversationId);
  if (!job) return null;
  if (!job.remoteJobId || job.status === "done" || job.status === "failed" || job.status === "skipped") {
    return job;
  }
  await harvestSttBatchJobByRemoteId(job.remoteJobId);
  return findSttBatchJobByConversation(conversationId);
}

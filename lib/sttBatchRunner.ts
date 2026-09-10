import { ensureLocalQaAudio, removeLocalQaAudio, cleanupPaths } from "./qaAudio";
import {
  enqueueLocalSttJob,
  findReusableLocalSttJob,
  getLocalSttHealth,
  getLocalSttJob,
  getLocalSttResult,
  localSttConfigured,
  formatFetchError,
} from "./localSttClient";
import { addDaysYmd, currentDateKst } from "./sttBatchKst";
import { listSttBatchCandidates, pickNPerAgent } from "./sttBatchSelect";
import {
  createSttBatchRun,
  finishSttBatchRun,
  hasActiveRun,
  listSttBatchState,
  patchSttBatchJob,
  pendingHarvestJobs,
  queuedConversationIds,
  saveSttBatchTranscript,
} from "./sttBatchStore";
import type { SttBatchJob, SttBatchRun, SttBatchSchedule } from "./sttBatchTypes";

const UPLOAD_CONCURRENCY = 2;
const HARVEST_CONCURRENCY = 4;
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
};
const uploadingRuns = (g.__qradarSttUploadingRuns ??= new Map<string, Promise<void>>());
const harvestFlag = (g.__qradarSttHarvesting ??= { on: false });

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
          const audio = await ensureLocalQaAudio(job.conversationId);
          try {
            const enq = await enqueueLocalSttJob({
              conversationId: job.conversationId,
              audioPath: audio.wavPath,
            });
            await patchSttBatchJob(job.id, {
              status: "queued",
              remoteJobId: enq.remoteJobId,
              queuedAt: new Date().toISOString(),
              error: null,
            });
          } finally {
            await removeLocalQaAudio(job.conversationId);
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

/** 큐에 넣어 둔 잡의 상태를 로컬 STT 서버에서 회수한다. 전사를 기다리지 않고 폴링만 한다. */
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
    const pending = pendingHarvestJobs(jobs).slice(0, HARVEST_LIMIT);
    await mapPool(pending, HARVEST_CONCURRENCY, async (job) => {
      const changed = await harvestOneJob(job);
      if (changed) updated += 1;
    });
  } catch (e) {
    console.warn("[stt-batch] harvest failed:", e instanceof Error ? e.message : e);
  } finally {
    harvestFlag.on = false;
  }
  return updated;
}

export async function applyRemoteSttTerminal(opts: {
  job: SttBatchJob;
  status: "done" | "failed" | "canceled";
  error?: string | null;
}): Promise<boolean> {
  if (opts.status === "done") {
    try {
      const result = await getLocalSttResult(opts.job.remoteJobId ?? "");
      await saveSttBatchTranscript({
        conversationId: opts.job.conversationId,
        durationSec: result.durationSec || opts.job.durationSec || 0,
        remoteJobId: opts.job.remoteJobId,
        transcript: result.transcript,
      });
      await patchSttBatchJob(opts.job.id, {
        status: "done",
        progress: 1,
        stage: null,
        error: null,
        segmentCount: result.transcript.length,
        durationSec: result.durationSec || opts.job.durationSec,
        finishedAt: new Date().toISOString(),
      });
      return true;
    } catch (e) {
      await patchSttBatchJob(opts.job.id, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        finishedAt: new Date().toISOString(),
      });
      return true;
    }
  }
  await patchSttBatchJob(opts.job.id, {
    status: "failed",
    error: opts.error ?? (opts.status === "canceled" ? "canceled" : "failed"),
    finishedAt: new Date().toISOString(),
  });
  return true;
}

async function harvestOneJob(job: SttBatchJob): Promise<boolean> {
  const remoteId = job.remoteJobId;
  if (!remoteId) return false;
  try {
    const view = await getLocalSttJob(remoteId);
    if (view.status === "done") {
      return applyRemoteSttTerminal({ job, status: "done" });
    }
    if (view.status === "failed" || view.status === "canceled") {
      return applyRemoteSttTerminal({ job, status: view.status, error: view.error });
    }
    if (view.status === "unknown") {
      await patchSttBatchJob(job.id, {
        status: "failed",
        error: view.error ?? "원격 job을 찾을 수 없습니다",
        finishedAt: new Date().toISOString(),
      });
      return true;
    }
    const nextStatus = view.status === "running" ? "running" : "queued";
    if (
      job.status === nextStatus &&
      job.progress === view.progress &&
      (job.stage ?? null) === (view.stage ?? null)
    ) {
      return false;
    }
    await patchSttBatchJob(job.id, {
      status: nextStatus,
      progress: view.progress,
      stage: view.stage,
      durationSec: view.durationSec ?? job.durationSec,
      // 실패로 잘못 닫혔던 잡이 콜백으로 되살아나는 경우를 위해 흔적을 지운다.
      error: null,
      finishedAt: null,
    });
    return true;
  } catch (e) {
    console.warn(
      `[stt-batch] harvest job=${job.id} remote=${remoteId}:`,
      formatFetchError(e),
    );
    return false;
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
  let changed = false;
  for (const job of targets) {
    if (await harvestOneJob(job)) changed = true;
  }
  return changed;
}

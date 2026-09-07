import { ensureLocalQaAudio, removeLocalQaAudio, cleanupPaths } from "./qaAudio";
import {
  enqueueLocalSttJob,
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
  findSttBatchJobByRemoteId,
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

  void processRun(run.id, jobs).catch((e) => {
    console.error("[stt-batch] processRun", e);
  });
  return run;
}

/** 업로드가 중간에 끊긴 run의 pending_upload 잡을 이어서 넣는다. */
export async function resumePendingSttBatchUploads(runId: string): Promise<void> {
  const { jobs } = await listSttBatchState();
  const pending = jobs.filter((j) => j.runId === runId && j.status === "pending_upload");
  await processRun(runId, pending);
}

async function processRun(runId: string, jobs: SttBatchJob[]): Promise<void> {
  const pending = jobs.filter((j) => j.status === "pending_upload");
  try {
    await mapPool(pending, UPLOAD_CONCURRENCY, async (job) => {
      try {
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
    await finishSttBatchRun(runId, { status: "completed" });
  } catch (e) {
    await finishSttBatchRun(runId, {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

let harvesting = false;

/** 큐에 넣어 둔 잡의 상태를 로컬 STT 서버에서 회수한다. 전사를 기다리지 않고 폴링만 한다. */
export async function harvestSttBatchJobs(): Promise<number> {
  if (!localSttConfigured()) return 0;
  if (harvesting) return 0;
  harvesting = true;
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
    harvesting = false;
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

export async function harvestSttBatchJobByRemoteId(remoteJobId: string): Promise<boolean> {
  const job = await findSttBatchJobByRemoteId(remoteJobId);
  if (!job) return false;
  if (job.status === "done" || job.status === "failed" || job.status === "skipped") return true;
  return harvestOneJob(job);
}

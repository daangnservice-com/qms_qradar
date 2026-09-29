import { addDaysYmd, currentDateKst } from "./sttBatchKst";
import { enqueueOndemandLocalStt } from "./sttBatchRunner";
import { findSttBatchJobByConversation } from "./sttBatchStore";
import { isInFlightSttStatus } from "./sttBatchTypes";
import { listSttPresenceByConversationIds } from "./sttPresence";
import { listAnalyzedConversationIds } from "./analysisStore";
import { finishEvalJob, tryStartEvalJob, updateEvalJob } from "./evalSchedule";
import { runCallEvaluation } from "./runCallEvaluation";
import { listEvalBatchCandidates } from "./evalBatchSelect";
import {
  createEvalBatchRun,
  evalBatchSkipIds,
  finishEvalBatchRun,
  hasActiveEvalBatchRun,
  inFlightEvalBatchJobs,
  listEvalBatchState,
  patchEvalBatchJob,
} from "./evalBatchStore";
import type { EvalBatchJob, EvalBatchRun, EvalBatchSchedule } from "./evalBatchTypes";

const EVAL_CONCURRENCY = 1;

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

export function evalBatchTargetCallDate(schedule: EvalBatchSchedule, now = new Date()): string {
  return addDaysYmd(currentDateKst(now), -schedule.callDateOffsetDays);
}

const g = globalThis as typeof globalThis & {
  __qradarEvalBatchProcessing?: { on: boolean };
};

const processing = (g.__qradarEvalBatchProcessing ??= { on: false });

export async function startEvalBatchRun(opts: {
  schedule: EvalBatchSchedule;
  trigger: EvalBatchRun["trigger"];
  callDate?: string;
  requestedBy?: string | null;
}): Promise<EvalBatchRun> {
  const state = await listEvalBatchState();
  if (hasActiveEvalBatchRun(state.runs, opts.schedule.id)) {
    throw new Error("이 스케줄의 AI 평가 배치가 이미 실행 중입니다.");
  }

  const callDate = (opts.callDate ?? evalBatchTargetCallDate(opts.schedule)).trim();
  const executionDateKst = currentDateKst();
  const skip = evalBatchSkipIds(state.jobs, callDate);
  const { picked, needsStt } = await listEvalBatchCandidates({
    callDate,
    schedule: opts.schedule,
    skipIds: skip,
  });

  const { run } = await createEvalBatchRun({
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
      status: needsStt.has(c.conversationId) ? ("pending_stt" as const) : ("queued_eval" as const),
      analysisId: null,
      error: null,
    })),
  });

  void processEvalBatchWork().catch((e) => {
    console.error("[eval-batch] processEvalBatchWork", e);
  });
  return run;
}

export async function processEvalBatchWork(): Promise<void> {
  if (processing.on) return;
  processing.on = true;
  try {
    const { jobs, runs } = await listEvalBatchState();
    const pendingStt = jobs.filter((j) => j.status === "pending_stt");
    await mapPool(pendingStt, 2, async (job) => {
      try {
        const latest = await findSttBatchJobByConversation(job.conversationId);
        if (latest && isInFlightSttStatus(latest.status)) {
          await patchEvalBatchJob(job.id, { status: "waiting_stt", error: null });
          return;
        }
        await enqueueOndemandLocalStt({
          conversationId: job.conversationId,
          agentName: job.agentName,
          team: job.team,
          callDate: job.callDate,
          durationSec: job.durationSec,
          requestedBy: "eval-batch",
          priority: 0,
        });
        await patchEvalBatchJob(job.id, { status: "waiting_stt", error: null });
      } catch (e) {
        await patchEvalBatchJob(job.id, {
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
          finishedAt: new Date().toISOString(),
        });
      }
    });

    const waiting = (await listEvalBatchState()).jobs.filter((j) => j.status === "waiting_stt");
    if (waiting.length) {
      const presence = await listSttPresenceByConversationIds(waiting.map((j) => j.conversationId));
      for (const job of waiting) {
        if (presence.get(job.conversationId)?.hasStt) {
          await patchEvalBatchJob(job.id, { status: "queued_eval", error: null });
        }
      }
    }

    const queued = (await listEvalBatchState()).jobs.filter((j) => j.status === "queued_eval");
    await mapPool(queued, EVAL_CONCURRENCY, evaluateJob);

    const latest = await listEvalBatchState();
    const activeRuns = latest.runs.filter((r) => r.status === "running");
    for (const run of activeRuns) {
      const runJobs = latest.jobs.filter((j) => j.runId === run.id);
      const still = runJobs.some((j) =>
        j.status === "pending_stt" ||
        j.status === "waiting_stt" ||
        j.status === "queued_eval" ||
        j.status === "running_eval",
      );
      if (!still) {
        const failed = runJobs.some((j) => j.status === "failed");
        await finishEvalBatchRun(run.id, { status: failed ? "failed" : "completed" });
      }
    }
  } finally {
    processing.on = false;
  }
}

async function evaluateJob(job: EvalBatchJob): Promise<void> {
  const analyzed = await listAnalyzedConversationIds("growth", [job.conversationId]);
  if (analyzed.includes(job.conversationId)) {
    await patchEvalBatchJob(job.id, {
      status: "skipped",
      error: "이미 AI 평가됨",
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  const started = tryStartEvalJob({
    conversationId: job.conversationId,
    purpose: "call_eval",
    org: "growth",
    requestedBy: "eval-batch",
  });
  if (!started.ok) {
    return;
  }

  await patchEvalBatchJob(job.id, { status: "running_eval", error: null });
  try {
    const out = await runCallEvaluation({
      conversationId: job.conversationId,
      analyzedBy: "eval-batch",
      org: "growth",
      onProgress: (p) => {
        updateEvalJob(started.job.jobId, {
          step: p.step,
          ...(p.sttReused != null ? { sttReused: p.sttReused } : {}),
        });
      },
    });
    finishEvalJob(started.job.jobId, { status: "completed" });
    await patchEvalBatchJob(job.id, {
      status: "completed",
      analysisId: out.analysisId,
      finishedAt: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finishEvalJob(started.job.jobId, { status: "failed", error: message });
    await patchEvalBatchJob(job.id, {
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
    });
  }
}

export async function harvestEvalBatchJobs(): Promise<void> {
  const { jobs } = await listEvalBatchState();
  if (!inFlightEvalBatchJobs(jobs).length) return;
  await processEvalBatchWork();
}

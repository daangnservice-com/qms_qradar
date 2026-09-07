import { randomUUID } from "node:crypto";
import type { CallQualityOrg } from "./callQualityOrg";
import type { LlmCallPurpose } from "./llmCallLog";

/** 진행 중·최근 완료된 LLM 평가 호출 스케줄 (프로세스 메모리). */
export type EvalScheduleStatus = "running" | "completed" | "failed" | "rejected_duplicate";

export type EvalScheduleStep =
  | "queued"
  | "genesys"
  | "download"
  | "transcode"
  | "audio"
  | "analyze"
  | "save"
  | "done"
  | "error";

export type EvalScheduleJob = {
  jobId: string;
  conversationId: string;
  purpose: LlmCallPurpose;
  org: CallQualityOrg | null;
  requestedBy: string | null;
  status: EvalScheduleStatus;
  step: EvalScheduleStep;
  sttReused: boolean | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type ActiveKey = string; // conversationId

const activeByConversation = new Map<ActiveKey, EvalScheduleJob>();
/** 종료된 작업(최근). 관리자 탭에서 짧게 이력 확인용. */
const recentFinished: EvalScheduleJob[] = [];
const MAX_RECENT = 100;
const RECENT_TTL_MS = 60 * 60 * 1000; // 1시간

function nowIso() {
  return new Date().toISOString();
}

function pruneRecent() {
  const cutoff = Date.now() - RECENT_TTL_MS;
  while (recentFinished.length && new Date(recentFinished[0].finishedAt ?? 0).getTime() < cutoff) {
    recentFinished.shift();
  }
  while (recentFinished.length > MAX_RECENT) recentFinished.shift();
}

function pushFinished(job: EvalScheduleJob) {
  pruneRecent();
  recentFinished.push({ ...job });
}

/** 동일 conversation 에 진행 중 작업이 있으면 거부, 없으면 등록. */
export function tryStartEvalJob(input: {
  conversationId: string;
  purpose: LlmCallPurpose;
  org?: CallQualityOrg | null;
  requestedBy?: string | null;
}): { ok: true; job: EvalScheduleJob } | { ok: false; existing: EvalScheduleJob; rejected: EvalScheduleJob } {
  const conversationId = input.conversationId.trim();
  const existing = activeByConversation.get(conversationId);
  if (existing) {
    const rejected: EvalScheduleJob = {
      jobId: randomUUID(),
      conversationId,
      purpose: input.purpose,
      org: input.org ?? null,
      requestedBy: input.requestedBy ?? null,
      status: "rejected_duplicate",
      step: "error",
      sttReused: null,
      error: `동일 conversation(${conversationId}) 평가가 이미 진행 중입니다 (job=${existing.jobId})`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: nowIso(),
    };
    pushFinished(rejected);
    return { ok: false, existing, rejected };
  }

  const job: EvalScheduleJob = {
    jobId: randomUUID(),
    conversationId,
    purpose: input.purpose,
    org: input.org ?? null,
    requestedBy: input.requestedBy ?? null,
    status: "running",
    step: "queued",
    sttReused: null,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
  };
  activeByConversation.set(conversationId, job);
  return { ok: true, job };
}

export function updateEvalJob(
  jobId: string,
  patch: Partial<Pick<EvalScheduleJob, "step" | "sttReused" | "error">>,
): EvalScheduleJob | null {
  for (const [cid, job] of activeByConversation) {
    if (job.jobId !== jobId) continue;
    const next: EvalScheduleJob = {
      ...job,
      ...patch,
      updatedAt: nowIso(),
    };
    activeByConversation.set(cid, next);
    return next;
  }
  return null;
}

export function finishEvalJob(
  jobId: string,
  outcome: { status: "completed" | "failed"; error?: string | null; step?: EvalScheduleStep },
): EvalScheduleJob | null {
  for (const [cid, job] of activeByConversation) {
    if (job.jobId !== jobId) continue;
    activeByConversation.delete(cid);
    const finished: EvalScheduleJob = {
      ...job,
      status: outcome.status,
      step: outcome.step ?? (outcome.status === "completed" ? "done" : "error"),
      error: outcome.error ?? null,
      updatedAt: nowIso(),
      finishedAt: nowIso(),
    };
    pushFinished(finished);
    return finished;
  }
  return null;
}

export function getActiveEvalJob(conversationId: string): EvalScheduleJob | null {
  return activeByConversation.get(conversationId.trim()) ?? null;
}

export function listEvalSchedule(opts?: { includeFinished?: boolean }): {
  active: EvalScheduleJob[];
  recent: EvalScheduleJob[];
} {
  pruneRecent();
  const active = [...activeByConversation.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = opts?.includeFinished === false ? [] : [...recentFinished].reverse();
  return { active, recent };
}

/** 테스트용 */
export function _resetEvalScheduleForTests() {
  activeByConversation.clear();
  recentFinished.length = 0;
}

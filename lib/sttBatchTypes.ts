/** 로컬 STT 서버 배치 큐 — 평가 진행(온디맨드 GCP STT)과 분리. */

/** 평가 진행에서 넣은 잡. 스케줄 목록에는 안 보인다. */
export const ONDEMAND_SCHEDULE_ID = "__ondemand__";
/** 배치(기본 0)보다 앞. 실행 중인 잡은 끊지 않고, 큐에서 다음으로 뽑힌다. */
export const ONDEMAND_STT_PRIORITY = 100;
/** 이슈 리포트 재처리. 온디맨드보다 앞이라 대기 중인 잡 중 먼저 뽑힌다. */
export const ISSUE_REPROCESS_STT_PRIORITY = 200;
/** 매일 자동으로 돌리지 않는 재처리 스케줄. 화면 목록에는 보인다. */
export const ISSUE_REPROCESS_SCHEDULE_NAME = "이슈 리포트 재처리";

export type SttBatchJobStatus =
  | "pending_upload"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type SttBatchRunStatus = "running" | "completed" | "failed";

export type SttBatchSchedule = {
  id: string;
  name: string;
  enabled: boolean;
  /** KST 매일 실행 시각 (0–23) */
  hour: number;
  /** KST 분 (0–59) */
  minute: number;
  /** 구성원(상담사)당 넣을 콜 수 */
  perAgentCount: number;
  /** 1회 실행 총 상한 */
  maxTotal: number;
  /** 대상 콜 날짜 = 실행일 KST − 이 일수. 1이면 전날. */
  callDateOffsetDays: number;
  minDurationSec: number | null;
  maxDurationSec: number | null;
  /** 비우면 전 팀 */
  teams: string[];
  lastRunAt: string | null;
  /** 마지막 실행의 KST 달력일. 스케줄 due 판정용(대상 콜 날짜와 다를 수 있음). */
  lastRunDateKst: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type SttBatchJob = {
  id: string;
  runId: string;
  scheduleId: string;
  conversationId: string;
  agentName: string;
  team: string;
  callDate: string;
  durationSec: number | null;
  status: SttBatchJobStatus;
  remoteJobId: string | null;
  error: string | null;
  progress: number | null;
  stage: string | null;
  segmentCount: number | null;
  /** 클수록 로컬 STT 큐에서 먼저. 없으면 0. */
  priority?: number;
  /** true면 원격 POST에 force=true. 같은 client_ref가 있어도 새 잡(재처리). */
  skipReuse?: boolean;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  finishedAt: string | null;
};

export type SttBatchRun = {
  id: string;
  scheduleId: string;
  /** 스케줄 tick vs 배치 화면 vs 평가 진행 온디맨드 */
  trigger: "schedule" | "manual" | "ondemand";
  callDate: string;
  status: SttBatchRunStatus;
  requestedBy: string | null;
  selectedCount: number;
  queuedCount: number;
  skippedCount: number;
  failedCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type SttBatchAgentStat = {
  agentName: string;
  team: string;
  target: number;
  selected: number;
  queued: number;
  done: number;
  failed: number;
  skipped: number;
};

/** 스케줄 단위 누적·일별 STT 처리 현황 */
export type SttBatchScheduleStats = {
  totals: {
    selected: number;
    done: number;
    failed: number;
    inProgress: number;
    skipped: number;
  };
  /** 콜 대상일(callDate) 기준, 최신일 먼저 */
  daily: SttBatchDailyStat[];
};

export type SttBatchDailyStat = {
  callDate: string;
  selected: number;
  done: number;
  failed: number;
  inProgress: number;
  skipped: number;
};

export type SttBatchServerHealth = {
  configured: boolean;
  ok: boolean;
  baseUrl: string | null;
  queueDepth: number | null;
  busy: boolean | null;
  acceptingWork: boolean | null;
  reason: string | null;
  windowOpen: boolean | null;
  nextWindowAt: string | null;
  paused: boolean | null;
  overrideUntil: string | null;
  gpuUtilPct: number | null;
  currentJobId: string | null;
  error: string | null;
};

export function isInFlightSttStatus(status: SttBatchJobStatus): boolean {
  return status === "pending_upload" || status === "queued" || status === "running";
}

export function localSttQueueLabel(status: SttBatchJobStatus): string {
  switch (status) {
    case "pending_upload":
      return "로컬 STT 업로드 중";
    case "queued":
      return "로컬 STT 대기열";
    case "running":
      return "로컬 STT 전사 중";
    case "done":
      return "로컬 STT 완료";
    case "failed":
      return "로컬 STT 실패";
    case "skipped":
      return "로컬 STT 스킵";
  }
}

export type LocalSttQueueView = {
  conversationId: string;
  status: SttBatchJobStatus;
  progress: number | null;
  stage: string | null;
  error: string | null;
  priority: number;
  remoteJobId: string | null;
  updatedAt: string;
};

export function toLocalSttQueueView(job: SttBatchJob): LocalSttQueueView {
  return {
    conversationId: job.conversationId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    priority: job.priority ?? 0,
    remoteJobId: job.remoteJobId,
    updatedAt: job.updatedAt,
  };
}

export type SttBatchCandidate = {
  conversationId: string;
  agentName: string;
  team: string;
  callDate: string;
  durationSec: number | null;
};

export type SttBatchScheduleInput = {
  name: string;
  enabled: boolean;
  hour: number;
  minute: number;
  perAgentCount: number;
  maxTotal: number;
  callDateOffsetDays: number;
  minDurationSec: number | null;
  maxDurationSec: number | null;
  teams: string[];
};

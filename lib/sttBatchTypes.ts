/** 로컬 STT 서버 배치 큐 — 평가 진행(온디맨드 GCP STT)과 분리. */

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
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  finishedAt: string | null;
};

export type SttBatchRun = {
  id: string;
  scheduleId: string;
  /** 스케줄 tick vs 화면에서 바로 시작 */
  trigger: "schedule" | "manual";
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

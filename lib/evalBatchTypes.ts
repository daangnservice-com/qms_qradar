/** AI(LLM) 품질평가 배치 — STT 배치와 같은 매일 스케줄. */

export type EvalBatchSttRequirement = "done" | "pending" | "any";

export type EvalBatchJobStatus =
  | "pending_stt"
  | "waiting_stt"
  | "queued_eval"
  | "running_eval"
  | "completed"
  | "failed"
  | "skipped";

export type EvalBatchRunStatus = "running" | "completed" | "failed";

export type EvalBatchSchedule = {
  id: string;
  name: string;
  enabled: boolean;
  hour: number;
  minute: number;
  perAgentCount: number;
  maxTotal: number;
  callDateOffsetDays: number;
  /** 통화 길이 하한(분). null이면 미적용 */
  minDurationMin: number | null;
  /** 통화 길이 상한(분). null이면 미적용 */
  maxDurationMin: number | null;
  teams: string[];
  /**
   * done: STT 있는 콜만.
   * pending: STT 없는 콜만 — 고르면 로컬 STT 대기열에 넣는다.
   * any: 둘 다. STT 없는 콜은 로컬 STT 대기열에 넣는다.
   */
  sttRequirement: EvalBatchSttRequirement;
  lastRunAt: string | null;
  lastRunDateKst: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type EvalBatchJob = {
  id: string;
  runId: string;
  scheduleId: string;
  conversationId: string;
  agentName: string;
  team: string;
  callDate: string;
  durationSec: number | null;
  status: EvalBatchJobStatus;
  analysisId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type EvalBatchRun = {
  id: string;
  scheduleId: string;
  trigger: "schedule" | "manual";
  callDate: string;
  status: EvalBatchRunStatus;
  requestedBy: string | null;
  selectedCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  waitingSttCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type EvalBatchAgentStat = {
  agentName: string;
  team: string;
  target: number;
  selected: number;
  completed: number;
  failed: number;
  waitingStt: number;
  skipped: number;
};

export type EvalBatchScheduleInput = {
  name: string;
  enabled: boolean;
  hour: number;
  minute: number;
  perAgentCount: number;
  maxTotal: number;
  callDateOffsetDays: number;
  minDurationMin: number | null;
  maxDurationMin: number | null;
  teams: string[];
  sttRequirement: EvalBatchSttRequirement;
};

export function isInFlightEvalStatus(status: EvalBatchJobStatus): boolean {
  return (
    status === "pending_stt" ||
    status === "waiting_stt" ||
    status === "queued_eval" ||
    status === "running_eval"
  );
}

export function evalBatchStatusLabel(status: EvalBatchJobStatus): string {
  switch (status) {
    case "pending_stt":
      return "STT 대기열 등록";
    case "waiting_stt":
      return "STT 대기";
    case "queued_eval":
      return "평가 대기";
    case "running_eval":
      return "AI 평가 중";
    case "completed":
      return "평가 완료";
    case "failed":
      return "실패";
    case "skipped":
      return "스킵";
  }
}

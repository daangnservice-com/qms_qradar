/** AI 자동 평가 실행 스케줄 — UI/스토어 초안 타입.
 * 실제 BQ·배치 파이프라인 연동 전, 화면 IA 검증용.
 */

export type AutoEvalRecurrence =
  | { kind: "once" }
  | { kind: "weekly"; weekday: number } // 0=일 … 6=토
  | { kind: "monthly"; dayOfMonth: number };

export type AutoEvalSampleFilter = {
  /** 초 단위. null이면 미적용 */
  minDurationSec: number | null;
  maxDurationSec: number | null;
};

export type AutoEvalScheduleDraft = {
  id: string;
  name: string;
  enabled: boolean;
  /** 샘플 수집 기간 (KST 날짜) */
  rangeStart: string;
  rangeEnd: string;
  recurrence: AutoEvalRecurrence;
  /** 상담사당 목표 건수 */
  perAgentTarget: number;
  /** 스케줄 1회 실행당 총 상한 */
  maxTotal: number;
  sampleFilter: AutoEvalSampleFilter;
  /** STT: 배치(Dynamic Batch) 고정 — 초안 */
  sttMode: "v2_dynamic_batch";
  createdAt: string;
  updatedAt: string;
};

export type AutoEvalAgentProgress = {
  agentName: string;
  target: number;
  evaluated: number;
  /** 기간·조건에 맞는 후보 콜 수 (모자람 판별) */
  availableCandidates: number;
  shortage: boolean;
};

export type AutoEvalDispatchStatus =
  | "queued_batch"
  | "batch_done"
  | "awaiting_ondemand_confirm"
  | "running_ondemand"
  | "completed"
  | "failed"
  | "skipped_shortage";

export type AutoEvalDispatchRow = {
  id: string;
  scheduleId: string;
  conversationId: string;
  agentName: string;
  callDate: string;
  durationSec: number;
  status: AutoEvalDispatchStatus;
  submittedAt: string;
  batchFinishedAt: string | null;
  analysisId: string | null;
  error: string | null;
};

export type AutoEvalScheduleStats = {
  scheduleId: string;
  goalMet: boolean;
  agents: AutoEvalAgentProgress[];
  dispatchedCount: number;
  completedCount: number;
  pendingBatchCount: number;
  awaitingConfirmCount: number;
  shortageAgentCount: number;
};

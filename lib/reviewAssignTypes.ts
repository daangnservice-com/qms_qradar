/** AI 평가 완료 콜을 수기 검수 공용 레저부어에 넣는 규칙. */

export type ReviewAssignRecurrence =
  | { kind: "once" }
  | { kind: "weekly"; weekday: number }
  | { kind: "monthly"; dayOfMonth: number };

export type ReviewAssignRule = {
  id: string;
  name: string;
  enabled: boolean;
  /** 샘플 수집 기간 (KST 날짜) */
  rangeStart: string;
  rangeEnd: string;
  recurrence: ReviewAssignRecurrence;
  hour: number;
  minute: number;
  /** 상담사당 최대 할당 */
  perAgentTarget: number;
  /** 1회 실행 총 상한 */
  maxTotal: number;
  /** 평가자 1명의 수기 검수 할당량 */
  perEvaluatorQuota: number;
  minDurationMin: number | null;
  maxDurationMin: number | null;
  teams: string[];
  lastRunAt: string | null;
  lastRunDateKst: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type ReviewAssignItem = {
  id: string;
  ruleId: string;
  runId: string;
  conversationId: string;
  agentName: string;
  team: string;
  callDate: string;
  durationSec: number | null;
  assignedAt: string;
};

export type ReviewAssignRun = {
  id: string;
  ruleId: string;
  trigger: "schedule" | "manual";
  status: "running" | "completed" | "failed";
  selectedCount: number;
  skippedCount: number;
  requestedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type ReviewAssignRuleInput = {
  name: string;
  enabled: boolean;
  rangeStart: string;
  rangeEnd: string;
  recurrence: ReviewAssignRecurrence;
  hour: number;
  minute: number;
  perAgentTarget: number;
  maxTotal: number;
  perEvaluatorQuota: number;
  minDurationMin: number | null;
  maxDurationMin: number | null;
  teams: string[];
};

export type ReviewAssignQuota = {
  quota: number;
  completed: number;
  remaining: number;
  incompleteCount: number;
};

export function reservoirConversationIds(items: ReviewAssignItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const cid = items[i].conversationId.trim();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    out.push(cid);
  }
  return out;
}

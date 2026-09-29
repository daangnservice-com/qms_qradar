import { listAnalyzedConversationIds } from "./analysisStore";
import { listSttBatchCandidates, pickNPerAgent } from "./sttBatchSelect";
import { minutesToSec } from "./evalBatchSelect";
import { assignedConversationIds } from "./reviewAssignStore";
import type { ReviewAssignItem, ReviewAssignRule } from "./reviewAssignTypes";
import type { SttBatchCandidate } from "./sttBatchTypes";

export async function listReviewAssignCandidates(
  rule: ReviewAssignRule,
  already: Set<string>,
): Promise<SttBatchCandidate[]> {
  const rows = await listSttBatchCandidates({
    callDate: rule.rangeStart,
    callDateEnd: rule.rangeEnd,
    perAgentCount: rule.perAgentTarget,
    maxTotal: rule.maxTotal,
    teams: rule.teams,
    minDurationSec: minutesToSec(rule.minDurationMin),
    maxDurationSec: minutesToSec(rule.maxDurationMin),
    fetchMultiplier: 10,
  });
  const ids = rows.map((r) => r.conversationId);
  const analyzed = new Set(await listAnalyzedConversationIds("growth", ids));
  const eligible = rows.filter((r) => analyzed.has(r.conversationId) && !already.has(r.conversationId));
  return pickNPerAgent(eligible, rule.perAgentTarget, new Set(), rule.maxTotal);
}

export function toAssignItems(rows: SttBatchCandidate[]): Omit<ReviewAssignItem, "id" | "ruleId" | "runId" | "assignedAt">[] {
  return rows.map((c) => ({
    conversationId: c.conversationId,
    agentName: c.agentName,
    team: c.team,
    callDate: c.callDate,
    durationSec: c.durationSec,
  }));
}

export { assignedConversationIds };

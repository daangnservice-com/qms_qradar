import { listAnalyzedConversationIds } from "./analysisStore";
import { listSttPresenceByConversationIds } from "./sttPresence";
import { listSttBatchCandidates, pickNPerAgent } from "./sttBatchSelect";
import type { SttBatchCandidate } from "./sttBatchTypes";
import type { EvalBatchSchedule, EvalBatchSttRequirement } from "./evalBatchTypes";

export function minutesToSec(min: number | null): number | null {
  if (min == null || !Number.isFinite(min)) return null;
  return Math.max(0, Math.trunc(min) * 60);
}

export function matchesSttRequirement(hasStt: boolean, requirement: EvalBatchSttRequirement): boolean {
  if (requirement === "done") return hasStt;
  if (requirement === "pending") return !hasStt;
  return true;
}

export async function listEvalBatchCandidates(opts: {
  callDate: string;
  schedule: Pick<
    EvalBatchSchedule,
    "perAgentCount" | "maxTotal" | "teams" | "minDurationMin" | "maxDurationMin" | "sttRequirement"
  >;
  skipIds?: Set<string>;
}): Promise<{ picked: SttBatchCandidate[]; needsStt: Set<string> }> {
  const rows = await listSttBatchCandidates({
    callDate: opts.callDate,
    perAgentCount: opts.schedule.perAgentCount,
    maxTotal: opts.schedule.maxTotal,
    teams: opts.schedule.teams,
    minDurationSec: minutesToSec(opts.schedule.minDurationMin),
    maxDurationSec: minutesToSec(opts.schedule.maxDurationMin),
    fetchMultiplier: 8,
  });
  const ids = rows.map((r) => r.conversationId);
  const [presence, analyzed] = await Promise.all([
    listSttPresenceByConversationIds(ids),
    listAnalyzedConversationIds("growth", ids),
  ]);
  const analyzedSet = new Set(analyzed);
  const skip = opts.skipIds ?? new Set<string>();
  const eligible = rows.filter((r) => {
    if (analyzedSet.has(r.conversationId) || skip.has(r.conversationId)) return false;
    const hasStt = presence.get(r.conversationId)?.hasStt ?? false;
    return matchesSttRequirement(hasStt, opts.schedule.sttRequirement);
  });
  const picked = pickNPerAgent(eligible, opts.schedule.perAgentCount, new Set(), opts.schedule.maxTotal);
  const needsStt = new Set<string>();
  for (const row of picked) {
    if (!(presence.get(row.conversationId)?.hasStt ?? false)) needsStt.add(row.conversationId);
  }
  return { picked, needsStt };
}

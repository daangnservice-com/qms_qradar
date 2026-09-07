import { listEvalFlagsByConversationIds } from "./evalResultStore";
import { listConversationIdsReviewedBy } from "./evalReviewStore";
import { listActiveClaimConversationIdsBy } from "./evalReviewClaimStore";
import type { CallQualityOrg } from "./callQualityOrg";

/**
 * 내 평가 큐: 내가 남긴 수기 주석이 1개 이상이거나 검수 찜한 케이스.
 * 수기 검수 완료분은 제외.
 */
export async function listMyEvalQueueConversationIds(input: {
  email: string;
  org: CallQualityOrg;
  limit?: number;
}): Promise<string[]> {
  const lim = Math.min(Math.max(1, Math.floor(input.limit ?? 200)), 500);
  const [reviewIds, claimIds] = await Promise.all([
    listConversationIdsReviewedBy(input.email, lim),
    listActiveClaimConversationIdsBy(input.email, lim),
  ]);
  const ids = [...new Set([...reviewIds, ...claimIds].filter(Boolean))];
  if (!ids.length) return [];
  const flags = await listEvalFlagsByConversationIds(input.org, ids);
  return ids.filter((id) => !flags.get(id)?.reviewCompleted).slice(0, lim);
}

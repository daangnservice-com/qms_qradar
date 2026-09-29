import { currentDateKst } from "./sttBatchKst";
import { listReviewAssignCandidates, toAssignItems } from "./reviewAssignSelect";
import {
  assignedConversationIds,
  createReviewAssignRun,
  listReviewAssignState,
} from "./reviewAssignStore";
import type { ReviewAssignRule, ReviewAssignRun } from "./reviewAssignTypes";

export async function startReviewAssignRun(opts: {
  rule: ReviewAssignRule;
  trigger: ReviewAssignRun["trigger"];
  requestedBy?: string | null;
}): Promise<ReviewAssignRun> {
  const state = await listReviewAssignState();
  if (state.runs.some((r) => r.ruleId === opts.rule.id && r.status === "running")) {
    throw new Error("이 규칙의 할당이 이미 실행 중입니다.");
  }
  const already = assignedConversationIds(state.items);
  const picked = await listReviewAssignCandidates(opts.rule, already);
  const { run } = await createReviewAssignRun({
    rule: opts.rule,
    trigger: opts.trigger,
    executionDateKst: currentDateKst(),
    requestedBy: opts.requestedBy ?? null,
    items: toAssignItems(picked),
  });
  return run;
}

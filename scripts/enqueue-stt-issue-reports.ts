/**
 * STT 이슈 리포트의 로컬 콜을 재처리 스케줄 대기열 앞에 넣는다.
 * 이전 전사는 덮어쓰기 전에 버전으로 남는다.
 *
 * Usage: node scripts/run-local-ts.cjs scripts/enqueue-stt-issue-reports.ts
 */
import { issueReportEnqueueTargets } from "../lib/sttIssueTypes";
import { listSttIssueReports } from "../lib/sttIssueStore";
import { enqueueSttIssueReportCalls } from "../lib/sttBatchRunner";

async function main() {
  const reports = await listSttIssueReports({ limit: 500 });
  const targets = issueReportEnqueueTargets(reports);
  const gcpOnly = new Set(
    reports
      .map((r) => r.conversationId.trim())
      .filter((id) => id && !targets.some((t) => t.conversationId === id)),
  );
  if (targets.length === 0) {
    console.log(`queued=0 reports=${reports.length} gcpOnly=${gcpOnly.size}`);
    return;
  }
  const result = await enqueueSttIssueReportCalls({
    targets,
    requestedBy: "stt-issue-reprocess",
  });
  console.log(
    JSON.stringify({
      scheduleId: result.scheduleId,
      runId: result.runId,
      queued: result.conversationIds.length,
      gcpOnly: gcpOnly.size,
      conversationIds: result.conversationIds,
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

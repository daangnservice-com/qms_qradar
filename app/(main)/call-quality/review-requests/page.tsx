import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import CallQualityEval from "@/components/CallQualityEval";

/** AI 평가 완료 후 수기 검수용으로 할당된 공용 레저부어 */
export default async function CallQualityReviewRequestsPage() {
  const session = await getServerSession(authOptions);
  if (!(await ensureSessionCanAccessEvalProgress(session))) redirect("/");
  return <CallQualityEval org="growth" defaultFilters={{ reviewRequestedOnly: true }} />;
}

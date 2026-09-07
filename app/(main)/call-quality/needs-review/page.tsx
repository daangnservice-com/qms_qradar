import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import CallQualityEval from "@/components/CallQualityEval";

/** AI 평가 완료 · 수기 검수 미완료만 — 동일 워크벤치 딥링크 */
export default async function CallQualityNeedsReviewPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) redirect("/");
  return (
    <CallQualityEval
      org="growth"
      defaultFilters={{ analyzedOnly: true, reviewStatus: "incomplete" }}
    />
  );
}

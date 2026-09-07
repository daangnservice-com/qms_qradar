import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import CallQualityEval from "@/components/CallQualityEval";

/** 평가 진행 · 고위험군 필터가 켜진 동일 워크벤치 */
export default async function CallQualityHighRiskPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) redirect("/");
  return <CallQualityEval org="growth" defaultFilters={{ highRiskOnly: true }} />;
}

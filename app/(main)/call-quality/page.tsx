import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import CallQualityEval from "@/components/CallQualityEval";

// 성장문화실 콜 분석. 허용 계정(CALL_QUALITY_EMAILS)만 접근, 그 외는 파손 판별로.
export default async function CallQualityPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) redirect("/damage");
  return <CallQualityEval org="growth" />;
}

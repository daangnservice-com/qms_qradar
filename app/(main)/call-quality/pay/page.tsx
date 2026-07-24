import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessPayCallQuality } from "@/lib/adminEmails";
import CallQualityEval from "@/components/CallQualityEval";

// 페이팀 콜 분석. 허용 계정(PAY_CALL_QUALITY_EMAILS)만 접근, 그 외는 파손 판별로.
export default async function PayCallQualityPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessPayCallQuality(session?.user?.email)) redirect("/damage");
  return <CallQualityEval org="pay" />;
}

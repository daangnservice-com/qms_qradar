import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import CallQualityEval from "@/components/CallQualityEval";

// 콜 품질 평가는 허용 계정(CALL_QUALITY_EMAILS)만 접근. 그 외 계정은 파손 판별로 보낸다.
export default async function CallQualityPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) redirect("/damage");
  return <CallQualityEval />;
}

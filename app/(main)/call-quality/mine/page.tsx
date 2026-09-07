import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import CallQualityEval from "@/components/CallQualityEval";

/** 내가 수기 검수를 남겼거나 검수 찜한, 아직 완료되지 않은 케이스 */
export default async function CallQualityMinePage() {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) redirect("/");
  return <CallQualityEval org="growth" defaultFilters={{ mineOnly: true }} />;
}

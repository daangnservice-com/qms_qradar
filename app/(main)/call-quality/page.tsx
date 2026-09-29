import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import CallQualityEval from "@/components/CallQualityEval";

// 콜 평가 진행 — 도메인 구성원 전체. observe=1(청취 전용)도 같은 권한.
export default async function CallQualityPage() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessEvalProgress(session)) redirect("/");
  return <CallQualityEval org="growth" />;
}

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";

/** 월간 리포트 외 품질평가 페이지 — 리더(월간 리포트 전용)는 월간 리포트로 보낸다. */
export async function gateQualityEval() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessQualityEval(session)) redirect("/results/monthly-report");
}

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessCallQuality, ensureSessionCanAccessCallQualityObserve } from "@/lib/sessionAccessServer";
import { isTruthyQueryParam } from "@/lib/callQualityDeepLink";
import CallQualityEval from "@/components/CallQualityEval";

type SearchParams = Record<string, string | string[] | undefined>;

function queryFlag(sp: SearchParams, key: string): boolean {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isTruthyQueryParam(v ?? null);
}

// 성장문화실 평가 진행 — 개인 화이트리스트 또는 Google Groups 멤버십.
// observe=1 도 동일(평가 권한 또는 페이 화이트리스트).
export default async function CallQualityPage({
  searchParams,
}: {
  // Next 15의 PageProps는 searchParams가 Promise인 것만 받는다(동기 형태와 union 불가).
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  const sp = await searchParams;
  const observe = queryFlag(sp, "observe");

  if (observe) {
    if (!await ensureSessionCanAccessCallQualityObserve(session)) redirect("/");
    return <CallQualityEval org="growth" />;
  }

  if (!await ensureSessionCanAccessCallQuality(session)) redirect("/");
  return <CallQualityEval org="growth" />;
}

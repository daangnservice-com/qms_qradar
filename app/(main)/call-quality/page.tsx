import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import { canAccessCallQualityObserve } from "@/lib/callQualityOrg";
import { isTruthyQueryParam } from "@/lib/callQualityDeepLink";
import CallQualityEval from "@/components/CallQualityEval";

type SearchParams = Record<string, string | string[] | undefined>;

function queryFlag(sp: SearchParams, key: string): boolean {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isTruthyQueryParam(v ?? null);
}

// 성장문화실 평가 진행(테스트용 샘플 AI 평가). 허용 계정(CALL_QUALITY_EMAILS)만.
// observe=1 이면 @daangnservice.com 로그인 계정 전원 STT·녹취 청취 가능.
export default async function CallQualityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const sp = await Promise.resolve(searchParams);
  const observe = queryFlag(sp, "observe");

  if (observe) {
    if (!canAccessCallQualityObserve(email)) redirect("/");
    return <CallQualityEval org="growth" />;
  }

  if (!canAccessCallQuality(email)) redirect("/");
  return <CallQualityEval org="growth" />;
}

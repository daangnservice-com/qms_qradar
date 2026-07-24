import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { canAccessOrg } from "@/lib/callQualityOrg";
import { getAnalysisById } from "@/lib/analysisStore";
import ResultView from "@/components/ResultView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 저장된 분석 결과 1건의 공유/북마크용 전체 화면. 결과의 조직 권한이 있는 계정만.
export default async function AnalysisResultPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) redirect("/damage");

  const { id } = await params;
  const data = await getAnalysisById(id);
  const allowed = !data || canAccessOrg(data.org, session?.user?.email);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <Link
        href="/call-quality"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        콜 분석 목록으로
      </Link>

      {data && !allowed ? (
        <div className="mt-16 rounded-2xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-400">
          이 결과를 볼 권한이 없어요.
        </div>
      ) : data ? (
        <>
          <header className="mt-4 border-b border-gray-100 pb-5">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
              <ClipboardCheck className="h-5 w-5 text-green-600" />
              분석 결과
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span className="font-mono">{data.conversationId}</span>
              {data.phoneInquiryId && <span>· 상담이력 {data.phoneInquiryId}</span>}
              {data.analyzedAt && <span>· {data.analyzedAt.slice(0, 19)}</span>}
              {data.analyzedBy && <span>· {data.analyzedBy}</span>}
            </div>
          </header>
          <ResultView result={data.result} org={data.org} />
        </>
      ) : (
        <div className="mt-16 rounded-2xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-400">
          해당 분석 결과를 찾을 수 없어요.
        </div>
      )}
    </div>
  );
}

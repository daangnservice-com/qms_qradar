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
  if (!canAccessAnyCallQuality(session?.user?.email)) redirect("/");

  const { id } = await params;
  const data = await getAnalysisById(id);
  const allowed = !data || canAccessOrg(data.org, session?.user?.email);
  // 페이팀 UI는 제거됐지만(백엔드는 그대로), 공유 URL을 열었을 때도 뒤로가기는 성장문화실 목록으로.
  const backHref = "/call-quality";
  const backLabel = "평가 진행 목록으로";

  return (
    <div className="qms-page mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--fg-tertiary)] transition hover:text-[var(--fg-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      {data && !allowed ? (
        <div className="mt-16 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] py-16 text-center text-sm text-[var(--fg-tertiary)]">
          이 결과를 볼 권한이 없어요.
        </div>
      ) : data ? (
        <>
          <header className="mt-4 border-b border-[var(--border-subtle)] pb-5">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--fg-primary)]">
              <ClipboardCheck className="h-5 w-5 text-[var(--accent)]" />
              케이스 상세
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--fg-tertiary)]">
              <span className="font-mono">{data.conversationId}</span>
              {data.phoneInquiryId && <span>· 상담이력 {data.phoneInquiryId}</span>}
              {data.analyzedAt && <span>· {data.analyzedAt.slice(0, 19)}</span>}
              {data.analyzedBy && <span>· {data.analyzedBy}</span>}
            </div>
          </header>
          <div className="mt-6">
            <ResultView
              result={data.result}
              org={data.org}
              compactHeader
              humanResult={data.reviewCompletedAt ? data.humanResult : null}
              humanFinalLabel={data.reviewCompletedAt ? data.humanFinalLabel ?? null : null}
              match={data.reviewCompletedAt ? data.match : null}
            />
          </div>
        </>
      ) : (
        <div className="mt-16 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] py-16 text-center text-sm text-[var(--fg-tertiary)]">
          해당 분석 결과를 찾을 수 없어요.
        </div>
      )}
    </div>
  );
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orgFromParam, canAccessOrg } from "@/lib/callQualityOrg";
import { listEvaluationSamples } from "@/lib/evaluationSamples";
import { listAnalyzedConversationIds } from "@/lib/analysisStore";
import type { SampleFilters } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 콜 분석 대상 샘플 목록(BigQuery, 선택적 필터). 조직(탭)별 허용 계정만.
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { filters?: SampleFilters; limit?: number; org?: string };
  const org = orgFromParam(body.org);
  if (!canAccessOrg(org, session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const raw = Number(body.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 1), 500);
    const samples = await listEvaluationSamples(body.filters ?? {}, limit);
    // 저장된 분석 결과가 있는 통화는 완료로 표시(조직별 테이블 기준)
    const analyzed = new Set(await listAnalyzedConversationIds(org, samples.map((s) => s.conversationId)));
    const withAnalyzed = samples.map((s) => ({ ...s, analyzed: analyzed.has(s.conversationId) }));
    return Response.json({ samples: withAnalyzed });
  } catch (err) {
    console.error("[POST /api/call-quality/samples]", err);
    return Response.json({ error: "샘플 목록 조회에 실패했습니다." }, { status: 500 });
  }
}

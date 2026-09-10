import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessOrg } from "@/lib/sessionAccessServer";
import { orgFromParam } from "@/lib/callQualityOrg";
import { getLatestResultMeta } from "@/lib/analysisStore";
import { parseStoredEvaluationResult } from "@/lib/evalResultStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// conversation_id의 최신 저장 분석 결과 조회(조직별). 검수 메타 포함.
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const org = orgFromParam(url.searchParams.get("org"));
  if (!await ensureSessionCanAccessOrg(org, session)) return new Response("Forbidden", { status: 403 });

  const conversationId = url.searchParams.get("conversationId") ?? "";
  if (!conversationId) return Response.json({ error: "conversationId가 필요합니다." }, { status: 400 });

  try {
    const meta = await getLatestResultMeta(org, conversationId);
    if (!meta) return Response.json({ error: "저장된 분석 결과가 없어요." }, { status: 404 });
    const result = await parseStoredEvaluationResult(meta);
    if (!result || typeof result !== "object") {
      return Response.json({ error: "저장된 분석 결과가 없어요." }, { status: 404 });
    }
    return Response.json({
      result,
      meta: {
        analysisId: meta.analysisId,
        purpose: meta.purpose,
        promptVersionId: meta.promptVersionId,
        promptVersion: meta.promptVersion,
        promptVersionStatus: result.promptConfig?.version.status ?? null,
        humanResult: meta.humanResult,
        humanFinalLabel: meta.humanFinalLabel ?? null,
        aiLabel: meta.aiLabel,
        match: meta.match,
        reviewCompletedAt: meta.reviewCompletedAt,
        reviewCompletedBy: meta.reviewCompletedBy,
        analyzedAt: meta.analyzedAt,
        analyzedBy: meta.analyzedBy,
      },
    });
  } catch (err) {
    console.error("[GET /api/call-quality/results]", err);
    return Response.json({ error: "결과 조회에 실패했습니다." }, { status: 500 });
  }
}

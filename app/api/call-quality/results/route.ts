import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { CALL_EVAL_ORG } from "@/lib/callQualityOrg";
import { getLatestResultMeta } from "@/lib/analysisStore";
import {
  getEvalResultByAnalysisId,
  listEvalResultSummaries,
  parseStoredEvaluationResult,
} from "@/lib/evalResultStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resultPayload(result: NonNullable<Awaited<ReturnType<typeof parseStoredEvaluationResult>>>, meta: {
  analysisId: string;
  purpose: string | null;
  promptVersionId: string | null;
  promptVersion: string | null;
  humanResult: string;
  humanFinalLabel?: string;
  aiLabel: string;
  match: boolean | null;
  reviewCompletedAt: string | null;
  reviewCompletedBy: string | null;
  analyzedAt: string;
  analyzedBy: string | null;
}) {
  return {
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
  };
}

// conversation_id의 저장 분석 결과 조회(조직별). 기본은 최신, analysisId로 다른 버전.
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const org = CALL_EVAL_ORG;
  if (!await ensureSessionCanAccessEvalProgress(session)) return new Response("Forbidden", { status: 403 });

  const conversationId = url.searchParams.get("conversationId") ?? "";
  if (!conversationId) return Response.json({ error: "conversationId가 필요합니다." }, { status: 400 });
  const analysisId = (url.searchParams.get("analysisId") ?? "").trim();

  try {
    const versionsPromise = listEvalResultSummaries({ conversationId, org });
    if (analysisId) {
      const found = await getEvalResultByAnalysisId(analysisId);
      if (!found || found.row.conversationId !== conversationId) {
        return Response.json({ error: "저장된 분석 결과가 없어요." }, { status: 404 });
      }
      if (found.row.org && found.row.org !== org) {
        return Response.json({ error: "저장된 분석 결과가 없어요." }, { status: 404 });
      }
      const versions = await versionsPromise;
      return Response.json({
        result: found.result,
        meta: resultPayload(found.result, found.row),
        versions,
      });
    }

    const meta = await getLatestResultMeta(org, conversationId);
    if (!meta) return Response.json({ error: "저장된 분석 결과가 없어요." }, { status: 404 });
    const result = await parseStoredEvaluationResult(meta);
    if (!result || typeof result !== "object") {
      return Response.json({ error: "저장된 분석 결과가 없어요." }, { status: 404 });
    }
    const versions = await versionsPromise;
    return Response.json({
      result,
      meta: resultPayload(result, meta),
      versions,
    });
  } catch (err) {
    console.error("[GET /api/call-quality/results]", err);
    return Response.json({ error: "결과 조회에 실패했습니다." }, { status: 500 });
  }
}

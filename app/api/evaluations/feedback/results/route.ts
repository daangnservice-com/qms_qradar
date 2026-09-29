import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { FEEDBACK_SOURCE_SYSTEM } from "@/lib/feedbackSamples";
import {
  getLatestEvaluationItemResult,
  parseStoredEvaluationItemResult,
} from "@/lib/evaluationItemResultStore";
import { getPromptConfigByVersionId } from "@/lib/promptStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 인앱 문의 스레드의 최신 저장 평가 결과. 전화 `/api/call-quality/results` 와 같은 역할. */
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessEvalProgress(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  const sourceId = new URL(req.url).searchParams.get("sourceId")?.trim() ?? "";
  if (!sourceId) {
    return NextResponse.json({ error: "sourceId가 필요합니다." }, { status: 400 });
  }

  try {
    const row = await getLatestEvaluationItemResult({
      channel: "feedback",
      sourceSystem: FEEDBACK_SOURCE_SYSTEM,
      sourceId,
    });
    if (!row) {
      return NextResponse.json({ error: "저장된 평가 결과가 없습니다." }, { status: 404 });
    }
    const result = await parseStoredEvaluationItemResult(row);
    if (!result) {
      return NextResponse.json({ error: "저장된 평가 결과가 없습니다." }, { status: 404 });
    }
    if (!result.promptConfig && row.promptVersionId) {
      try {
        const promptConfig = await getPromptConfigByVersionId(row.promptVersionId);
        if (promptConfig) result.promptConfig = promptConfig;
      } catch (error) {
        console.warn(
          "[GET /api/evaluations/feedback/results] promptConfig:",
          error instanceof Error ? error.message : error,
        );
      }
    }
    return NextResponse.json({
      result,
      meta: {
        analysisId: row.analysisId,
        purpose: row.purpose,
        promptVersionId: row.promptVersionId,
        promptVersion: row.promptVersion,
        promptVersionStatus: result.promptConfig?.version.status ?? null,
        aiLabel: row.aiLabel,
        analyzedAt: row.analyzedAt,
        analyzedBy: row.analyzedBy,
      },
    });
  } catch (error) {
    console.error("[GET /api/evaluations/feedback/results]", error);
    return NextResponse.json({ error: "결과 조회에 실패했습니다." }, { status: 500 });
  }
}

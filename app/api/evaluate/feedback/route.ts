import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import {
  FEEDBACK_SOURCE_SYSTEM,
  listFeedbackSamples,
} from "@/lib/feedbackSamples";
import { evaluateText } from "@/lib/textEvaluation";
import { saveEvaluationItemResult } from "@/lib/evaluationItemResultStore";

export const runtime = "nodejs";

type Body = {
  sourceId?: string;
};

/** 원천 스레드를 서버에서 다시 읽어 평가하는 인앱 문의 전용 평가 API. */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!canAccessCallQuality(email) || !email) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const sourceId = String(body.sourceId ?? "").trim();
  if (!sourceId) {
    return NextResponse.json({ error: "sourceId가 필요합니다." }, { status: 400 });
  }

  try {
    const [sample] = await listFeedbackSamples({ sourceIds: [sourceId] }, 1);
    if (!sample || sample.sourceId !== sourceId) {
      return NextResponse.json({ error: "평가할 인앱 문의를 찾을 수 없습니다." }, { status: 404 });
    }
    const result = await evaluateText(sample.turns, {
      channel: "feedback",
      sourceSystem: FEEDBACK_SOURCE_SYSTEM,
      sourceId,
    });
    const row = await saveEvaluationItemResult({
      channel: "feedback",
      sourceSystem: FEEDBACK_SOURCE_SYSTEM,
      sourceId,
      purpose: "text_eval",
      analyzedBy: email,
      promptVersionId: result.promptConfig?.version.versionId,
      promptVersion: result.promptConfig?.version.versionLabel,
      llmCallId: result.llmCallId,
      result,
      inputSnapshot: { turns: result.evaluation.conversation ?? [] },
    });
    return NextResponse.json({
      ok: true,
      channel: "feedback",
      sourceId,
      analysisId: row.analysisId,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/evaluate/feedback]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

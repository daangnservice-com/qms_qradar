import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import {
  FEEDBACK_SOURCE_SYSTEM,
  listFeedbackSamples,
  type FeedbackSampleFilters,
} from "@/lib/feedbackSamples";
import { listLatestEvaluationItemResults } from "@/lib/evaluationItemResultStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  filters?: FeedbackSampleFilters;
  limit?: number;
};

/** 인앱 문의 스레드 목록. 전화 전용 call-quality 샘플 API와 분리한다. */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }

  try {
    const rawLimit = Number(body.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);
    const samples = await listFeedbackSamples(body.filters ?? {}, limit);
    const results = await listLatestEvaluationItemResults(
      samples.map((sample) => ({
        channel: "feedback" as const,
        sourceSystem: sample.sourceSystem,
        sourceId: sample.sourceId,
      })),
    );
    const adminOptions = [
      ...new Set(
        samples.flatMap((sample) => sample.participatingAdmins.map((admin) => admin.name)).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "ko"));
    return NextResponse.json({
      channel: "feedback",
      sourceSystem: FEEDBACK_SOURCE_SYSTEM,
      adminOptions,
      samples: samples.map((sample) => {
        const result = results.get(`feedback:${sample.sourceSystem}:${sample.sourceId}`);
        return {
          ...sample,
          analyzed: Boolean(result),
          analysisId: result?.analysisId ?? null,
          analyzedAt: result?.analyzedAt ?? null,
          aiLabel: result?.aiLabel ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("[POST /api/evaluations/feedback/samples]", error);
    return NextResponse.json({ error: "인앱 문의 샘플 조회에 실패했습니다." }, { status: 500 });
  }
}

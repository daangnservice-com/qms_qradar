import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orgFromParam, canAccessOrg } from "@/lib/callQualityOrg";
import { markReviewComplete } from "@/lib/evalResultStore";
import { releaseReviewClaim } from "@/lib/evalReviewClaimStore";

export const runtime = "nodejs";

/** 검수 완료: eval_review_completions 에 이벤트 append. human_result 는 조회 시 파생 */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { conversationId?: string; org?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const org = orgFromParam(body.org);
  if (!canAccessOrg(org, email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId가 필요합니다." }, { status: 400 });
  }

  try {
    const row = await markReviewComplete({
      conversationId,
      org,
      completedBy: email,
    });
    await releaseReviewClaim({ conversationId, releasedBy: email, force: true }).catch((e) => {
      console.warn("[reviews/complete] release claim:", e instanceof Error ? e.message : e);
    });
    return NextResponse.json({
      ok: true,
      analysisId: row.analysisId,
      humanResult: row.humanResult,
      humanFinalLabel: row.humanFinalLabel ?? null,
      aiLabel: row.aiLabel,
      match: row.match,
      reviewCompletedAt: row.reviewCompletedAt,
      reviewCompletedBy: row.reviewCompletedBy,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /없습니다/.test(msg) ? 404 : 500;
    console.error("[POST /api/call-quality/reviews/complete]", e);
    return NextResponse.json({ error: msg }, { status });
  }
}

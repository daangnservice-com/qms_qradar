import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessCallQuality } from "@/lib/sessionAccessServer";
import {
  ReviewClaimConflictError,
  claimReview,
  getActiveClaim,
  releaseReviewClaim,
} from "@/lib/evalReviewClaimStore";

export const runtime = "nodejs";

/** 검수 찜하기 / 진행 취소 */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!await ensureSessionCanAccessCallQuality(session) || !email) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  let body: { conversationId?: string; release?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId 필요" }, { status: 400 });
  }

  try {
    if (body.release) {
      await releaseReviewClaim({ conversationId, releasedBy: email });
      return NextResponse.json({ ok: true, claim: null });
    }
    const claim = await claimReview({ conversationId, claimedBy: email });
    return NextResponse.json({ ok: true, claim });
  } catch (e) {
    if (e instanceof ReviewClaimConflictError) {
      const current = await getActiveClaim(conversationId);
      return NextResponse.json(
        { error: e.message, claim: current, claimedBy: e.claimedBy },
        { status: 409 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[POST /api/call-quality/reviews/claim]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

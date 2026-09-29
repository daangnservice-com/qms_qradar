import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { getCsatByCsatId } from "@/lib/csatServer";
import { getServingFeedbackCsat } from "@/lib/feedbackServingStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 인앱 문의 스레드 1건의 고객 설문(CSAT). 콜 채널 녹취 화면의 CSAT 패널과 같은 상세.
// 집계 뷰의 csat_id로 원천 rawlog를 읽고, 설문 미참여는 csat: null + 200으로 답한다(404 아님).
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!(await ensureSessionCanAccessEvalProgress(session))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  const csatId = new URL(req.url).searchParams.get("csatId")?.trim() ?? "";
  if (!csatId) {
    return NextResponse.json({ error: "csatId가 필요합니다." }, { status: 400 });
  }

  try {
    // 서빙 사본(1시간 주기)에 없을 때만 원천을 읽는다. 원천 뷰는 한 번에 약 600MB를 긁는다.
    const csat = (await getServingFeedbackCsat(csatId)) ?? (await getCsatByCsatId(csatId));
    return NextResponse.json({ csat });
  } catch (err) {
    console.error("[GET /api/evaluations/feedback/csat]", err);
    return NextResponse.json({ error: "CSAT 조회에 실패했습니다." }, { status: 500 });
  }
}

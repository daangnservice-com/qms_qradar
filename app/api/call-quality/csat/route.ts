import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orgFromParam } from "@/lib/callQualityOrg";
import { ensureSessionCanAccessCallQualityPlayback } from "@/lib/sessionAccessServer";
import { getCsatByPhoneInquiryId } from "@/lib/csat";
import { resolvePhoneInquiryIdByConversationId } from "@/lib/evaluationSamples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 통화 1건의 고객 설문(CSAT). 녹취 화면의 CSAT 패널용.
// CSAT은 상담이력 ID(=inquiry_id)로 붙는다 — 없으면 conversationId로 역조회한다.
// 설문 미참여는 정상 상태라 csat: null + 200으로 답한다(404 아님).
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const org = orgFromParam(url.searchParams.get("org"));
  // 청취 전용 계정도 녹취를 듣는 화면에서 CSAT을 본다(재생 권한과 같은 기준).
  if (!(await ensureSessionCanAccessCallQualityPlayback(org, session))) {
    return new Response("Forbidden", { status: 403 });
  }

  const conversationId = (url.searchParams.get("conversationId") ?? "").trim();
  const given = (
    url.searchParams.get("phoneInquiryId") ??
    url.searchParams.get("inquiry_id") ??
    ""
  ).trim();
  if (!conversationId && !given) {
    return Response.json({ error: "conversationId 또는 phoneInquiryId가 필요합니다." }, { status: 400 });
  }

  try {
    const phoneInquiryId = given || (await resolvePhoneInquiryIdByConversationId(conversationId));
    if (!phoneInquiryId) return Response.json({ csat: null, phoneInquiryId: null });
    const csat = await getCsatByPhoneInquiryId(phoneInquiryId);
    return Response.json({ csat, phoneInquiryId });
  } catch (err) {
    console.error("[GET /api/call-quality/csat]", err);
    return Response.json({ error: "CSAT 조회에 실패했습니다." }, { status: 500 });
  }
}

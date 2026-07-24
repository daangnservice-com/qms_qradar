import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orgFromParam, canAccessOrg } from "@/lib/callQualityOrg";
import { getLatestResultByConversation } from "@/lib/analysisStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// conversation_id의 최신 저장 분석 결과 조회(조직별 테이블). 조직 허용 계정만.
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const org = orgFromParam(url.searchParams.get("org"));
  if (!canAccessOrg(org, session.user.email)) return new Response("Forbidden", { status: 403 });

  const conversationId = url.searchParams.get("conversationId") ?? "";
  if (!conversationId) return Response.json({ error: "conversationId가 필요합니다." }, { status: 400 });

  try {
    const result = await getLatestResultByConversation(org, conversationId);
    if (!result) return Response.json({ error: "저장된 분석 결과가 없어요." }, { status: 404 });
    return Response.json({ result });
  } catch (err) {
    console.error("[GET /api/call-quality/results]", err);
    return Response.json({ error: "결과 조회에 실패했습니다." }, { status: 500 });
  }
}

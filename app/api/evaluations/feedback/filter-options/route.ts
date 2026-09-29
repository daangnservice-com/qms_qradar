import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { listFeedbackFilterOptions } from "@/lib/feedbackSamples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 인앱 문의 필터 드롭다운용 고유값(소속·어드민·카테고리).
// 콜 품질 필터 옵션과 응답 모양은 같지만 원천 뷰가 달라 엔드포인트를 나눈다.
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!await ensureSessionCanAccessEvalProgress(session)) return new Response("Forbidden", { status: 403 });

  try {
    return Response.json(await listFeedbackFilterOptions());
  } catch (err) {
    console.error("[GET /api/evaluations/feedback/filter-options]", err);
    // 실패는 500으로 알린다. 200+빈 옵션으로 삼키면 "값이 없어요"와 구분이 안 된다.
    return Response.json({ error: "필터 옵션을 불러오지 못했습니다." }, { status: 500 });
  }
}

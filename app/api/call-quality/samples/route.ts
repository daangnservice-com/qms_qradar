import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { CALL_EVAL_ORG } from "@/lib/callQualityOrg";
import { listServingSamples } from "@/lib/callServingStore";
import { listReviewRequestConversationIds } from "@/lib/reviewAssignStore";
import type { SampleFilters } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 콜 목록은 call_serving 인덱스 조회 한 번이다. 원천 pull·덤프는 요청 경로 밖에 둔다.
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { filters?: SampleFilters; limit?: number; org?: string };
  const org = CALL_EVAL_ORG;
  if (!await ensureSessionCanAccessEvalProgress(session)) return new Response("Forbidden", { status: 403 });

  try {
    const raw = Number(body.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 1), 500);
    const filters = body.filters ?? {};
    const reviewRequestIds = filters.reviewRequestedOnly ? await listReviewRequestConversationIds() : null;
    const samples = await listServingSamples({
      filters,
      limit,
      mineEmail: session.user.email,
      reviewRequestIds,
    });
    return Response.json({ samples });
  } catch (err) {
    console.error("[POST /api/call-quality/samples]", err);
    return Response.json({ error: "샘플 목록 조회에 실패했습니다." }, { status: 500 });
  }
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import { listEvaluationSamples } from "@/lib/evaluationSamples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 콜 품질 평가 대상 샘플 목록(BigQuery 뷰). karla 단독 접근.
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!canAccessCallQuality(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const raw = Number(new URL(req.url).searchParams.get("limit") ?? "100");
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 1), 500);
    const samples = await listEvaluationSamples(limit);
    return Response.json({ samples });
  } catch (err) {
    console.error("[GET /api/call-quality/samples]", err);
    return Response.json({ error: "샘플 목록 조회에 실패했습니다." }, { status: 500 });
  }
}

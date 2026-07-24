import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import { listFilterOptions } from "@/lib/evaluationSamples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 필터 드롭다운용 고유값(팀·카테고리·닉네임). 허용 계정만.
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!canAccessCallQuality(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    return Response.json(await listFilterOptions());
  } catch (err) {
    console.error("[GET /api/call-quality/filter-options]", err);
    // 실패해도 패널이 동작하도록 빈 옵션으로 응답(드롭다운만 비게 됨).
    return Response.json({ teams: [], categories: [], adminNames: [] }, { status: 200 });
  }
}

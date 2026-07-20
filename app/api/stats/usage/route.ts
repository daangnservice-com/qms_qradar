import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { getUsageStats } from "@/lib/bigquery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사용량 대시보드 데이터. ?days=N (기본 30, 최대 365)
// 개인별 접속기록이 포함되므로 관리자(ADMIN_EMAILS = karla@…)만 조회 가능.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!isAdmin(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const raw = Number(new URL(req.url).searchParams.get("days") ?? "30");
    const days = Math.min(Math.max(Number.isFinite(raw) ? raw : 30, 1), 365);
    const stats = await getUsageStats(days);
    return Response.json(stats);
  } catch (err) {
    console.error("[GET /api/stats/usage]", err);
    return Response.json({ error: "사용량 조회에 실패했습니다." }, { status: 500 });
  }
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { getFeedbackStats, deleteFeedback } from "@/lib/bigquery";
import { deleteFeedbackImages } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 파손 판별 피드백 대시보드 데이터. ?days=N (기본 90, 최대 365)
// 코멘트·결과 등 민감정보 포함 → 관리자(ADMIN_EMAILS)만 조회.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!isAdmin(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const raw = Number(new URL(req.url).searchParams.get("days") ?? "90");
    const days = Math.min(Math.max(Number.isFinite(raw) ? raw : 90, 1), 365);
    const stats = await getFeedbackStats(days);
    return Response.json(stats);
  } catch (err) {
    console.error("[GET /api/stats/feedback]", err);
    return Response.json({ error: "피드백 조회에 실패했습니다." }, { status: 500 });
  }
}

// 피드백 삭제(관리자 전용). body: { feedbackId }.
// tombstone 적재로 목록/집계에서 즉시 제외하고, GCS 사진은 실삭제한다.
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!isAdmin(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const { feedbackId } = (await req.json()) as { feedbackId?: string };
    if (!feedbackId || typeof feedbackId !== "string") {
      return Response.json({ error: "feedbackId가 필요합니다." }, { status: 400 });
    }
    await deleteFeedback(feedbackId, session.user.email);
    await deleteFeedbackImages(feedbackId);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/stats/feedback]", err);
    return Response.json({ error: "피드백 삭제에 실패했습니다." }, { status: 500 });
  }
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { getChatStats, deleteChatTurn } from "@/lib/bigquery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 챗봇 트래킹 대시보드 데이터(질문/답변 + 답변별 평가). ?days=N (기본 90, 최대 365)
// 질문·답변 내용 포함 → 관리자(ADMIN_EMAILS)만 조회.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!isAdmin(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const raw = Number(new URL(req.url).searchParams.get("days") ?? "90");
    const days = Math.min(Math.max(Number.isFinite(raw) ? raw : 90, 1), 365);
    const stats = await getChatStats(days);
    return Response.json(stats);
  } catch (err) {
    console.error("[GET /api/stats/chat]", err);
    return Response.json({ error: "챗봇 로그 조회에 실패했습니다." }, { status: 500 });
  }
}

// 챗봇 질문·답변 삭제(관리자 전용). body: { messageId }.
// tombstone 적재로 목록/집계에서 즉시 제외한다.
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!isAdmin(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const { messageId } = (await req.json()) as { messageId?: string };
    if (!messageId || typeof messageId !== "string") {
      return Response.json({ error: "messageId가 필요합니다." }, { status: 400 });
    }
    await deleteChatTurn(messageId, session.user.email);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/stats/chat]", err);
    return Response.json({ error: "삭제에 실패했습니다." }, { status: 500 });
  }
}

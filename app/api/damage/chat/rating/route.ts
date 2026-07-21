import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { insertChatRating } from "@/lib/bigquery";

export const runtime = "nodejs";

// 챗봇 답변에 대한 좋아요/나빠요. body: { messageId, rating }.
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  try {
    const { messageId, rating } = (await req.json()) as { messageId?: string; rating?: string };
    if (!messageId || typeof messageId !== "string") {
      return NextResponse.json({ error: "messageId가 필요해요." }, { status: 400 });
    }
    if (rating !== "good" && rating !== "bad") {
      return NextResponse.json({ error: "rating은 good 또는 bad여야 해요." }, { status: 400 });
    }
    await insertChatRating({ messageId, email, rating });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "평가 저장 중 오류" }, { status: 500 });
  }
}

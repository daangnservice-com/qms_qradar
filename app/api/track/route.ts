import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { insertUsageEvent } from "@/lib/bigquery";

export const runtime = "nodejs";

// 페이지 조회 트래킹 수신부(pageview). 로그인 사용자의 화면 조회를 BigQuery(usage_events)에 적재.
// 기능 사용(액션) 이벤트는 클라이언트가 아니라 각 API 핸들러에서 서버측으로 기록한다(lib/serverTrack.ts).
// fire-and-forget: 어떤 경우에도 204로 응답해 클라이언트 UX를 막지 않는다.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response(null, { status: 204 }); // 비로그인은 집계 제외

  try {
    const { path } = (await req.json()) as { path?: string };
    if (!path || typeof path !== "string" || path.length > 300) return new Response(null, { status: 204 });
    // API·정적 자원·로그인 페이지는 제외
    if (path.startsWith("/api") || path.startsWith("/_next") || path === "/login") {
      return new Response(null, { status: 204 });
    }
    await insertUsageEvent({ email: session.user.email, path });
  } catch (err) {
    console.error("[POST /api/track]", err);
  }
  return new Response(null, { status: 204 });
}

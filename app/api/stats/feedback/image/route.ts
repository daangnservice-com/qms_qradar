import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { signedReadUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 피드백 이미지 열람(관리자 전용). ?path=<GCS object> → v4 signed URL로 302 리다이렉트.
// 피드백 이미지 경로 접두사만 허용해 임의 객체 접근을 막는다.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!isAdmin(session.user.email)) return new Response("Forbidden", { status: 403 });

  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path.startsWith("damage-feedback/") || path.includes("..")) {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const url = await signedReadUrl(path);
    if (!url) return new Response("Not Found", { status: 404 }); // TTL 만료 등으로 객체 없음
    return Response.redirect(url, 302);
  } catch (err) {
    console.error("[GET /api/stats/feedback/image]", err);
    return new Response("Error", { status: 500 });
  }
}

import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { withAuth } from "next-auth/middleware";
import { splitHostPort, toNipIoHost } from "@/lib/lanHost";

/**
 * Google OAuth는 private IP redirect_uri를 거부한다.
 * IP로 접속하면 *.nip.io 호스트로 보내 Host/콜백이 도메인이 되게 한다.
 */
function redirectPrivateIpToNipIo(req: NextRequest): NextResponse | null {
  const hostHeader = req.headers.get("host");
  if (!hostHeader) return null;

  const nipHost = toNipIoHost(hostHeader);
  if (!nipHost) return null;

  const { hostname, port } = splitHostPort(nipHost);
  const url = req.nextUrl.clone();
  url.hostname = hostname;
  if (port) url.port = port;
  else url.port = "";
  url.protocol = "http:";

  return NextResponse.redirect(url);
}

const authMiddleware = withAuth({
  pages: { signIn: "/login" },
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  const nipRedirect = redirectPrivateIpToNipIo(req);
  if (nipRedirect) return nipRedirect;

  const path = req.nextUrl.pathname;
  // withAuth 적용 제외 — OAuth·로그인·헬스·정적
  if (
    path.startsWith("/api/auth") ||
    path.startsWith("/api/health") ||
    path.startsWith("/api/eval-ops/stt-batch/callback") ||
    path.startsWith("/ref") ||
    path === "/login" ||
    path.startsWith("/_next/static") ||
    path.startsWith("/_next/image") ||
    path === "/favicon.ico" ||
    path === "/icon.png" ||
    path === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (authMiddleware as any)(req, event);
}

export const config = {
  // login·api/auth 도 매칭 → private IP면 nip.io로 먼저 보냄
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|robots.txt).*)"],
};

import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import { toNipIoHost } from "@/lib/lanHost";

const nextAuthHandler = NextAuth(authOptions);

/**
 * NextAuth v4 builds OAuth callback from NEXTAUTH_URL / trusted Host.
 * Google rejects private-IP redirect_uri ("device_id and device_name are required").
 *
 * - Map private IP Host → *.nip.io
 * - Prefer NEXTAUTH_URL over AUTH_TRUST_HOST+Host so IP never leaks into redirect_uri
 * - Default proto to http when x-forwarded-proto is missing (AUTH_TRUST_HOST otherwise forces https)
 */
function syncNextAuthUrlFromRequest(req: NextRequest) {
  const trust =
    process.env.NODE_ENV === "development" ||
    process.env.AUTH_TRUST_HOST === "true" ||
    process.env.AUTH_TRUST_HOST === "1";
  if (!trust) return;

  const rawHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!rawHost) return;

  const host = toNipIoHost(rawHost) ?? rawHost;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.nextUrl.protocol === "https:" ? "https" : "http");

  // detectOrigin() ignores NEXTAUTH_URL when AUTH_TRUST_HOST is set, and would
  // keep a private-IP Host (or default proto to https). Drive origin via env only.
  delete process.env.AUTH_TRUST_HOST;
  process.env.NEXTAUTH_URL = `${proto}://${host}`;
}

async function handler(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  syncNextAuthUrlFromRequest(req);
  return nextAuthHandler(req, context);
}

export { handler as GET, handler as POST };

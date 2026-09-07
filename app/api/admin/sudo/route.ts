import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { getEffectiveEmail, getSudoTarget, SUDO_COOKIE } from "@/lib/sudoSession";

export const runtime = "nodejs";

/** 현재 sudo 상태 (관리자) */
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  const realEmail = session?.user?.email ?? "";
  if (!isAdmin(realEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const eff = await getEffectiveEmail(realEmail);
  const sudo = await getSudoTarget();
  return NextResponse.json({
    sudoActive: eff.sudoActive,
    effectiveEmail: eff.email,
    realEmail: eff.realEmail,
    sudoTarget: sudo,
  });
}

/** sudo 시작/해제 (관리자). body: { email: string | null } */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const realEmail = session?.user?.email ?? "";
  if (!isAdmin(realEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const email = body.email?.trim().toLowerCase() || null;

  if (!email) {
    const res = NextResponse.json({ ok: true, sudoActive: false, effectiveEmail: realEmail.toLowerCase() });
    res.cookies.set(SUDO_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0, sameSite: "lax" });
    return res;
  }

  const res = NextResponse.json({
    ok: true,
    sudoActive: true,
    effectiveEmail: email,
    realEmail: realEmail.toLowerCase(),
  });
  res.cookies.set(SUDO_COOKIE, encodeURIComponent(email), {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 8,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

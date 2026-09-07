import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { isSlackConfigured, listSlackUsers, syncSlackUsers } from "@/lib/slackUsers";

export const runtime = "nodejs";

/** Slack 유저 목록 (관리자) */
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const users = await listSlackUsers({ includeBots: true, includeDeleted: true });
    return NextResponse.json({
      users,
      configured: isSlackConfigured(),
      count: users.length,
      withEmail: users.filter((u) => u.email && !u.deleted && !u.isBot).length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, configured: isSlackConfigured(), users: [] }, { status: 500 });
  }
}

/** Slack users.list → BQ 동기화 (관리자) */
export async function POST(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await syncSlackUsers();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

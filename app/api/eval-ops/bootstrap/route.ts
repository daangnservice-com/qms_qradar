import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getEvalOpsAccessLevel } from "@/lib/adminEmails";
import { getEvalOpsBootstrap } from "@/lib/evalOpsStore";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const level = getEvalOpsAccessLevel(session?.user?.email);
  if (level === "none") {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const data = await getEvalOpsBootstrap({
      month: url.searchParams.get("month") ?? undefined,
      userLevel: level,
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    console.error("[api/eval-ops/bootstrap]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

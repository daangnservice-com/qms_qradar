import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { getResultsOptions } from "@/lib/resultsStore";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? undefined;
    const team = url.searchParams.get("team") ?? undefined;
    const options = await getResultsOptions({ month, team });
    return NextResponse.json({ ok: true, options });
  } catch (e) {
    console.error("[api/results/options]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

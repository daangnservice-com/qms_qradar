import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessAnyCallQuality } from "@/lib/sessionAccessServer";
import { getEvalStatus } from "@/lib/resultsStore";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessAnyCallQuality(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const data = await getEvalStatus(url.searchParams.get("month") ?? undefined);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    console.error("[api/results/status]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { getLlmUsageStats } from "@/lib/llmCallLog";
import { getSttUsageStats } from "@/lib/sttCallLog";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? 30);
  const safeDays = Number.isFinite(days) ? days : 30;
  try {
    const [stats, stt] = await Promise.all([getLlmUsageStats(safeDays), getSttUsageStats(safeDays)]);
    return NextResponse.json({ stats, stt });
  } catch (e) {
    console.error("[api/stats/llm]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

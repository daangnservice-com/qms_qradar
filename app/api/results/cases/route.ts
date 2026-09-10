import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessAnyCallQuality } from "@/lib/sessionAccessServer";
import { getResultsCaseById, listResultsCases } from "@/lib/resultsStore";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessAnyCallQuality(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const caseId = url.searchParams.get("caseId")?.trim();
    if (caseId) {
      const row = await getResultsCaseById(caseId);
      if (!row) return NextResponse.json({ error: "케이스를 찾지 못했어요" }, { status: 404 });
      return NextResponse.json({ ok: true, row });
    }
    const month = url.searchParams.get("month")?.trim() || undefined;
    const result = await listResultsCases({
      month,
      team: url.searchParams.get("team") ?? undefined,
      member: url.searchParams.get("member") ?? undefined,
      template: url.searchParams.get("template") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      wrongOnly: url.searchParams.get("wrongOnly") === "1" || url.searchParams.get("wrongOnly") === "true",
      limit: Number(url.searchParams.get("limit") ?? 800) || 800,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[api/results/cases]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

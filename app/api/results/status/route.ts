import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";
import { refreshQmsEvalStatus } from "@/lib/qmsResultsSync";
import { getEvalStatus } from "@/lib/resultsStore";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessQualityEval(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    // 평소에는 서빙 사본(15분 주기)을 읽고, 새로고침을 누를 때만 원천을 다시 가져온다.
    if (url.searchParams.get("fresh") === "1") {
      await refreshQmsEvalStatus().catch((e) => console.warn("[api/results/status] refresh:", e));
    }
    const data = await getEvalStatus(url.searchParams.get("month") ?? undefined);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    console.error("[api/results/status]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { getEvalOpsBootstrap } from "@/lib/evalOpsStore";
import { lockMonth } from "@/lib/evalOpsWrite";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireEvalOps("full");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as { month?: string };
    const month = String(body.month || "");
    const data = await getEvalOpsBootstrap({ month, userLevel: auth.level });
    await lockMonth({
      month: data.month || month,
      editor: auth.email,
      roster: data.roster,
      confirmMap: data.confirmMap,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/eval-ops/months/lock]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

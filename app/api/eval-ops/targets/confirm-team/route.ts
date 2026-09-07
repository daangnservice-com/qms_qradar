import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { confirmTeam } from "@/lib/evalOpsWrite";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireEvalOps("roster");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as { month?: string; team?: string };
    const res = await confirmTeam({
      month: String(body.month || ""),
      team: String(body.team || ""),
      editor: auth.email,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[api/eval-ops/targets/confirm-team]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

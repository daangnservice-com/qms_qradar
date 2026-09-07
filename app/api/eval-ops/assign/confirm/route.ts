import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { confirmAssign } from "@/lib/evalOpsWrite";
import type { DistAssignRun, DistCfg, DistGp, DistTeam } from "@/lib/distTypes";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireEvalOps("full");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as {
      month?: string;
      run?: DistAssignRun;
      teams?: DistTeam[];
      gps?: DistGp[];
      aqtBase?: Record<string, number>;
      cfg?: DistCfg;
    };
    if (!body.run) return NextResponse.json({ error: "배분 결과가 없어요" }, { status: 400 });
    const res = await confirmAssign({
      month: String(body.month || body.run.month || ""),
      editor: auth.email,
      run: body.run,
      teams: body.teams ?? [],
      gps: body.gps ?? [],
      aqtBase: body.aqtBase ?? {},
      cfg: body.cfg ?? { days: 15, avail: 4, month: String(body.month || "") },
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[api/eval-ops/assign/confirm]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

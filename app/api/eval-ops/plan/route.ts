import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { savePlan } from "@/lib/evalOpsWrite";
import type { DistCfg, DistGp, DistTeam } from "@/lib/distTypes";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function PUT(req: Request) {
  const auth = await requireEvalOps("full");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as {
      cfg?: DistCfg;
      teams?: DistTeam[];
      gps?: DistGp[];
      aqtBase?: Record<string, number>;
    };
    if (!body.cfg || !body.teams || !body.gps || !body.aqtBase) {
      return NextResponse.json({ error: "cfg, teams, gps, aqtBase가 필요해요" }, { status: 400 });
    }
    await savePlan({ cfg: body.cfg, teams: body.teams, gps: body.gps, aqtBase: body.aqtBase });
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[api/eval-ops/plan]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { mulberry32, runAssign } from "@/lib/distAssign";
import type { DistAssignMetric, DistAssignScope, DistGp, DistHistoryRow, DistRosterPerson, DistTeam } from "@/lib/distTypes";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireEvalOps("full");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as {
      month?: string;
      teams?: DistTeam[];
      gps?: DistGp[];
      roster?: DistRosterPerson[];
      aqtBase?: Record<string, number>;
      history?: DistHistoryRow[];
      metric?: DistAssignMetric;
      scope?: DistAssignScope;
      seed?: number;
    };
    const out = runAssign({
      month: String(body.month || ""),
      teams: body.teams ?? [],
      gps: body.gps ?? [],
      roster: body.roster ?? [],
      aqtBase: body.aqtBase ?? {},
      history: body.history ?? [],
      metric: body.metric,
      scope: body.scope,
      rng: body.seed != null ? mulberry32(Number(body.seed)) : Math.random,
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json({ ok: true, run: out.run });
  } catch (e) {
    console.error("[api/eval-ops/assign/simulate]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

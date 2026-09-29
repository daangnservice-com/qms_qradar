import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { getReviewAssignRule } from "@/lib/reviewAssignStore";
import { startReviewAssignRun } from "@/lib/reviewAssignRunner";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const ruleId = String(raw.ruleId ?? raw.scheduleId ?? "").trim();
  if (!ruleId) return NextResponse.json({ error: "ruleId required" }, { status: 400 });
  const rule = await getReviewAssignRule(ruleId);
  if (!rule) return NextResponse.json({ error: "규칙을 찾을 수 없습니다" }, { status: 404 });

  try {
    const run = await startReviewAssignRun({
      rule,
      trigger: "manual",
      requestedBy: gate.email,
    });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}

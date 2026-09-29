import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { getEvalBatchSchedule } from "@/lib/evalBatchStore";
import { startEvalBatchRun } from "@/lib/evalBatchRunner";

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
  const scheduleId = String(raw.scheduleId ?? "").trim();
  if (!scheduleId) return NextResponse.json({ error: "scheduleId required" }, { status: 400 });
  const schedule = await getEvalBatchSchedule(scheduleId);
  if (!schedule) return NextResponse.json({ error: "스케줄을 찾을 수 없습니다" }, { status: 404 });

  const callDate = raw.callDate ? String(raw.callDate).trim() : undefined;
  try {
    const run = await startEvalBatchRun({
      schedule,
      trigger: "manual",
      callDate,
      requestedBy: gate.email,
    });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}

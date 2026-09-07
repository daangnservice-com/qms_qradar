import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { syncEvalMonth } from "@/lib/evalOpsWrite";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireEvalOps("full");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as { month?: string };
    const res = await syncEvalMonth(String(body.month || ""));
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[api/eval-ops/months/sync]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

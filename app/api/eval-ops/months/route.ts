import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { getEvalOpsBootstrap } from "@/lib/evalOpsStore";
import { createEvalMonth, deleteEvalMonth } from "@/lib/evalOpsWrite";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireEvalOps("full");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as { month?: string; copyFrom?: string };
    const existing = await getEvalOpsBootstrap({ userLevel: auth.level });
    const res = await createEvalMonth({
      month: String(body.month || ""),
      copyFrom: body.copyFrom,
      existing,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[api/eval-ops/months]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireEvalOps("full");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as { month?: string };
    const month = String(body.month || "");
    const existing = await getEvalOpsBootstrap({ month, userLevel: auth.level });
    const res = await deleteEvalMonth({ month: existing.month || month, existing });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[api/eval-ops/months DELETE]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

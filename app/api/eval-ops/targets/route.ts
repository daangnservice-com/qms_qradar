import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { patchRoster } from "@/lib/evalOpsWrite";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(req: Request) {
  const auth = await requireEvalOps("roster");
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json()) as {
      month?: string;
      employeeId?: string;
      manual?: string | null;
      memo?: string | null;
      evalItems?: string[] | null;
    };
    await patchRoster({
      month: String(body.month || ""),
      employeeId: String(body.employeeId || ""),
      manual: body.manual,
      memo: body.memo,
      evalItems: body.evalItems,
      editor: auth.email,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/eval-ops/targets]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

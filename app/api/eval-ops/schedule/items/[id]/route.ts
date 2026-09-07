import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveEmail } from "@/lib/sudoSession";
import { patchScheduleItem } from "@/lib/evalOpsScheduleStore";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as {
    start?: string | null;
    end?: string | null;
    evalDone?: boolean;
    leaderDone?: boolean;
    selfDone?: boolean;
  };

  const fields: {
    start?: string | null;
    end?: string | null;
    evalDone?: boolean;
    leaderDone?: boolean;
    selfDone?: boolean;
  } = {};
  if ("start" in body) fields.start = body.start ?? null;
  if ("end" in body) fields.end = body.end ?? null;
  if (typeof body.evalDone === "boolean") fields.evalDone = body.evalDone;
  if (typeof body.leaderDone === "boolean") fields.leaderDone = body.leaderDone;
  if (typeof body.selfDone === "boolean") fields.selfDone = body.selfDone;

  if (!Object.keys(fields).length) {
    return NextResponse.json({ error: "no fields" }, { status: 400 });
  }

  const eff = await getEffectiveEmail(session.user.email);
  try {
    const item = await patchScheduleItem({ id, evaluatorEmail: eff.email, fields });
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

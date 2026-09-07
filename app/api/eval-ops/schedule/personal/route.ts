import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveEmail } from "@/lib/sudoSession";
import { upsertPersonalEvent } from "@/lib/evalOpsScheduleStore";

export const runtime = "nodejs";

export async function PUT(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    evalMonth?: string;
    title?: string;
    startDate?: string;
    endDate?: string | null;
    color?: string;
  };

  if (!body.evalMonth || !body.title?.trim() || !body.startDate) {
    return NextResponse.json({ error: "evalMonth, title, startDate required" }, { status: 400 });
  }

  const eff = await getEffectiveEmail(session.user.email);
  try {
    const event = await upsertPersonalEvent({
      event: {
        id: body.id,
        evalMonth: body.evalMonth,
        ownerEmail: eff.email,
        title: body.title,
        startDate: body.startDate,
        endDate: body.endDate ?? body.startDate,
        color: body.color,
      },
    });
    return NextResponse.json({ event });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveEmail } from "@/lib/sudoSession";
import { bootstrapFromAssign } from "@/lib/evalOpsScheduleStore";

export const runtime = "nodejs";

/** 확정 배분 → 스케줄 아이템 재시드 */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? "";
  if (!month) {
    return NextResponse.json({ error: "month required (yyyy-MM)" }, { status: 400 });
  }

  let force = searchParams.get("force") === "1";
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    if (body.force) force = true;
  } catch {
    /* empty */
  }

  const eff = await getEffectiveEmail(session.user.email);
  try {
    const data = await bootstrapFromAssign({ month, evaluatorEmail: eff.email, force });
    if (data.error && !data.seeded) {
      return NextResponse.json(data, { status: 409 });
    }
    return NextResponse.json({
      ...data,
      effectiveEmail: eff.email,
      realEmail: eff.realEmail,
      sudoActive: eff.sudoActive,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveEmail } from "@/lib/sudoSession";
import { getScheduleBoard } from "@/lib/evalOpsScheduleStore";

export const runtime = "nodejs";

/** 월별 스케줄 보드 (items + personal). 비어 있으면 확정 배분에서 1회 시드. */
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? "";
  if (!month) {
    return NextResponse.json({ error: "month required (yyyy-MM)" }, { status: 400 });
  }

  const eff = await getEffectiveEmail(session.user.email);
  try {
    const data = await getScheduleBoard({ month, evaluatorEmail: eff.email, autoSeed: true });
    const totalCs = data.items.filter((i) => i.evalType === "CS").reduce((s, i) => s + i.totalCount, 0);
    const totalJob = data.items.filter((i) => i.evalType === "직무").reduce((s, i) => s + i.totalCount, 0);
    const doneCnt = data.items.filter((i) => i.evalDone).length;
    const completionRate = data.items.length ? Math.round((doneCnt / data.items.length) * 100) : 0;

    return NextResponse.json({
      ...data,
      effectiveEmail: eff.email,
      realEmail: eff.realEmail,
      sudoActive: eff.sudoActive,
      totalCs,
      totalJob,
      completionRate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

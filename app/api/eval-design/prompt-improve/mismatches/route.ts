import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { listMismatchGroups } from "@/lib/promptImprove";
import type { PromptImproveSet } from "@/lib/promptImproveTypes";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const setRaw = (url.searchParams.get("set") ?? "train").trim();
    const set: PromptImproveSet = setRaw === "test" ? "test" : "train";
    const criterionRaw = url.searchParams.get("criterionId");
    const criterionId =
      criterionRaw != null && criterionRaw !== "" ? Number(criterionRaw) : null;

    const groups = await listMismatchGroups(set, {
      criterionId: Number.isFinite(criterionId as number) ? criterionId : null,
    });

    const totalExamples = groups.reduce((n, g) => n + g.examples.length, 0);
    return NextResponse.json({
      set,
      groups,
      totalCriteria: groups.length,
      totalExamples,
    });
  } catch (e) {
    console.error("[api/eval-design/prompt-improve/mismatches]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

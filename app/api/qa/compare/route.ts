import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { resolveCriterionLabelMap } from "@/lib/criterionStore";
import { getLatestQaResult, listQaReferenceSamples } from "@/lib/qaStore";
import { compareCriterionScores } from "@/lib/scoreDetailParse";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  const conversationId = new URL(req.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId 필요" }, { status: 400 });
  }
  try {
    const [qa, refs, labelById] = await Promise.all([
      getLatestQaResult(conversationId),
      listQaReferenceSamples(2000),
      resolveCriterionLabelMap(),
    ]);
    const ref = refs.find((r) => r.conversationId === conversationId) ?? null;
    let checklist: Array<{ id: number; violated: boolean; reason?: string }> = [];
    let result: unknown = null;
    if (qa) {
      try {
        checklist = JSON.parse(qa.checklistJson) as typeof checklist;
      } catch {
        checklist = [];
      }
      try {
        result = JSON.parse(qa.resultJson);
      } catch {
        result = null;
      }
    }

    const humanScoreItems = ref?.humanScoreItems ?? [];
    const criterionCompare = compareCriterionScores({
      humanItems: humanScoreItems,
      aiChecklist: checklist,
      labelById,
    });

    return NextResponse.json({
      conversationId,
      humanResult: ref?.humanResult ?? qa?.humanResult ?? null,
      aiLabel: qa?.aiLabel ?? null,
      match: qa?.match ?? null,
      checklist,
      humanScoreItems,
      scoreDetailRaw: ref?.scoreDetailRaw ?? "",
      memoDetail: ref?.memoDetail ?? "",
      criterionCompare: criterionCompare.rows,
      criterionSummary: criterionCompare.summary,
      result,
      qa,
      reference: ref
        ? {
            conversationId: ref.conversationId,
            phoneInquiryId: ref.phoneInquiryId,
            humanResult: ref.humanResult,
            humanScoreItems: ref.humanScoreItems,
            scoreDetailRaw: ref.scoreDetailRaw,
          }
        : null,
    });
  } catch (e) {
    console.error("[api/qa/compare]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

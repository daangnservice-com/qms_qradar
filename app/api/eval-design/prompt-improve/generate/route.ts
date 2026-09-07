import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { generateImprovedCriterionPrompt } from "@/lib/promptImprove";
import type { PromptImproveExample } from "@/lib/promptImproveTypes";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const criterionId = Number(body.criterionId);
    if (!Number.isFinite(criterionId)) {
      return NextResponse.json({ error: "criterionId 필요" }, { status: 400 });
    }
    const examples = (body.examples as PromptImproveExample[]) ?? [];
    if (!Array.isArray(examples) || !examples.length) {
      return NextResponse.json({ error: "examples 배열 필요" }, { status: 400 });
    }

    const result = await generateImprovedCriterionPrompt({
      criterionId,
      examples,
      promptId: body.promptId != null ? String(body.promptId) : null,
      currentFields:
        body.currentFields && typeof body.currentFields === "object"
          ? (body.currentFields as Record<string, string>)
          : null,
      userNote: body.userNote != null ? String(body.userNote) : null,
      conversationId: body.conversationId != null ? String(body.conversationId) : null,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/eval-design/prompt-improve/generate]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

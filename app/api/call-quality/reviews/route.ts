import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessCallQuality } from "@/lib/sessionAccessServer";
import {
  isBestMarkCategoryId,
  normalizeJudgment,
  normalizeReviewNeeded,
  type BestMarkCategoryId,
  type EvalReviewAnnotation,
  type HumanJudgment,
} from "@/lib/evalReviewTypes";
import type { CriterionReviewScope } from "@/lib/promptTypes";
import {
  deleteEvalReview,
  listEvalReviews,
  saveEvalReview,
} from "@/lib/evalReviewStore";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessCallQuality(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  const conversationId = new URL(req.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId 필요" }, { status: 400 });
  }
  const reviews = await listEvalReviews(conversationId);
  return NextResponse.json({ reviews });
}

type Body = {
  annotationId?: string;
  conversationId?: string;
  source?: "ai" | "human";
  atSec?: number;
  segmentIndex?: number | null;
  criterionId?: number;
  judgment?: HumanJudgment;
  reviewNeeded?: boolean | null;
  scope?: CriterionReviewScope;
  bestCategory?: BestMarkCategoryId | null;
  comment?: string;
  aiCriterionId?: number | null;
  aiViolated?: boolean | null;
  aiQuote?: string | null;
  aiReason?: string | null;
  quote?: string | null;
  delete?: boolean;
};

export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!await ensureSessionCanAccessCallQuality(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId 필요" }, { status: 400 });
  }

  if (body.delete) {
    const annotationId = String(body.annotationId ?? "").trim();
    if (!annotationId) {
      return NextResponse.json({ error: "annotationId 필요" }, { status: 400 });
    }
    await deleteEvalReview({
      annotationId,
      conversationId,
      updatedBy: email ?? "unknown",
    });
    return NextResponse.json({ ok: true });
  }

  const judgment = normalizeJudgment(body.judgment);
  const source = body.source === "ai" ? "ai" : "human";
  const reviewNeeded =
    judgment === "best"
      ? null
      : (normalizeReviewNeeded(body.reviewNeeded) ?? (source === "human" ? true : null));

  let criterionId = 0;
  let bestCategory: BestMarkCategoryId | null = null;
  if (judgment === "best") {
    if (!isBestMarkCategoryId(body.bestCategory)) {
      return NextResponse.json({ error: "bestCategory 필요" }, { status: 400 });
    }
    bestCategory = body.bestCategory;
  } else {
    criterionId = Number(body.criterionId);
    if (!Number.isFinite(criterionId) || criterionId <= 0) {
      return NextResponse.json({ error: "criterionId 필요" }, { status: 400 });
    }
  }

  const saved = await saveEvalReview({
    annotationId: body.annotationId,
    conversationId,
    source,
    atSec: Number(body.atSec) || 0,
    segmentIndex: body.segmentIndex ?? null,
    criterionId,
    judgment,
    reviewNeeded,
    scope: body.scope === "conversation" ? "conversation" : "occurrence",
    bestCategory,
    comment: String(body.comment ?? ""),
    aiCriterionId: body.aiCriterionId ?? null,
    aiViolated: body.aiViolated ?? null,
    aiQuote: body.aiQuote ?? null,
    aiReason: body.aiReason ?? null,
    quote: body.quote ?? null,
    updatedBy: email ?? "unknown",
  });

  return NextResponse.json({ review: saved });
}

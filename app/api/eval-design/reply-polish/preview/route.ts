import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";
import { polishReplyWithGemini } from "@/lib/replyPolishLlm";
import { getReplyPolishSampleSet } from "@/lib/replyPolishStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(await ensureSessionCanAccessQualityEval(session))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const templateBody = String(body.templateBody ?? "");
    if (!templateBody.trim()) return NextResponse.json({ error: "템플릿 본문이 비어 있습니다" }, { status: 400 });
    const sampleSetId = String(body.sampleSetId ?? "").trim();
    const sampleId = String(body.sampleId ?? "").trim();
    const sampleSet = sampleSetId ? await getReplyPolishSampleSet(sampleSetId) : null;
    const sample = sampleSet?.samples.find((s) => s.id === sampleId);
    if (!sample) return NextResponse.json({ error: "미리보기할 샘플을 찾을 수 없습니다" }, { status: 400 });
    const out = await polishReplyWithGemini({
      templateBody,
      inquiry: sample.inquiry,
      answer: sample.answer,
      category: sample.category,
      conversationId: sample.threadId,
      templateKey: "preview",
    });
    return NextResponse.json({
      text: out.text,
      latencyMs: out.latencyMs,
      model: out.model,
      sample,
    });
  } catch (e) {
    console.error("[POST /api/eval-design/reply-polish/preview]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

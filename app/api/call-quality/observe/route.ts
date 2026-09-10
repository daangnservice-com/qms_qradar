import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessCallQualityObserve } from "@/lib/sessionAccessServer";
import { orgFromParam } from "@/lib/callQualityOrg";
import { parseCallQualityDeepLink } from "@/lib/callQualityDeepLink";
import { resolveObserveTarget } from "@/lib/observeResolve";
import { tryStartEvalJob, finishEvalJob, updateEvalJob } from "@/lib/evalSchedule";
import { getObserveTranscript, runObserveStt, type ObserveSttEvent } from "@/lib/observeStt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 5_000;

function parseInquiryFromBody(body: Record<string, unknown>): string {
  return String(
    body.inquiry_id ?? body.inquiryId ?? body.phone_inquiry_id ?? body.phoneInquiryId ?? "",
  ).trim();
}

async function resolveObserveFromInput(input: {
  conversationId?: string;
  inquiryId?: string;
}): Promise<
  | { ok: true; conversationId: string; phoneInquiryId: string | null }
  | { ok: false; status: number; error: string }
> {
  const conversationId = (input.conversationId ?? "").trim();
  const inquiryId = (input.inquiryId ?? "").trim();
  if (!conversationId && !inquiryId) {
    return { ok: false, status: 400, error: "conversationId 또는 inquiry_id가 필요합니다." };
  }
  const target = await resolveObserveTarget({ conversationId: conversationId || null, inquiryId: inquiryId || null });
  if (!target) {
    if (inquiryId && !conversationId) {
      return { ok: false, status: 404, error: "상담이력 ID에 해당하는 통화를 찾을 수 없어요." };
    }
    return { ok: false, status: 400, error: "conversationId 또는 inquiry_id가 필요합니다." };
  }
  return {
    ok: true,
    conversationId: target.conversationId,
    phoneInquiryId: target.phoneInquiryId,
  };
}

/** conversation_id의 STT 전사만 조회(평가 결과·검수 UI 없이 청취용). */
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  if (!await ensureSessionCanAccessCallQualityObserve(session)) return new Response("Forbidden", { status: 403 });

  const deep = parseCallQualityDeepLink(url.searchParams);
  const resolved = await resolveObserveFromInput({
    conversationId: deep.conversationId ?? undefined,
    inquiryId: deep.inquiryId ?? undefined,
  });
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }

  try {
    const payload = await getObserveTranscript(resolved.conversationId);
    if (!payload) {
      return Response.json(
        {
          error: "STT 전사가 없어요.",
          conversationId: resolved.conversationId,
          phoneInquiryId: resolved.phoneInquiryId,
        },
        { status: 404 },
      );
    }
    return Response.json({
      conversationId: payload.conversationId,
      phoneInquiryId: resolved.phoneInquiryId,
      durationSec: payload.durationSec,
      transcript: payload.transcript,
      sttSource: payload.sttSource,
    });
  } catch (err) {
    console.error("[GET /api/call-quality/observe]", err);
    return Response.json({ error: "STT 조회에 실패했습니다." }, { status: 500 });
  }
}

/** STT만 실행(평가 없음). NDJSON progress → result. */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const org = orgFromParam(body.org);
  if (!await ensureSessionCanAccessCallQualityObserve(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const resolved = await resolveObserveFromInput({
    conversationId: String(body.conversationId ?? "").trim() || undefined,
    inquiryId: parseInquiryFromBody(body) || undefined,
  });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const conversationId = resolved.conversationId;

  const force = body.force === true;

  const started = tryStartEvalJob({
    conversationId,
    purpose: "call_eval",
    org,
    requestedBy: session.user.email,
  });
  if (!started.ok) {
    return NextResponse.json(
      {
        error: "동일 conversation에 대한 STT/평가가 이미 진행 중입니다.",
        conversationId,
        existingJobId: started.existing.jobId,
      },
      { status: 409 },
    );
  }
  const jobId = started.job.jobId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const t0 = Date.now();
      let open = true;
      const send = (ev: ObserveSttEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          open = false;
        }
      };
      const beat = setInterval(() => send({ type: "heartbeat", elapsedMs: Date.now() - t0 }), HEARTBEAT_MS);

      let settled = false;
      try {
        if (!force) {
          const existing = await getObserveTranscript(conversationId);
          if (existing) {
            finishEvalJob(jobId, { status: "completed" });
            settled = true;
            send({ type: "result", result: existing });
            return;
          }
        }

        const result = await runObserveStt({
          conversationId,
          force,
          onProgress: (step, elapsedMs) => {
            if (step === "genesys") updateEvalJob(jobId, { step: "genesys" });
            else if (step === "download") updateEvalJob(jobId, { step: "download" });
            else if (step === "transcode") updateEvalJob(jobId, { step: "transcode" });
            else if (step === "transcribe") updateEvalJob(jobId, { step: "analyze" });
            else if (step === "save") updateEvalJob(jobId, { step: "save" });
            send({ type: "progress", step, elapsedMs });
          },
        });
        updateEvalJob(jobId, { sttReused: result.sttReused });
        finishEvalJob(jobId, { status: "completed" });
        settled = true;
        send({ type: "result", result });
      } catch (e) {
        const message = e instanceof Error ? e.message : "STT 처리 중 오류";
        finishEvalJob(jobId, { status: "failed", error: message });
        settled = true;
        send({ type: "error", message });
      } finally {
        clearInterval(beat);
        if (!settled) finishEvalJob(jobId, { status: "failed", error: "interrupted" });
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

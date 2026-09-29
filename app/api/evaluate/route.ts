import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { CALL_EVAL_ORG } from "@/lib/callQualityOrg";
import { trackServerAction } from "@/lib/serverTrack";
import { finishEvalJob, tryStartEvalJob, updateEvalJob } from "@/lib/evalSchedule";
import { runCallEvaluation } from "@/lib/runCallEvaluation";
import type { EvaluateEvent } from "@/lib/types";

export const runtime = "nodejs";

const HEARTBEAT_MS = 5_000;

export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { conversationId?: string; phoneInquiryId?: string; minSilenceSec?: number; org?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const org = CALL_EVAL_ORG;
  if (!(await ensureSessionCanAccessEvalProgress(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversationId = (body.conversationId ?? "").trim();
  if (!conversationId) return NextResponse.json({ error: "conversationId가 필요합니다." }, { status: 400 });
  const phoneInquiryId = (body.phoneInquiryId ?? "").trim() || null;
  const analyzedBy = session.user.email;

  const started = tryStartEvalJob({
    conversationId,
    purpose: "call_eval",
    org,
    requestedBy: analyzedBy,
  });
  if (!started.ok) {
    return NextResponse.json(
      {
        error: "동일 conversation에 대한 평가가 이미 진행 중입니다.",
        conversationId,
        existingJobId: started.existing.jobId,
        existingRequestedBy: started.existing.requestedBy,
        existingStartedAt: started.existing.createdAt,
      },
      { status: 409 },
    );
  }
  const jobId = started.job.jobId;
  const raw = Number(body.minSilenceSec ?? 3);
  const minSilenceSec = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 3));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const t0 = Date.now();
      let open = true;
      const send = (ev: EvaluateEvent) => {
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
        updateEvalJob(jobId, { step: "genesys" });
        send({ type: "progress", step: "genesys", elapsedMs: 0 });
        const { analysisId, result, sttReused } = await runCallEvaluation({
          conversationId,
          phoneInquiryId,
          analyzedBy,
          org,
          minSilenceSec,
          onProgress: (p) => {
            updateEvalJob(jobId, {
              step: p.step,
              ...(p.sttReused != null ? { sttReused: p.sttReused } : {}),
            });
            send({ type: "progress", step: p.step, elapsedMs: Date.now() - t0 });
          },
        });
        updateEvalJob(jobId, { sttReused });
        await trackServerAction("/call-quality", "call_evaluate");
        finishEvalJob(jobId, { status: "completed" });
        settled = true;
        send({ type: "result", result: { ...result, conversationId, analysisId: analysisId ?? undefined } });
      } catch (e) {
        const message = e instanceof Error ? e.message : "처리 중 오류";
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
          // already closed
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

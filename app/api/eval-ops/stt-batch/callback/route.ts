import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { harvestSttBatchJobByRemoteId } from "@/lib/sttBatchRunner";
import { findSttBatchJobByConversation, findSttBatchJobByRemoteId } from "@/lib/sttBatchStore";
import { localSttCallbackSecret } from "@/lib/localSttClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(got: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 로컬 STT 서버 콜백. 본문에 전사는 없고 job_id·status만 온다. 멱등. */
export async function POST(req: Request) {
  const expected = localSttCallbackSecret();
  const url = new URL(req.url);
  const got = url.searchParams.get("secret") ?? req.headers.get("x-callback-secret") ?? "";
  if (!secretMatches(got, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const jobId = String(raw.job_id ?? raw.id ?? "").trim();
  const clientRef = String(raw.client_ref ?? "").trim();
  const job =
    (jobId ? await findSttBatchJobByRemoteId(jobId) : null) ??
    (clientRef ? await findSttBatchJobByConversation(clientRef) : null);
  if (!job) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await harvestSttBatchJobByRemoteId(job.remoteJobId ?? jobId);
  } catch (e) {
    console.warn("[stt-batch] callback harvest:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";
import { processReplyPolishWork } from "@/lib/replyPolishRunner";
import {
  createReplyPolishRun,
  getReplyPolishRun,
  listReplyPolishResults,
  listReplyPolishRuns,
} from "@/lib/replyPolishStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireAccess() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !(await ensureSessionCanAccessQualityEval(session))) {
    return { error: NextResponse.json({ error: "권한이 없습니다" }, { status: 403 }) };
  }
  return { email };
}

export async function GET(req: Request) {
  const access = await requireAccess();
  if (access.error) return access.error;
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim();
    const sampleSetId = url.searchParams.get("sampleSetId")?.trim();
    const process = url.searchParams.get("process") !== "0";
    const progress = process ? await processReplyPolishWork() : { processed: 0, remaining: 0 };

    if (id) {
      const run = await getReplyPolishRun(id);
      if (!run) return NextResponse.json({ error: "run을 찾을 수 없습니다" }, { status: 404 });
      const results = await listReplyPolishResults({ sampleSetId: run.sampleSetId, runId: run.id });
      return NextResponse.json({ run, results, progress });
    }
    const runs = await listReplyPolishRuns(sampleSetId);
    const results = sampleSetId ? await listReplyPolishResults({ sampleSetId }) : [];
    return NextResponse.json({ runs, results, progress });
  } catch (e) {
    console.error("[GET /api/eval-design/reply-polish/runs]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const access = await requireAccess();
  if (access.error) return access.error;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sampleSetId = String(body.sampleSetId ?? "").trim();
    const templateIds = Array.isArray(body.templateIds)
      ? body.templateIds.map((id) => String(id))
      : [];
    if (!sampleSetId) return NextResponse.json({ error: "sampleSetId 필요" }, { status: 400 });
    const created = await createReplyPolishRun({
      sampleSetId,
      templateIds,
      createdBy: access.email,
    });
    const progress = await processReplyPolishWork();
    const run = (await getReplyPolishRun(created.run.id)) ?? created.run;
    const results = await listReplyPolishResults({ sampleSetId, runId: run.id });
    return NextResponse.json({ run, results, progress });
  } catch (e) {
    console.error("[POST /api/eval-design/reply-polish/runs]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

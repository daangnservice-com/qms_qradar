import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";
import { sampleReplyPolishThreads } from "@/lib/replyPolishSelect";
import { getReplyPolishSampleSet, listReplyPolishSampleSets, saveReplyPolishSampleSet } from "@/lib/replyPolishStore";
import { REPLY_POLISH_DEFAULT_TEAM, REPLY_POLISH_DEFAULT_TARGET } from "@/lib/replyPolishTypes";

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
    const id = new URL(req.url).searchParams.get("id")?.trim();
    if (id) {
      const sampleSet = await getReplyPolishSampleSet(id);
      if (!sampleSet) return NextResponse.json({ error: "샘플셋을 찾을 수 없습니다" }, { status: 404 });
      return NextResponse.json({ sampleSet });
    }
    const sampleSets = await listReplyPolishSampleSets();
    return NextResponse.json({ sampleSets });
  } catch (e) {
    console.error("[GET /api/eval-design/reply-polish/samples]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const access = await requireAccess();
  if (access.error) return access.error;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const dateStart = String(body.dateStart ?? "").trim();
    const dateEnd = String(body.dateEnd ?? "").trim();
    const team = String(body.team ?? REPLY_POLISH_DEFAULT_TEAM).trim() || REPLY_POLISH_DEFAULT_TEAM;
    const target = Number(body.target ?? REPLY_POLISH_DEFAULT_TARGET);
    const seed = String(body.seed ?? "").trim() || randomUUID();
    const sampled = await sampleReplyPolishThreads({
      dateStart,
      dateEnd,
      team,
      target,
      seed,
      csatRates: body.csatRates,
      csatIncludeNone: body.csatIncludeNone,
    });
    const sampleSet = await saveReplyPolishSampleSet({
      team,
      dateStart,
      dateEnd,
      target: sampled.target,
      seed,
      candidateCount: sampled.candidateCount,
      csatRates: sampled.csatRates,
      csatIncludeNone: sampled.csatIncludeNone,
      samples: sampled.samples,
      createdBy: access.email,
    });
    return NextResponse.json({ sampleSet });
  } catch (e) {
    console.error("[POST /api/eval-design/reply-polish/samples]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { getLocalSttHealth, localSttConfigured } from "@/lib/localSttClient";
import { enqueueOndemandLocalStt, refreshLocalSttJob } from "@/lib/sttBatchRunner";
import { listInFlightSttJobs } from "@/lib/sttBatchStore";
import { isInFlightSttStatus, toLocalSttQueueView } from "@/lib/sttBatchTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await ensureSessionCanAccessEvalProgress(session))) {
    return { ok: false as const, response: NextResponse.json({ error: "권한이 없습니다" }, { status: 403 }) };
  }
  return { ok: true as const, email: session.user.email };
}

function healthPayload() {
  return getLocalSttHealth().then((health) => ({
    configured: localSttConfigured(),
    ok: health.ok,
    acceptingWork: health.acceptingWork,
    reason: health.reason,
    windowOpen: health.windowOpen,
    nextWindowAt: health.nextWindowAt,
    busy: health.busy,
    queueDepth: health.queueDepth,
    currentJobId: health.currentJobId,
    error: health.error,
  }));
}

/** 선택 콜 상태 + 진행 중인 로컬 STT 목록. */
export async function GET(req: Request): Promise<Response> {
  const g = await gate();
  if (!g.ok) return g.response;

  const conversationId = new URL(req.url).searchParams.get("conversationId")?.trim() || "";
  const [selected, inFlight] = await Promise.all([
    conversationId ? refreshLocalSttJob(conversationId) : Promise.resolve(null),
    listInFlightSttJobs(),
  ]);
  const needHealth = Boolean(selected && isInFlightSttStatus(selected.status));
  const health = needHealth
    ? await healthPayload()
    : { configured: localSttConfigured(), ok: true, acceptingWork: null, reason: null, windowOpen: null, nextWindowAt: null, busy: null, queueDepth: null, currentJobId: null, error: null };

  return NextResponse.json({
    configured: health.configured,
    health,
    job: selected ? toLocalSttQueueView(selected) : null,
    jobs: inFlight.map(toLocalSttQueueView),
  });
}

/** 로컬 STT 최우선 큐에 넣는다. 전사를 기다리지 않는다. */
export async function POST(req: Request): Promise<Response> {
  const g = await gate();
  if (!g.ok) return g.response;

  let body: {
    conversationId?: string;
    force?: boolean;
    agentName?: string;
    team?: string;
    callDate?: string;
    durationSec?: number | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const conversationId = (body.conversationId ?? "").trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId가 필요합니다." }, { status: 400 });
  }

  try {
    const { job, alreadyActive } = await enqueueOndemandLocalStt({
      conversationId,
      force: body.force === true,
      agentName: body.agentName,
      team: body.team,
      callDate: body.callDate,
      durationSec: body.durationSec,
      requestedBy: g.email,
    });
    return NextResponse.json({
      ok: true,
      alreadyActive,
      job: toLocalSttQueueView(job),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "로컬 STT 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

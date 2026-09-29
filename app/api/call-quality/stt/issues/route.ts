import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { CALL_EVAL_ORG } from "@/lib/callQualityOrg";
import { getObserveTranscript } from "@/lib/observeStt";
import { getBatchTranscriptSnapshot } from "@/lib/sttBatchStore";
import { appendSttIssueReport, listSttIssueReports } from "@/lib/sttIssueStore";
import { isSttIssueTypeId } from "@/lib/sttIssueTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  const issueTypeRaw = new URL(req.url).searchParams.get("issueType")?.trim() || "";
  const issueType = isSttIssueTypeId(issueTypeRaw) ? issueTypeRaw : null;
  const reports = await listSttIssueReports({ issueType, limit: 200 });
  return NextResponse.json({ reports });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ensureSessionCanAccessEvalProgress(session))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  let body: {
    conversationId?: string;
    issueType?: string;
    comment?: string;
    agentName?: string;
    callDate?: string;
    org?: string;
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
  if (!isSttIssueTypeId(body.issueType)) {
    return NextResponse.json({ error: "이슈 타입을 선택해 주세요." }, { status: 400 });
  }

  const [stored, snapshot] = await Promise.all([
    getObserveTranscript(conversationId),
    getBatchTranscriptSnapshot(conversationId),
  ]);
  const { report, duplicate } = await appendSttIssueReport({
    conversationId,
    issueType: body.issueType,
    sttSource: stored?.sttSource ?? null,
    comment: body.comment,
    transcript: stored?.transcript ?? [],
    reportedBy: email,
    agentName: body.agentName,
    callDate: body.callDate,
    org: CALL_EVAL_ORG,
    remoteJobId: snapshot?.remoteJobId ?? null,
    sttOptions: snapshot?.options ?? null,
    segments: snapshot?.details ?? [],
  });
  return NextResponse.json({ ok: true, duplicate, report });
}

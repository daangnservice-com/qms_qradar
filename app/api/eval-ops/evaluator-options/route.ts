import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { listSlackUsersForEvaluators, isSlackConfigured } from "@/lib/slackUsers";

export const runtime = "nodejs";

/** 평가자 이메일 선택용 Slack 유저 (full) */
export async function GET(): Promise<Response> {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  try {
    const users = await listSlackUsersForEvaluators();
    return NextResponse.json({ users, configured: isSlackConfigured() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ users: [], configured: isSlackConfigured(), error: msg });
  }
}

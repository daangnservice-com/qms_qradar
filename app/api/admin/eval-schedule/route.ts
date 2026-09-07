import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/adminEmails";
import { listEvalSchedule } from "@/lib/evalSchedule";

export const runtime = "nodejs";

/** 관리자: 현재 LLM 평가 호출 스케줄(진행 중 + 최근 완료/거부) */
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { active, recent } = listEvalSchedule();
  return NextResponse.json({
    active,
    recent,
    generatedAt: new Date().toISOString(),
  });
}

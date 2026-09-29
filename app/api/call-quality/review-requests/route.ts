import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import { listReviewRequestConversationIds, reviewAssignQuotaForEmail } from "@/lib/reviewAssignStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ensureSessionCanAccessEvalProgress(session))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  const [quota, assignedIds] = await Promise.all([
    reviewAssignQuotaForEmail(session.user.email),
    listReviewRequestConversationIds(),
  ]);
  return NextResponse.json({
    ok: true,
    remaining: quota.remaining,
    quota: quota.quota,
    completed: quota.completed,
    incompleteCount: quota.incompleteCount,
    assignedCount: assignedIds.length,
  });
}

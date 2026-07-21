import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { insertDamageFeedback, insertUsageEvent } from "@/lib/bigquery";
import { feedbackObjectName, uploadFeedbackImage } from "@/lib/storage";
import { extOf, imageMimeOf } from "@/lib/imageMime";
import type { DamageParty, DamageResult, FeedbackRating } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  try {
    const fd = await req.formData();
    const rating = String(fd.get("rating") ?? "");
    if (rating !== "good" && rating !== "bad") {
      return NextResponse.json({ error: "rating은 good 또는 bad여야 해요." }, { status: 400 });
    }
    const comment = String(fd.get("comment") ?? "").slice(0, 2000);

    let result: DamageResult;
    try {
      result = JSON.parse(String(fd.get("result") ?? "")) as DamageResult;
    } catch {
      return NextResponse.json({ error: "판정 결과가 없거나 형식이 올바르지 않아요." }, { status: 400 });
    }

    const feedbackId = randomUUID();

    // 클라이언트가 재첨부한 원본 사진을 GCS에 저장(피드백 케이스만). 통합 순서 유지.
    const ordered: { file: File; party: DamageParty }[] = [
      ...fd.getAll("claimantImages").filter((f): f is File => f instanceof File).map((file) => ({ file, party: "claimant" as const })),
      ...fd.getAll("respondentImages").filter((f): f is File => f instanceof File).map((file) => ({ file, party: "respondent" as const })),
    ];
    const partyIndex: Record<DamageParty, number> = { claimant: 0, respondent: 0 };
    const uploads = ordered
      .map(({ file, party }) => {
        const ext = extOf(file.name);
        const contentType = imageMimeOf(file.name);
        if (!contentType) return null; // 지원하지 않는 형식은 건너뜀(피드백 자체는 계속 저장)
        return { file, name: feedbackObjectName(feedbackId, party, partyIndex[party]++, ext), contentType };
      })
      .filter((u): u is { file: File; name: string; contentType: string } => u !== null);
    // GCS 업로드는 병렬. name은 위에서 통합 순서대로 확정했으므로 imagePaths 순서도 유지된다.
    await Promise.all(
      uploads.map(async (u) => uploadFeedbackImage(u.name, new Uint8Array(await u.file.arrayBuffer()), u.contentType)),
    );
    const imagePaths = uploads.map((u) => u.name);

    await insertDamageFeedback({
      feedbackId,
      email,
      rating: rating as FeedbackRating,
      comment,
      verdict: String(result.verdict ?? ""),
      confidence: Number(result.confidence ?? 0),
      comparison: String(result.comparison ?? ""),
      summary: String(result.summary ?? ""),
      promptVersion: String(result.promptVersion ?? ""),
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      resultJson: JSON.stringify(result),
      claimantCount: Number(result.claimantCount ?? 0),
      respondentCount: Number(result.respondentCount ?? 0),
      imagePaths,
    });

    // 기능 사용 트래킹(이미 세션 email 확보). 실패해도 피드백 저장은 성공 처리.
    try {
      await insertUsageEvent({ email, path: "/damage", type: "feedback_submit" });
    } catch {
      /* 트래킹 실패 무시 */
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "피드백 저장 중 오류" }, { status: 500 });
  }
}

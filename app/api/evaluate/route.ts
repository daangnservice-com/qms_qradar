import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isKarla } from "@/lib/adminEmails";
import { saveTempFile, cleanupTempFile, transcodeToWav } from "@/lib/audio";
import { getConversationAudioUrl, downloadAudio } from "@/lib/genesys";
import { evaluateFile } from "@/lib/evaluate";
import { trackServerAction } from "@/lib/serverTrack";
import { numEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300; // EC2 상주 배포 기준. Genesys 폴링 + 트랜스코딩 + Gemini 여유.

// conversation_id로 Genesys 녹취를 받아와 콜 품질을 평가한다. (karla 단독 접근)
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isKarla(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tempPaths: string[] = [];
  try {
    const body = (await req.json()) as { conversationId?: string; minSilenceSec?: number };
    const conversationId = (body.conversationId ?? "").trim();
    if (!conversationId) return NextResponse.json({ error: "conversationId가 필요합니다." }, { status: 400 });

    const raw = Number(body.minSilenceSec ?? 3);
    const minSilenceSec = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 3));
    const noiseDb = numEnv("SILENCE_NOISE_DB", -30);

    // Genesys에서 녹취 다운로드 URL → 오디오 bytes → 임시파일 → wav 정규화
    const url = await getConversationAudioUrl(conversationId);
    const { bytes } = await downloadAudio(url);
    const srcPath = await saveTempFile(bytes, ".audio");
    tempPaths.push(srcPath);
    const wavPath = await transcodeToWav(srcPath);
    tempPaths.push(wavPath);

    const result = await evaluateFile(wavPath, { minSilenceSec, noiseDb });
    await trackServerAction("/call-quality", "call_evaluate");
    return NextResponse.json({ ...result, conversationId }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "처리 중 오류" }, { status: 500 });
  } finally {
    for (const p of tempPaths) await cleanupTempFile(p);
  }
}

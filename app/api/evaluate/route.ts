import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orgFromParam, canAccessOrg } from "@/lib/callQualityOrg";
import { saveTempFile, cleanupTempFile, transcodeToWav } from "@/lib/audio";
import { getConversationAudioUrl, downloadAudio } from "@/lib/genesys";
import { evaluateFile } from "@/lib/evaluate";
import { saveAnalysisResult } from "@/lib/analysisStore";
import { trackServerAction } from "@/lib/serverTrack";
import { numEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 600; // EC2 상주 배포 기준. Genesys + 트랜스코딩 + STT(비동기) + Gemini 여유.

// conversation_id로 Genesys 녹취를 받아와 콜 품질을 분석한다. 조직(탭)별 허용 계정만.
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tempPaths: string[] = [];
  try {
    const body = (await req.json()) as {
      conversationId?: string;
      phoneInquiryId?: string;
      minSilenceSec?: number;
      org?: string;
    };
    const org = orgFromParam(body.org);
    if (!canAccessOrg(org, session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const conversationId = (body.conversationId ?? "").trim();
    if (!conversationId) return NextResponse.json({ error: "conversationId가 필요합니다." }, { status: 400 });
    const phoneInquiryId = (body.phoneInquiryId ?? "").trim() || null;

    const raw = Number(body.minSilenceSec ?? 3);
    const minSilenceSec = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 3));
    const noiseDb = numEnv("SILENCE_NOISE_DB", -30);

    // Genesys에서 녹취 다운로드 URL → 오디오 bytes → 임시파일 → wav 정규화
    const t0 = Date.now();
    const url = await getConversationAudioUrl(conversationId);
    const t1 = Date.now();
    const { bytes } = await downloadAudio(url);
    const t2 = Date.now();
    const srcPath = await saveTempFile(bytes, ".audio");
    tempPaths.push(srcPath);
    const wavPath = await transcodeToWav(srcPath);
    tempPaths.push(wavPath);
    const t3 = Date.now();

    const result = await evaluateFile(wavPath, { minSilenceSec, noiseDb, org }, srcPath);
    const t4 = Date.now();
    console.log(
      `[evaluate] genesys=${t1 - t0}ms download=${t2 - t1}ms transcode=${t3 - t2}ms evaluate=${t4 - t3}ms total=${t4 - t0}ms`,
    );
    // 결과 영구 저장(이력 누적). 저장 실패해도 분석 결과는 돌려준다.
    let analysisId: string | null = null;
    try {
      analysisId = await saveAnalysisResult({
        org,
        conversationId,
        phoneInquiryId,
        analyzedBy: session.user.email,
        result,
      });
    } catch (saveErr) {
      console.error("[evaluate] 결과 저장 실패", saveErr);
    }

    await trackServerAction("/call-quality", "call_evaluate");
    return NextResponse.json({ ...result, conversationId, analysisId }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "처리 중 오류" }, { status: 500 });
  } finally {
    for (const p of tempPaths) await cleanupTempFile(p);
  }
}

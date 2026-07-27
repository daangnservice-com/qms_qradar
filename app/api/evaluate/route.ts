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
import type { EvaluateEvent } from "@/lib/types";

export const runtime = "nodejs";

// 응답은 NDJSON 스트림(진행 이벤트 → 마지막에 result 또는 error).
// EC2 상주 배포(node server.js)라 서버 자체엔 실행시간 제한이 없지만, 앞단 ALB는
// "아무 바이트도 안 오간 시간" 기준 idle timeout(기본 60초)으로 연결을 끊는다.
// 2분 통화도 total ~52초라 10분 이상 통화는 그대로 504가 났음 → 처리 중 주기적으로
// 이벤트를 흘려 타이머를 리셋한다. 통화 길이와 무관하게 안 끊긴다.
// (Vercel 전용인 `maxDuration`은 여기선 아무 효과가 없어 두지 않는다.)
const HEARTBEAT_MS = 5_000;

// conversation_id로 Genesys 녹취를 받아와 콜 품질을 분석한다. 조직(탭)별 허용 계정만.
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 검증은 스트림을 열기 전에 끝낸다. 스트림은 200이 먼저 나가 상태코드로 실패를 못 알린다.
  let body: { conversationId?: string; phoneInquiryId?: string; minSilenceSec?: number; org?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const org = orgFromParam(body.org);
  if (!canAccessOrg(org, session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const conversationId = (body.conversationId ?? "").trim();
  if (!conversationId) return NextResponse.json({ error: "conversationId가 필요합니다." }, { status: 400 });
  const phoneInquiryId = (body.phoneInquiryId ?? "").trim() || null;
  const analyzedBy = session.user.email;

  const raw = Number(body.minSilenceSec ?? 3);
  const minSilenceSec = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 3));
  const noiseDb = numEnv("SILENCE_NOISE_DB", -30);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const t0 = Date.now();
      let open = true;
      const send = (ev: EvaluateEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          open = false; // 클라이언트가 끊음. 처리는 그대로 끝내(결과는 저장됨) 전송만 멈춘다.
        }
      };
      // ALB idle timeout 리셋용. 가장 긴 구간(전사·채점 ~40초+)에도 계속 바이트가 오간다.
      const beat = setInterval(() => send({ type: "heartbeat", elapsedMs: Date.now() - t0 }), HEARTBEAT_MS);

      const tempPaths: string[] = [];
      try {
        // Genesys에서 녹취 다운로드 URL → 오디오 bytes → 임시파일 → wav 정규화
        send({ type: "progress", step: "genesys", elapsedMs: 0 });
        const url = await getConversationAudioUrl(conversationId);
        const t1 = Date.now();

        send({ type: "progress", step: "download", elapsedMs: t1 - t0 });
        const { bytes } = await downloadAudio(url);
        const t2 = Date.now();

        send({ type: "progress", step: "transcode", elapsedMs: t2 - t0 });
        const srcPath = await saveTempFile(bytes, ".audio");
        tempPaths.push(srcPath);
        const wavPath = await transcodeToWav(srcPath);
        tempPaths.push(wavPath);
        const t3 = Date.now();

        send({ type: "progress", step: "analyze", elapsedMs: t3 - t0 });
        const result = await evaluateFile(wavPath, { minSilenceSec, noiseDb, org }, srcPath);
        const t4 = Date.now();
        console.log(
          `[evaluate] genesys=${t1 - t0}ms download=${t2 - t1}ms transcode=${t3 - t2}ms evaluate=${t4 - t3}ms total=${t4 - t0}ms`,
        );

        // 결과 영구 저장(이력 누적). 저장 실패해도 분석 결과는 돌려준다.
        send({ type: "progress", step: "save", elapsedMs: t4 - t0 });
        let analysisId: string | null = null;
        try {
          analysisId = await saveAnalysisResult({ org, conversationId, phoneInquiryId, analyzedBy, result });
        } catch (saveErr) {
          console.error("[evaluate] 결과 저장 실패", saveErr);
        }

        await trackServerAction("/call-quality", "call_evaluate");
        send({ type: "result", result: { ...result, conversationId, analysisId: analysisId ?? undefined } });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "처리 중 오류" });
      } finally {
        clearInterval(beat);
        for (const p of tempPaths) await cleanupTempFile(p);
        open = false;
        try {
          controller.close();
        } catch {
          // 이미 닫힌 스트림
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // no-transform: Next의 gzip 압축이 청크를 모아두면 하트비트가 묻혀 idle timeout을 못 피한다.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // nginx류가 앞단에 붙어도 버퍼링하지 않도록
    },
  });
}

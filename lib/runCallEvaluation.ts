import { saveTempFile, cleanupTempFile, transcodeToWav } from "./audio";
import { getConversationAudioUrl, downloadAudio } from "./genesys";
import { evaluateFile } from "./evaluate";
import { saveAnalysisResult } from "./analysisStore";
import { numEnv } from "./env";
import type { CallQualityOrg } from "./callQualityOrg";
import type { EvaluationResult } from "./types";

export type RunCallEvaluationStep = "genesys" | "download" | "transcode" | "analyze" | "save";

export type RunCallEvaluationProgress = {
  step: RunCallEvaluationStep;
  sttReused?: boolean;
};

/** Genesys 녹취 → (STT 재사용) → Gemini. 평가 API·AI 평가 배치가 같이 쓴다. */
export async function runCallEvaluation(input: {
  conversationId: string;
  phoneInquiryId?: string | null;
  analyzedBy: string;
  org?: CallQualityOrg;
  minSilenceSec?: number;
  onProgress?: (p: RunCallEvaluationProgress) => void;
}): Promise<{
  analysisId: string | null;
  result: EvaluationResult;
  sttReused: boolean;
}> {
  const org = input.org ?? "growth";
  const conversationId = input.conversationId.trim();
  if (!conversationId) throw new Error("conversationId가 필요합니다.");
  const raw = Number(input.minSilenceSec ?? 3);
  const minSilenceSec = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 3));
  const noiseDb = numEnv("SILENCE_NOISE_DB", -30);
  const tempPaths: string[] = [];
  const onProgress = input.onProgress ?? (() => {});

  try {
    onProgress({ step: "genesys" });
    const url = await getConversationAudioUrl(conversationId);

    onProgress({ step: "download" });
    const { bytes } = await downloadAudio(url);

    onProgress({ step: "transcode" });
    const srcPath = await saveTempFile(bytes, ".audio");
    tempPaths.push(srcPath);
    const wavPath = await transcodeToWav(srcPath);
    tempPaths.push(wavPath);

    onProgress({ step: "analyze" });
    const result = await evaluateFile(
      wavPath,
      { minSilenceSec, noiseDb, org, conversationId, llmPurpose: "call_eval" },
      srcPath,
    );

    onProgress({ step: "save", sttReused: Boolean(result.sttReused) });
    let analysisId: string | null = null;
    try {
      analysisId = await saveAnalysisResult({
        org,
        conversationId,
        phoneInquiryId: input.phoneInquiryId ?? null,
        analyzedBy: input.analyzedBy,
        result,
        promptVersionId: result.promptConfig?.version.versionId ?? null,
        promptVersion: result.promptConfig?.version.versionLabel ?? null,
        llmCallId: result.llmCallId ?? null,
      });
    } catch (saveErr) {
      console.error("[evaluate] 결과 저장 실패", saveErr);
    }

    return { analysisId, result, sttReused: Boolean(result.sttReused) };
  } finally {
    for (const p of tempPaths) await cleanupTempFile(p);
  }
}

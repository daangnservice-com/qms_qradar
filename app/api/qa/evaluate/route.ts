import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { evaluateFile } from "@/lib/evaluate";
import { ensureLocalQaAudio, removeLocalQaAudio, cleanupPaths } from "@/lib/qaAudio";
import { saveQaEvalResult, listQaReferenceSamples } from "@/lib/qaStore";
import { getProductionPrompt, getPromptConfigByVersionId, seedChecklistDraftEvalSet } from "@/lib/promptStore";
import { seedDraftCriterionPromptsFromChecklist } from "@/lib/criterionStore";
import { numEnv } from "@/lib/env";
import { DEFAULT_RESULT_PARSE_CONFIG } from "@/lib/promptTypes";
import { finishEvalJob, tryStartEvalJob, updateEvalJob } from "@/lib/evalSchedule";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  conversationId?: string;
  conversationIds?: string[];
  keepAudio?: boolean;
  minSilenceSec?: number;
  templateKey?: string;
  /** 특정 평가표 버전으로 평가. 없으면 production */
  versionId?: string;
};

export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!canAccessAnyCallQuality(email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const ids = [
    ...(body.conversationId ? [body.conversationId.trim()] : []),
    ...((body.conversationIds ?? []).map((x) => String(x).trim()).filter(Boolean)),
  ];
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) {
    return NextResponse.json({ error: "conversationId 필요" }, { status: 400 });
  }

  const keepAudio = Boolean(body.keepAudio);
  const minSilenceSec = Math.min(10, Math.max(1, Number(body.minSilenceSec ?? 3) || 3));
  const noiseDb = numEnv("SILENCE_NOISE_DB", -30);
  const templateKey = (body.templateKey as "call_eval_growth" | "call_eval_pay") || "call_eval_growth";
  const requestedVersionId = (body.versionId ?? "").trim() || null;

  const refs = await listQaReferenceSamples(2000);
  const refById = new Map(refs.map((r) => [r.conversationId, r]));

  let promptConfig;
  if (requestedVersionId) {
    promptConfig = await getPromptConfigByVersionId(requestedVersionId);
    if (!promptConfig) {
      return NextResponse.json({ error: "선택한 평가표를 찾을 수 없습니다" }, { status: 400 });
    }
  } else {
    // CS_CHECKLIST hint 초안 시드 + 평가셋이 비어 있으면 초안 production 생성
    await seedDraftCriterionPromptsFromChecklist().catch((e) =>
      console.warn("[qa/evaluate] criterion seed:", e instanceof Error ? e.message : e),
    );
    promptConfig = await getProductionPrompt(templateKey);
    if (
      promptConfig.version.useChecklist &&
      (!promptConfig.criteria.length ||
        promptConfig.criteria.every((c) => !(c.fields?.definition?.trim() || c.hint?.trim())))
    ) {
      await seedChecklistDraftEvalSet({
        templateKey,
        createdBy: email ?? "qa-auto-seed",
        promote: true,
      });
      promptConfig = await getProductionPrompt(templateKey);
    }
  }
  const parseConfig = promptConfig.version.resultParseConfig ?? DEFAULT_RESULT_PARSE_CONFIG;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client gone */
        }
      };

      for (const conversationId of uniqueIds) {
        const started = tryStartEvalJob({
          conversationId,
          purpose: "qa_eval",
          org: "growth",
          requestedBy: email ?? null,
        });
        if (!started.ok) {
          send({
            type: "skipped",
            conversationId,
            reason: "duplicate",
            message: "동일 conversation에 대한 평가가 이미 진행 중입니다.",
            existingJobId: started.existing.jobId,
          });
          continue;
        }
        const jobId = started.job.jobId;

        const ref = refById.get(conversationId);
        const humanResult = ref?.humanResult ?? "";
        let tempPaths: string[] = [];
        let settled = false;
        try {
          updateEvalJob(jobId, { step: "audio" });
          send({ type: "progress", conversationId, step: "audio" });
          const audio = await ensureLocalQaAudio(conversationId);
          tempPaths = audio.tempPaths;

          updateEvalJob(jobId, { step: "analyze" });
          send({ type: "progress", conversationId, step: "analyze" });
          const result = await evaluateFile(
            audio.wavPath,
            {
              minSilenceSec,
              noiseDb,
              org: "growth",
              forceChecklist: true,
              templateKey: promptConfig.version.templateKey || templateKey,
              conversationId,
              llmPurpose: "qa_eval",
              promptConfig,
            },
            audio.sourcePath,
          );
          updateEvalJob(jobId, { sttReused: Boolean(result.sttReused) });

          updateEvalJob(jobId, { step: "save" });
          send({ type: "progress", conversationId, step: "save" });
          const saved = await saveQaEvalResult({
            conversationId,
            phoneInquiryId: ref?.phoneInquiryId,
            humanResult,
            result,
            parseConfig,
            promptVersionId: promptConfig.version.versionId,
            promptVersion: promptConfig.version.versionLabel,
            model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
            llmCallId: result.llmCallId,
            audioKept: keepAudio,
            audioPath: keepAudio ? audio.wavPath : null,
            analyzedBy: email,
          });

          if (!keepAudio) await removeLocalQaAudio(conversationId);
          await cleanupPaths(tempPaths);

          finishEvalJob(jobId, { status: "completed" });
          settled = true;
          send({
            type: "result",
            conversationId,
            humanResult: saved.humanResult,
            aiLabel: saved.aiLabel,
            match: saved.match,
            qaRunId: saved.qaRunId,
            error: saved.error,
            sttReused: Boolean(result.sttReused),
          });
        } catch (e) {
          await cleanupPaths(tempPaths);
          if (!keepAudio) await removeLocalQaAudio(conversationId).catch(() => {});
          const message = e instanceof Error ? e.message : String(e);
          finishEvalJob(jobId, { status: "failed", error: message });
          settled = true;
          send({
            type: "error",
            conversationId,
            message,
          });
        } finally {
          if (!settled) finishEvalJob(jobId, { status: "failed", error: "interrupted" });
        }
      }
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

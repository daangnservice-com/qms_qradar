import {
  runSilenceDetection,
  summarizeSilences,
  computeSpeechGaps,
  runOverlapDetection,
  computeSpeechOverlaps,
  type SpeechOverlap,
} from "./silence";
import { runGeminiEvaluation, type GeminiScoring } from "./gemini";
import { STT_CHANNEL_COUNT, STT_LANG, STT_MODEL, transcribeCall, mapSpeaker, type SttSegment } from "./stt";
import { logSttCall } from "./sttCallLog";
import { transcriptToSttSegments } from "./sttReuse";
import { getLatestStoredTranscript } from "./evalResultStore";
import { getLatestBatchTranscript } from "./sttBatchStore";
import { maskPII } from "./pii";
import { getProductionPrompt, type PromptConfig } from "./promptStore";
import { templateKeyForOrg, type PromptTemplateKey } from "./promptDefaults";
import type { CallQualityOrg } from "./callQualityOrg";
import type { LlmCallPurpose } from "./llmCallLog";
import { getAudioStep, getInjectVars, isAudioStepEnabled } from "./audioPipeline";
import type { Evaluation, EvaluationResult, OverallSummary, ScoreDetail, TranscriptSegment, MetricDetail, SttSource } from "./types";
import { snapshotOutputSchema, resolveScoreFields } from "./outputSchema";
import { DEFAULT_OUTPUT_SCHEMA_CONFIG } from "./promptTypes";
import {
  buildSignalMetrics,
  computeAgentSpeakRatioPercent,
  computeOverlapRatioPercent,
  mergeMetricMaps,
} from "./callMetrics";
import { matchMetricHighRiskFlags } from "./highRiskFlags";
import { listHighRiskFlagRules } from "./highRiskFlagStore";

function emptyScoring(error: string): GeminiScoring {
  return {
    scores: {},
    metrics: {},
    overallSummary: "",
    silenceComments: [],
    csChecklist: [],
    agentSpeakerTag: null,
    error,
  };
}

function maskScores(scores: Record<string, ScoreDetail> | undefined): Record<string, ScoreDetail> {
  const out: Record<string, ScoreDetail> = {};
  for (const [key, val] of Object.entries(scores ?? {})) {
    out[key] = { score: val?.score ?? 0, comment: maskPII(val?.comment ?? "") };
  }
  return out;
}

function maskMetrics(metrics: Record<string, MetricDetail> | undefined): Record<string, MetricDetail> {
  const out: Record<string, MetricDetail> = {};
  for (const [key, val] of Object.entries(metrics ?? {})) {
    out[key] = {
      ...val,
      comment: val.comment != null ? maskPII(val.comment) : undefined,
    };
  }
  return out;
}

function maskOverallSummary(value: OverallSummary | undefined): OverallSummary {
  if (value == null) return "";
  if (typeof value === "string") return maskPII(value);
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = maskPII(String(val ?? ""));
  }
  return out;
}

export async function evaluateFile(
  filePath: string,
  opts: {
    minSilenceSec: number;
    noiseDb: number;
    org?: CallQualityOrg;
    /** QA 등에서 체크리스트 강제 */
    forceChecklist?: boolean;
    templateKey?: PromptTemplateKey;
    conversationId?: string | null;
    llmPurpose?: LlmCallPurpose;
    promptConfig?: PromptConfig | null;
    /** true면 기존 STT가 있어도 재전사 (기본 false = 재활용) */
    forceStt?: boolean;
  },
  sourcePath: string = filePath,
): Promise<
  EvaluationResult & {
    promptConfig?: PromptConfig;
    llmCallId?: string | null;
    sttReused?: boolean;
  }
> {
  const org = opts.org ?? "growth";
  const templateKey = opts.templateKey ?? templateKeyForOrg(org);
  const promptConfig = opts.promptConfig ?? (await getProductionPrompt(templateKey));
  const audioCfg = promptConfig.version.audioPipelineConfig;

  const silenceStep = getAudioStep(audioCfg, "silence_ffmpeg");
  const overlapStep = getAudioStep(audioCfg, "overlap_ffmpeg");
  const gapsStep = getAudioStep(audioCfg, "speech_gaps_stt");
  const minSilenceSec = silenceStep.minSilenceSec ?? opts.minSilenceSec;
  const noiseDb = silenceStep.noiseDb ?? opts.noiseDb;

  const vars = getInjectVars(audioCfg);
  const needSilence = vars.has("silences") || vars.has("silence_summary");
  const needOverlap = vars.has("overlaps");
  const runSilenceFfmpeg = needSilence && isAudioStepEnabled(audioCfg, "silence_ffmpeg");
  const runSpeechGaps = needSilence && isAudioStepEnabled(audioCfg, "speech_gaps_stt");
  const runOverlap = needOverlap && isAudioStepEnabled(audioCfg, "overlap_ffmpeg");
  const preferSttOverlap = overlapStep.preferOverFfmpeg !== false;
  const needStt =
    vars.has("stt_script") || runSpeechGaps || (runOverlap && preferSttOverlap);

  const t0 = Date.now();
  let durationSec = 0;
  let ffmpegSilences: Awaited<ReturnType<typeof runSilenceDetection>>["silences"] = [];
  let ffmpegSummary: Awaited<ReturnType<typeof runSilenceDetection>>["summary"] = {
    count: 0,
    totalSec: 0,
    longestSec: 0,
    silenceRatio: 0,
  };

  if (runSilenceFfmpeg) {
    const det = await runSilenceDetection(filePath, { minSilenceSec, noiseDb });
    durationSec = det.durationSec;
    ffmpegSilences = det.silences;
    ffmpegSummary = det.summary;
  } else {
    // duration still needed — light probe
    try {
      const det = await runSilenceDetection(filePath, { minSilenceSec: 9999, noiseDb });
      durationSec = det.durationSec;
    } catch {
      durationSec = 0;
    }
  }
  const t1 = Date.now();

  let stt: SttSegment[] = [];
  let sttError: string | null = null;
  let sttReused = false;
  let sttSource: SttSource | null = null;
  if (needStt) {
    const tStt0 = Date.now();
    const cid = (opts.conversationId ?? "").trim();
    if (cid && !opts.forceStt) {
      try {
        const stored = await getLatestStoredTranscript(cid);
        const batch = stored?.transcript.length ? null : await getLatestBatchTranscript(cid);
        const reused = stored?.transcript.length ? stored : batch;
        if (reused?.transcript.length) {
          stt = transcriptToSttSegments(reused.transcript, reused.durationSec || durationSec);
          sttReused = stt.length > 0;
          if (sttReused) {
            sttSource = stored?.transcript.length ? (stored.sttSource ?? "gcp") : "local";
            if (!durationSec && reused.durationSec) durationSec = reused.durationSec;
            console.log(
              `[evaluate] STT reused conversation=${cid} segs=${stt.length} from ${reused.analysisId.slice(0, 16)} source=${sttSource}`,
            );
          }
        }
      } catch (e) {
        console.warn("[evaluate] STT reuse lookup failed:", e instanceof Error ? e.message : e);
      }
    }

    if (!sttReused) {
      try {
        const out = await transcribeCall(sourcePath);
        stt = out.segments;
        sttSource = "gcp";
        const audioDurationSec = Math.max(out.durationSec, durationSec);
        if (!durationSec && out.durationSec) durationSec = out.durationSec;
        void logSttCall({
          purpose: opts.llmPurpose ?? "call_eval",
          conversationId: opts.conversationId,
          model: out.model,
          language: out.language,
          channelCount: out.channelCount,
          audioDurationSec,
          segmentCount: out.segments.length,
          latencyMs: Date.now() - tStt0,
        });
      } catch (e) {
        sttError = `전사(STT) 실패: ${e instanceof Error ? e.message : String(e)}`;
        void logSttCall({
          purpose: opts.llmPurpose ?? "call_eval",
          conversationId: opts.conversationId,
          model: STT_MODEL,
          language: STT_LANG,
          channelCount: STT_CHANNEL_COUNT,
          audioDurationSec: durationSec,
          segmentCount: 0,
          latencyMs: Date.now() - tStt0,
          error: sttError,
        });
      }
    }
  }
  const t2 = Date.now();

  let silences = ffmpegSilences;
  let summary = ffmpegSummary;
  if (runSpeechGaps && stt.length && gapsStep.preferOverFfmpeg !== false) {
    const g = summarizeSilences(computeSpeechGaps(stt), minSilenceSec, durationSec);
    silences = g.silences;
    summary = g.summary;
  }

  let overlaps: SpeechOverlap[] = [];
  if (runOverlap) {
    const overlapNoise = overlapStep.noiseDb ?? noiseDb;
    if (preferSttOverlap && stt.length) {
      overlaps = computeSpeechOverlaps(stt).map((o) => ({
        startSec: o.start,
        endSec: o.end,
        durationSec: o.durationSec,
      }));
    } else {
      try {
        const det = await runOverlapDetection(sourcePath, { noiseDb: overlapNoise });
        overlaps = det.overlaps;
        if (!durationSec && det.durationSec) durationSec = det.durationSec;
      } catch (e) {
        console.warn("[evaluate] overlap_ffmpeg failed:", e instanceof Error ? e.message : e);
        if (stt.length) {
          overlaps = computeSpeechOverlaps(stt).map((o) => ({
            startSec: o.start,
            endSec: o.end,
            durationSec: o.durationSec,
          }));
        }
      }
    }
  }
  const tOverlap = Date.now();

  const useChecklist =
    opts.forceChecklist === true || (org === "growth" && promptConfig.version.useChecklist);
  const criteria = useChecklist ? promptConfig.criteria : undefined;

  let scoring: GeminiScoring;
  try {
    scoring = await runGeminiEvaluation(filePath, silences, summary, stt, {
      checklist: useChecklist,
      criteria,
      promptConfig,
      conversationId: opts.conversationId,
      llmPurpose: opts.llmPurpose ?? "call_eval",
      audioPipelineConfig: audioCfg,
      overlaps,
    });
  } catch (e) {
    scoring = emptyScoring(e instanceof Error ? e.message : String(e));
  }
  const t3 = Date.now();

  const diarized = new Set(stt.map((s) => s.speakerTag)).size > 1;
  const transcript: TranscriptSegment[] = stt.map((s) => ({
    atSec: s.atSec,
    speaker: diarized ? mapSpeaker(s.speakerTag, scoring.agentSpeakerTag) : "",
    text: maskPII(s.text),
  }));

  const { coerceAtSec } = await import("./atSecNormalize");
  const sttHints = stt.map((s) => ({ atSec: s.atSec, text: s.text }));

  const schemaCfg = promptConfig.version.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG;
  const agentSpeakRatio = computeAgentSpeakRatioPercent(stt, scoring.agentSpeakerTag);
  const overlapRatio = computeOverlapRatioPercent(overlaps, durationSec);
  const signalMetrics = buildSignalMetrics({
    fields: resolveScoreFields(schemaCfg),
    agentSpeakRatioPercent: agentSpeakRatio,
    overlapRatioPercent: overlapRatio,
  });
  const metrics = maskMetrics(mergeMetricMaps(signalMetrics, scoring.metrics));

  let highRiskFlags: Evaluation["highRiskFlags"] = [];
  try {
    const rules = await listHighRiskFlagRules();
    highRiskFlags = matchMetricHighRiskFlags(rules, metrics);
  } catch (e) {
    console.warn("[evaluate] highRiskFlags:", e instanceof Error ? e.message : e);
  }

  const evaluation: Evaluation = {
    scores: maskScores(scoring.scores),
    metrics,
    overallSummary: maskOverallSummary(scoring.overallSummary),
    outputSchemaSnapshot: snapshotOutputSchema(schemaCfg),
    silenceComments: scoring.silenceComments.map((c) => ({
      atSec: coerceAtSec(c.atSec, { stt: sttHints }),
      note: maskPII(c.note),
    })),
    csChecklist: (scoring.csChecklist ?? []).map((c) => ({
      ...c,
      reason: maskPII(c.reason),
      evidence: c.evidence.map((e) => ({
        atSec: coerceAtSec(e.atSec, { quote: e.quote, stt: sttHints }),
        quote: maskPII(e.quote),
      })),
    })),
    transcript,
    highRiskFlags,
    error: scoring.error ?? sttError,
  };

  console.log(
    `[evaluate] silence=${t1 - t0}ms stt=${t2 - t1}ms${sttReused ? "(reused)" : ""} overlap=${tOverlap - t2}ms gemini=${t3 - tOverlap}ms prompt=${promptConfig.version.versionLabel} (${promptConfig.version.versionId.slice(0, 8)}) (call ${durationSec.toFixed(0)}s, ${stt.length} segs, ${overlaps.length} overlaps)`,
  );

  return {
    durationSec,
    threshold: { minSilenceSec, noiseDb },
    silences,
    silenceSummary: summary,
    overlaps,
    evaluation,
    promptConfig,
    llmCallId: scoring.llmCallId ?? null,
    sttReused,
    sttSource,
  };
}

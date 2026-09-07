import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { formatClock } from "./format";
import { buildChecklistPromptBlock, type CsCriterion } from "./csChecklist";
import { buildChecklistBlock, renderTemplate } from "./promptRender";
import type { PromptConfig } from "./promptStore";
import { defaultResponseSchema } from "./promptDefaults";
import type { Silence, SilenceSummary, ScoreDetail, ChecklistResult, OverallSummary, MetricDetail } from "./types";
import type { SchemaValueType } from "./promptTypes";
import { fieldValueType, resolveLlmMetricFields } from "./outputSchema";
import type { SttSegment } from "./stt";
import { logLlmCall, type LlmCallMeta, type LlmCallPurpose } from "./llmCallLog";
import {
  getInjectVars,
  isAudioStepEnabled,
  type AudioPipelineConfig,
} from "./audioPipeline";
import { buildResponseSchemaFromConfig, outputSchemaPromptVars } from "./outputSchema";
import { DEFAULT_OUTPUT_SCHEMA_CONFIG } from "./promptTypes";
import { tokensByModality } from "./llmPricing";
import type { SpeechOverlap } from "./silence";
import type { EvaluationTurn } from "./evaluationChannel";
import { DEFAULT_TEXT_BASE_PROMPT, DEFAULT_TEXT_CHECKLIST_TEMPLATE } from "./promptDefaults";

// Gemini 채점 결과(전사는 STT가 담당하므로 여기서 생성하지 않는다).
export interface GeminiScoring {
  scores: Record<string, ScoreDetail>;
  metrics: Record<string, MetricDetail>;
  overallSummary: OverallSummary;
  silenceComments: { atSec: number; note: string }[];
  csChecklist: ChecklistResult[];
  agentSpeakerTag: number | null;
  error: string | null;
  promptVersionId?: string | null;
  llmCallId?: string | null;
  llmMeta?: LlmCallMeta | null;
}

function formatSilences(silences: Silence[]): string {
  return (
    silences
      .map((s) => `- ${formatClock(s.startSec)}~${formatClock(s.endSec)} (${s.durationSec.toFixed(1)}초)`)
      .join("\n") || "- (기준 이상 공백 없음)"
  );
}

function formatOverlaps(overlaps: SpeechOverlap[]): string {
  return (
    overlaps
      .map((o) => `- ${formatClock(o.startSec)}~${formatClock(o.endSec)} (${o.durationSec.toFixed(1)}초)`)
      .join("\n") || "- (말 겹침 구간 없음)"
  );
}

function formatStt(stt: SttSegment[]): string {
  return stt.length
    ? stt
        .map((s) => {
          const sec = Math.round(s.atSec * 10) / 10;
          return `[화자 ${s.speakerTag} @${formatClock(s.atSec)} = ${sec}s] ${s.text}`;
        })
        .join("\n")
    : "(전사 없음 — 녹음을 직접 듣고 판단)";
}

/** BQ 프롬프트 설정으로 평가 프롬프트 렌더. config 없으면 레거시 하드코딩 경로. */
export function buildEvaluationPrompt(
  silences: Silence[],
  summary: SilenceSummary,
  stt: SttSegment[],
  checklist: boolean = false,
  criteria?: CsCriterion[],
  promptConfig?: PromptConfig | null,
  audioPipelineConfig?: AudioPipelineConfig | null,
  overlaps: SpeechOverlap[] = [],
): string {
  const audioCfg = audioPipelineConfig ?? promptConfig?.version.audioPipelineConfig;
  const vars = getInjectVars(audioCfg);

  const silencesText = vars.has("silences") ? formatSilences(silences) : "";
  const silenceSummary = vars.has("silence_summary")
    ? `요약: 공백 ${summary.count}회, 총 ${summary.totalSec.toFixed(1)}초, 최장 ${summary.longestSec.toFixed(1)}초.`
    : "";
  const sttScript = vars.has("stt_script") ? formatStt(stt) : "";
  const overlapsText = vars.has("overlaps") ? formatOverlaps(overlaps) : "";

  if (promptConfig) {
    const useCl = checklist && promptConfig.version.useChecklist;
    const crit = criteria ?? promptConfig.criteria;
    const checklistBlock = useCl
      ? buildChecklistBlock(promptConfig.version.checklistTemplate, crit)
      : "";
    const schemaVars = outputSchemaPromptVars(promptConfig.version.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG);
    return renderTemplate(promptConfig.version.basePrompt, {
      silences: silencesText,
      silence_summary: silenceSummary,
      stt_script: sttScript,
      overlaps: overlapsText,
      checklist_block: checklistBlock ? `\n${checklistBlock}` : "",
      score_items: schemaVars.score_items,
      overall_fields: schemaVars.overall_fields,
    }).trim();
  }

  return [
    "당신은 고객 상담(CS) 콜 품질 평가자입니다. 첨부된 통화 녹음을 듣고 아래 3개 항목을 각각 1~5점(정수)으로 평가하세요.",
    "",
    "평가 항목:",
    "1) 응대 태도 (attitude): 친절함, 공감, 말투",
    "2) 문제 해결력 (resolution): 고객 문의를 실제로 해결했는지",
    "3) 대화 흐름 (flow): 침묵/공백/어색한 끊김이 흐름에 준 영향",
    "",
    ...(silencesText
      ? [
          "신호 분석으로 측정된 공백(무음) 구간 — 상담원이 어드민에서 검색하느라 비운 시간일 수 있음:",
          silencesText,
          silenceSummary,
          "",
          "위 공백 구간을 근거로 flow를 평가하고, 주요 공백에 대해 silenceComments에 코멘트를 남기세요.",
          "",
        ]
      : []),
    ...(overlapsText
      ? [
          "신호/전사 분석으로 측정된 말 겹침(동시 발화) 구간:",
          overlapsText,
          "",
        ]
      : []),
    ...(sttScript
      ? [
          "아래는 STT(음성인식)로 화자를 분리해 전사한 스크립트입니다(화자는 번호로만 구분됨):",
          sttScript,
          "",
          "이 스크립트에서 **상담원(고객센터 직원)에 해당하는 화자 번호**를 agentSpeakerTag로 알려주세요(판단 불가하면 null).",
        ]
      : []),
    ...(checklist ? ["", buildChecklistPromptBlock(criteria)] : []),
    "",
    "반드시 지정된 JSON 스키마로만 응답하세요.",
  ].join("\n");
}

function resolveResponseSchema(
  checklist: boolean,
  promptConfig?: PromptConfig | null,
  audioPipelineConfig?: AudioPipelineConfig | null,
): object {
  const audioCfg = audioPipelineConfig ?? promptConfig?.version.audioPipelineConfig;
  const silenceOn = isAudioStepEnabled(audioCfg, "schema_silence_comments");
  if (promptConfig) {
    if (!checklist) {
      return buildResponseSchemaFromConfig({
        ...(promptConfig.version.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG),
        includeCsChecklist: false,
        includeSilenceComments: silenceOn,
      });
    }
    if (!silenceOn && promptConfig.version.outputSchemaConfig) {
      return buildResponseSchemaFromConfig({
        ...promptConfig.version.outputSchemaConfig,
        includeSilenceComments: false,
      });
    }
    return promptConfig.responseSchema;
  }
  return defaultResponseSchema(checklist);
}

function parseScores(raw: unknown): Record<string, ScoreDetail> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ScoreDetail> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    if (!("score" in o) && !("comment" in o)) continue;
    const score = Number(o.score);
    out[key] = {
      score: Number.isFinite(score) ? score : 0,
      comment: String(o.comment ?? ""),
    };
  }
  return out;
}

function coerceMetricValue(raw: unknown, valueType: SchemaValueType): number | boolean | string | null {
  if (raw == null) return null;
  if (valueType === "bool") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    const s = String(raw).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return null;
  }
  if (valueType === "percent" || valueType === "score") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

function parseMetrics(
  raw: unknown,
  expectedTypes: Record<string, SchemaValueType>,
): Record<string, MetricDetail> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, MetricDetail> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    const valueType = expectedTypes[key] ?? "label";
    const value = coerceMetricValue(o.value, valueType);
    out[key] = {
      valueType,
      value,
      comment: String(o.comment ?? ""),
      source: "llm",
    };
  }
  return out;
}

function parseOverallSummary(raw: unknown): OverallSummary {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      if (val == null) continue;
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        out[key] = String(val);
      }
    }
    return out;
  }
  return String(raw);
}

export function parseEvaluation(jsonText: string, metricTypes?: Record<string, SchemaValueType>): GeminiScoring {
  const cleaned = jsonText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const o = JSON.parse(cleaned);
  const tag = o.agentSpeakerTag;
  return {
    scores: parseScores(o.scores),
    metrics: parseMetrics(o.metrics, metricTypes ?? {}),
    overallSummary: parseOverallSummary(o.overallSummary),
    silenceComments: Array.isArray(o.silenceComments)
      ? o.silenceComments.map((c: { atSec: number; note: string }) => ({ atSec: Number(c.atSec), note: String(c.note) }))
      : [],
    csChecklist: Array.isArray(o.csChecklist)
      ? o.csChecklist.map((c: { id: number; violated: boolean; evidence?: { atSec: number; quote: string }[]; reason?: string }) => ({
          id: Number(c.id),
          violated: Boolean(c.violated),
          evidence: Array.isArray(c.evidence)
            ? c.evidence.map((e) => ({ atSec: Number(e.atSec), quote: String(e.quote) }))
            : [],
          reason: String(c.reason ?? ""),
        }))
      : [],
    agentSpeakerTag: tag == null || Number.isNaN(Number(tag)) ? null : Number(tag),
    error: null,
  };
}

function extractLlmMeta(
  result: { response: { usageMetadata?: unknown; candidates?: unknown; promptFeedback?: unknown } },
  latencyMs: number,
  model: string,
  promptConfig?: PromptConfig | null,
): LlmCallMeta {
  const usage = (result.response.usageMetadata ?? {}) as Record<string, unknown>;
  const candidates = result.response.candidates as Array<{ finishReason?: string }> | undefined;
  const finishReason = candidates?.[0]?.finishReason ?? null;
  const byMod = tokensByModality(usage);
  return {
    model,
    promptVersionId: promptConfig?.version.versionId ?? null,
    templateKey: promptConfig?.version.templateKey ?? null,
    latencyMs,
    promptTokenCount: Number(usage.promptTokenCount ?? usage.prompt_token_count ?? NaN) || null,
    candidatesTokenCount: Number(usage.candidatesTokenCount ?? usage.candidates_token_count ?? NaN) || null,
    totalTokenCount: Number(usage.totalTokenCount ?? usage.total_token_count ?? NaN) || null,
    cachedContentTokenCount:
      Number(usage.cachedContentTokenCount ?? usage.cached_content_token_count ?? NaN) || null,
    audioPromptTokenCount: byMod.audio || null,
    finishReason: finishReason != null ? String(finishReason) : null,
    seed: null,
    responseId: null,
    rawUsage: usage,
    rawResponseMeta: {
      candidates: result.response.candidates ?? null,
      promptFeedback: result.response.promptFeedback ?? null,
    },
  };
}

export async function runGeminiEvaluation(
  filePath: string,
  silences: Silence[],
  summary: SilenceSummary,
  stt: SttSegment[],
  opts: {
    checklist?: boolean;
    criteria?: CsCriterion[];
    promptConfig?: PromptConfig | null;
    conversationId?: string | null;
    llmPurpose?: LlmCallPurpose;
    audioPipelineConfig?: AudioPipelineConfig | null;
    overlaps?: SpeechOverlap[];
  } = {},
): Promise<GeminiScoring> {
  const checklist = opts.checklist ?? false;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const purpose = opts.llmPurpose ?? "call_eval";
  const audioCfg = opts.audioPipelineConfig ?? opts.promptConfig?.version.audioPipelineConfig;
  const attachAudio = isAudioStepEnabled(audioCfg, "gemini_audio_file");

  const fileManager = attachAudio ? new GoogleAIFileManager(apiKey) : null;
  let uploadedUri: string | null = null;
  let uploadedMime: string | null = null;
  let uploadedName: string | null = null;

  if (attachAudio && fileManager) {
    const uploaded = await fileManager.uploadFile(filePath, { mimeType: "audio/wav", displayName: "call.wav" });
    uploadedName = uploaded.file.name;
    const MAX_POLL_ATTEMPTS = 150;
    const POLL_INTERVAL_MS = 2000;
    let file = await fileManager.getFile(uploaded.file.name);
    let attempts = 0;
    while (file.state === FileState.PROCESSING) {
      if (attempts >= MAX_POLL_ATTEMPTS)
        throw new Error(
          "Gemini 오디오 처리 시간 초과 — 업로드한 파일이 약 300초 안에 처리 준비되지 않았어요. 파일이 너무 길거나 네트워크가 느릴 수 있어요.",
        );
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      file = await fileManager.getFile(uploaded.file.name);
      attempts++;
    }
    if (file.state === FileState.FAILED) throw new Error("Gemini 파일 처리 실패");
    uploadedUri = file.uri;
    uploadedMime = file.mimeType;
  }

  const tGen0 = Date.now();
  try {
    const schema = resolveResponseSchema(checklist, opts.promptConfig, audioCfg);
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({
      model,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema as unknown as Schema,
      },
    });
    const promptText = buildEvaluationPrompt(
      silences,
      summary,
      stt,
      checklist,
      opts.criteria ?? opts.promptConfig?.criteria,
      opts.promptConfig,
      audioCfg,
      opts.overlaps ?? [],
    );
    const parts: Array<{ fileData: { fileUri: string; mimeType: string } } | { text: string }> = [];
    if (uploadedUri && uploadedMime) {
      parts.push({ fileData: { fileUri: uploadedUri, mimeType: uploadedMime } });
    }
    parts.push({ text: promptText });
    const result = await gm.generateContent(parts);
    const latencyMs = Date.now() - tGen0;
    const metricTypes = Object.fromEntries(
      resolveLlmMetricFields(opts.promptConfig?.version.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG).map(
        (f) => [f.key, fieldValueType(f)],
      ),
    );
    const scored = parseEvaluation(result.response.text(), metricTypes);
    scored.promptVersionId = opts.promptConfig?.version.versionId ?? null;
    const llmMeta = extractLlmMeta(result, latencyMs, model, opts.promptConfig);
    scored.llmMeta = llmMeta;
    scored.llmCallId = await logLlmCall({
      purpose,
      conversationId: opts.conversationId,
      meta: llmMeta,
    });
    return scored;
  } catch (e) {
    const latencyMs = Date.now() - tGen0;
    const errMsg = e instanceof Error ? e.message : String(e);
    await logLlmCall({
      purpose,
      conversationId: opts.conversationId,
      meta: {
        model,
        promptVersionId: opts.promptConfig?.version.versionId ?? null,
        templateKey: opts.promptConfig?.version.templateKey ?? null,
        latencyMs,
        error: errMsg,
      },
    });
    throw e;
  } finally {
    if (fileManager && uploadedName) {
      await fileManager.deleteFile(uploadedName).catch(() => {});
    }
  }
}

function formatConversationTurns(turns: EvaluationTurn[]): string {
  return turns.length
    ? turns
        .map((turn, index) => {
          const when = turn.occurredAt ? ` ${turn.occurredAt}` : "";
          return `[${index + 1}] ${turn.speakerLabel}${when}\n${turn.text}`;
        })
        .join("\n\n")
    : "(대화 원문 없음)";
}

/** 오디오/STT 없이 인앱 문의·채팅 원문만으로 평가한다. */
export function buildTextEvaluationPrompt(
  turns: EvaluationTurn[],
  checklist: boolean,
  criteria?: CsCriterion[],
  promptConfig?: PromptConfig | null,
): string {
  const config = promptConfig;
  const schemaCfg = config?.version.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG;
  const schemaVars = outputSchemaPromptVars(schemaCfg);
  const checklistBlock =
    checklist && config
      ? buildChecklistBlock(config.version.checklistTemplate, criteria ?? config.criteria)
      : checklist
        ? buildChecklistBlock(DEFAULT_TEXT_CHECKLIST_TEMPLATE, criteria ?? [], undefined)
        : "";
  const base = config?.version.basePrompt ?? DEFAULT_TEXT_BASE_PROMPT;
  return renderTemplate(base, {
    silences: "",
    silence_summary: "",
    stt_script: "",
    overlaps: "",
    conversation_text: [
      "── 평가 대상 텍스트 대화 원문 ──",
      "대괄호 안의 발화 순서와 화자 표기를 보존해 판단하세요.",
      formatConversationTurns(turns),
    ].join("\n"),
    checklist_block: checklistBlock ? `\n${checklistBlock}` : "",
    score_items: schemaVars.score_items,
    overall_fields: schemaVars.overall_fields,
  }).trim();
}

export async function runGeminiTextEvaluation(
  turns: EvaluationTurn[],
  opts: {
    checklist?: boolean;
    criteria?: CsCriterion[];
    promptConfig?: PromptConfig | null;
    conversationId?: string | null;
    llmPurpose?: "feedback_eval" | "call_eval";
  } = {},
): Promise<GeminiScoring> {
  const checklist = opts.checklist ?? opts.promptConfig?.version.useChecklist ?? false;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const purpose = opts.llmPurpose ?? "feedback_eval";
  const schemaConfig = {
    ...(opts.promptConfig?.version.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG),
    includeSilenceComments: false,
    includeAgentSpeakerTag: false,
  };
  const schema = buildResponseSchemaFromConfig({
    ...schemaConfig,
    includeCsChecklist: checklist,
  });
  const promptText = buildTextEvaluationPrompt(turns, checklist, opts.criteria, opts.promptConfig);
  const t0 = Date.now();

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({
      model,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema as unknown as Schema,
      },
    });
    const result = await gm.generateContent(promptText);
    const metricTypes = Object.fromEntries(
      resolveLlmMetricFields(schemaConfig).map((field) => [field.key, fieldValueType(field)]),
    );
    const scored = parseEvaluation(result.response.text(), metricTypes);
    scored.promptVersionId = opts.promptConfig?.version.versionId ?? null;
    const llmMeta = extractLlmMeta(result, Date.now() - t0, model, opts.promptConfig);
    scored.llmMeta = llmMeta;
    scored.llmCallId = await logLlmCall({
      purpose,
      conversationId: opts.conversationId,
      meta: llmMeta,
    });
    return scored;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await logLlmCall({
      purpose,
      conversationId: opts.conversationId,
      meta: {
        model,
        promptVersionId: opts.promptConfig?.version.versionId ?? null,
        templateKey: opts.promptConfig?.version.templateKey ?? null,
        latencyMs: Date.now() - t0,
        error: errMsg,
      },
    });
    throw error;
  }
}

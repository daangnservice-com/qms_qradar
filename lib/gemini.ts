import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { formatClock } from "./format";
import { buildChecklistPromptBlock } from "./csChecklist";
import type { Silence, SilenceSummary, ScoreDetail, ChecklistResult } from "./types";
import type { SttSegment } from "./stt";

// Gemini 채점 결과(전사는 STT가 담당하므로 여기서 생성하지 않는다).
export interface GeminiScoring {
  scores: { attitude: ScoreDetail; resolution: ScoreDetail; flow: ScoreDetail };
  overallSummary: string;
  silenceComments: { atSec: number; note: string }[];
  csChecklist: ChecklistResult[]; // CS 영역 감점 체크리스트(항목별 위반+근거)
  agentSpeakerTag: number | null; // STT 화자 태그 중 상담원에 해당하는 번호
  error: string | null;
}

export function buildEvaluationPrompt(
  silences: Silence[],
  summary: SilenceSummary,
  stt: SttSegment[],
  checklist: boolean = false,
): string {
  const lines = silences
    .map((s) => `- ${formatClock(s.startSec)}~${formatClock(s.endSec)} (${s.durationSec.toFixed(1)}초)`)
    .join("\n") || "- (기준 이상 공백 없음)";
  const script = stt.length
    ? stt.map((s) => `[화자 ${s.speakerTag} @${formatClock(s.atSec)}] ${s.text}`).join("\n")
    : "(전사 없음 — 녹음을 직접 듣고 판단)";
  return [
    "당신은 고객 상담(CS) 콜 품질 평가자입니다. 첨부된 통화 녹음을 듣고 아래 3개 항목을 각각 1~5점(정수)으로 평가하세요.",
    "",
    "평가 항목:",
    "1) 응대 태도 (attitude): 친절함, 공감, 말투",
    "2) 문제 해결력 (resolution): 고객 문의를 실제로 해결했는지",
    "3) 대화 흐름 (flow): 침묵/공백/어색한 끊김이 흐름에 준 영향",
    "",
    "신호 분석으로 측정된 공백(무음) 구간 — 상담원이 어드민에서 검색하느라 비운 시간일 수 있음:",
    lines,
    `요약: 공백 ${summary.count}회, 총 ${summary.totalSec.toFixed(1)}초, 최장 ${summary.longestSec.toFixed(1)}초.`,
    "",
    "위 공백 구간을 근거로 flow를 평가하고, 주요 공백에 대해 silenceComments에 코멘트를 남기세요.",
    "",
    "아래는 STT(음성인식)로 화자를 분리해 전사한 스크립트입니다(화자는 번호로만 구분됨):",
    script,
    "",
    "이 스크립트에서 **상담원(고객센터 직원)에 해당하는 화자 번호**를 agentSpeakerTag로 알려주세요(판단 불가하면 null).",
    // CS 영역 체크리스트는 성장문화실(growth)에만 적용. 조직별 기준이 다르므로 플래그로 분기.
    ...(checklist ? ["", buildChecklistPromptBlock()] : []),
    "",
    "반드시 지정된 JSON 스키마로만 응답하세요.",
  ].join("\n");
}

const CHECKLIST_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "integer" },
      violated: { type: "boolean" },
      evidence: {
        type: "array",
        items: { type: "object", properties: { atSec: { type: "number" }, quote: { type: "string" } }, required: ["atSec", "quote"] },
      },
      reason: { type: "string" },
    },
    required: ["id", "violated", "reason"],
  },
} as const;

// 응답 스키마. CS 체크리스트는 성장문화실(growth)에만 요구(checklist=true).
function buildResponseSchema(checklist: boolean) {
  return {
    type: "object",
    properties: {
      scores: {
        type: "object",
        properties: {
          attitude: { type: "object", properties: { score: { type: "integer" }, comment: { type: "string" } }, required: ["score", "comment"] },
          resolution: { type: "object", properties: { score: { type: "integer" }, comment: { type: "string" } }, required: ["score", "comment"] },
          flow: { type: "object", properties: { score: { type: "integer" }, comment: { type: "string" } }, required: ["score", "comment"] },
        },
        required: ["attitude", "resolution", "flow"],
      },
      overallSummary: { type: "string" },
      silenceComments: {
        type: "array",
        items: { type: "object", properties: { atSec: { type: "number" }, note: { type: "string" } }, required: ["atSec", "note"] },
      },
      ...(checklist ? { csChecklist: CHECKLIST_SCHEMA } : {}),
      agentSpeakerTag: { type: "integer", nullable: true },
    },
    required: ["scores", "overallSummary", "silenceComments", ...(checklist ? ["csChecklist"] : [])],
  };
}

export function parseEvaluation(jsonText: string): GeminiScoring {
  const cleaned = jsonText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const o = JSON.parse(cleaned);
  const tag = o.agentSpeakerTag;
  return {
    scores: {
      attitude: { score: Number(o.scores.attitude.score), comment: String(o.scores.attitude.comment) },
      resolution: { score: Number(o.scores.resolution.score), comment: String(o.scores.resolution.comment) },
      flow: { score: Number(o.scores.flow.score), comment: String(o.scores.flow.comment) },
    },
    overallSummary: String(o.overallSummary ?? ""),
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

export async function runGeminiEvaluation(
  filePath: string,
  silences: Silence[],
  summary: SilenceSummary,
  stt: SttSegment[],
  opts: { checklist?: boolean } = {},
): Promise<GeminiScoring> {
  const checklist = opts.checklist ?? false;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const fileManager = new GoogleAIFileManager(apiKey);
  // 업로드 전 wav로 정규화된 파일(lib/audio.transcodeToWav)을 받는다.
  const uploaded = await fileManager.uploadFile(filePath, { mimeType: "audio/wav", displayName: "call.wav" });

  // 파일이 ACTIVE 될 때까지 대기 (최대 120초 / 60회 시도)
  const MAX_POLL_ATTEMPTS = 60;
  const POLL_INTERVAL_MS = 2000;
  let file = await fileManager.getFile(uploaded.file.name);
  let attempts = 0;
  while (file.state === FileState.PROCESSING) {
    if (attempts >= MAX_POLL_ATTEMPTS)
      throw new Error(
        "Gemini 오디오 처리 시간 초과 — 업로드한 파일이 약 120초 안에 처리 준비되지 않았어요. 파일이 너무 길거나 네트워크가 느릴 수 있어요. 더 짧은 파일로 시도해 주세요.",
      );
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    file = await fileManager.getFile(uploaded.file.name);
    attempts++;
  }
  if (file.state === FileState.FAILED) throw new Error("Gemini 파일 처리 실패");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({
      model,
      generationConfig: { responseMimeType: "application/json", responseSchema: buildResponseSchema(checklist) as unknown as Schema },
    });
    const result = await gm.generateContent([
      { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
      { text: buildEvaluationPrompt(silences, summary, stt, checklist) },
    ]);
    return parseEvaluation(result.response.text());
  } finally {
    await fileManager.deleteFile(uploaded.file.name).catch(() => {});
  }
}

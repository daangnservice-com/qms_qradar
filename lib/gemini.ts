import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { formatClock } from "./format";
import type { Silence, SilenceSummary, Evaluation } from "./types";

export function buildEvaluationPrompt(silences: Silence[], summary: SilenceSummary): string {
  const lines = silences
    .map((s) => `- ${formatClock(s.startSec)}~${formatClock(s.endSec)} (${s.durationSec.toFixed(1)}초)`)
    .join("\n") || "- (기준 이상 공백 없음)";
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
    "반드시 지정된 JSON 스키마로만 응답하세요.",
  ].join("\n");
}

const RESPONSE_SCHEMA = {
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
  },
  required: ["scores", "overallSummary", "silenceComments"],
} as const;

export function parseEvaluation(jsonText: string): Evaluation {
  const cleaned = jsonText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const o = JSON.parse(cleaned);
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
    error: null,
  };
}

export async function runGeminiEvaluation(filePath: string, silences: Silence[], summary: SilenceSummary): Promise<Evaluation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const fileManager = new GoogleAIFileManager(apiKey);
  const uploaded = await fileManager.uploadFile(filePath, { mimeType: "audio/mp4", displayName: "call.m4a" });

  // 파일이 ACTIVE 될 때까지 대기
  let file = await fileManager.getFile(uploaded.file.name);
  while (file.state === FileState.PROCESSING) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await fileManager.getFile(uploaded.file.name);
  }
  if (file.state === FileState.FAILED) throw new Error("Gemini 파일 처리 실패");

  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({
    model,
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA as object },
  });
  const result = await gm.generateContent([
    { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
    { text: buildEvaluationPrompt(silences, summary) },
  ]);
  return parseEvaluation(result.response.text());
}

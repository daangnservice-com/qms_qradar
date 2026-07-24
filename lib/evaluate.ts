import { runSilenceDetection, summarizeSilences, computeSpeechGaps } from "./silence";
import { runGeminiEvaluation, type GeminiScoring } from "./gemini";
import { transcribeCall, mapSpeaker, type SttSegment } from "./stt";
import { maskPII } from "./pii";
import type { Evaluation, EvaluationResult, TranscriptSegment } from "./types";

function emptyScoring(error: string): GeminiScoring {
  return {
    scores: {
      attitude: { score: 0, comment: "" },
      resolution: { score: 0, comment: "" },
      flow: { score: 0, comment: "" },
    },
    overallSummary: "",
    silenceComments: [],
    agentSpeakerTag: null,
    error,
  };
}

export async function evaluateFile(
  filePath: string,
  opts: { minSilenceSec: number; noiseDb: number },
  sourcePath: string = filePath,
): Promise<EvaluationResult> {
  const t0 = Date.now();
  // ffmpeg 무음(진짜 조용한 구간). STT가 되면 무발화 공백을 대신 쓴다(보류음/배경음에도 강함).
  const { durationSec, silences: ffmpegSilences, summary: ffmpegSummary } = await runSilenceDetection(filePath, opts);
  const t1 = Date.now();

  // 정확한 전사·타임스탬프·화자분리는 STT로(원본 오디오에서 스테레오 변환). 실패해도 채점은 진행(전사만 비게 됨).
  let stt: SttSegment[] = [];
  let sttError: string | null = null;
  try {
    stt = await transcribeCall(sourcePath);
  } catch (e) {
    sttError = `전사(STT) 실패: ${e instanceof Error ? e.message : String(e)}`;
  }
  const t2 = Date.now();

  // 공백: STT 무발화 구간(양 채널 다 조용) 우선. STT 실패 시 ffmpeg 무음 폴백.
  let silences = ffmpegSilences;
  let summary = ffmpegSummary;
  if (stt.length) {
    const g = summarizeSilences(computeSpeechGaps(stt), opts.minSilenceSec, durationSec);
    silences = g.silences;
    summary = g.summary;
  }

  let scoring: GeminiScoring;
  try {
    scoring = await runGeminiEvaluation(filePath, silences, summary, stt);
  } catch (e) {
    scoring = emptyScoring(e instanceof Error ? e.message : String(e));
  }
  const t3 = Date.now();

  // STT 세그먼트(정확한 atSec)로 최종 transcript 구성.
  // 화자분리가 실제로 됐을 때만(태그 2종 이상) 상담원/고객 라벨. 안 되면(단일 태그) 라벨 없음 — 잘못된 "상담원" 오해 방지.
  const diarized = new Set(stt.map((s) => s.speakerTag)).size > 1;
  const transcript: TranscriptSegment[] = stt.map((s) => ({
    atSec: s.atSec,
    speaker: diarized ? mapSpeaker(s.speakerTag, scoring.agentSpeakerTag) : "",
    text: maskPII(s.text), // 저장 전 PII 마스킹 → BigQuery엔 원본이 안 남음
  }));

  // 채점 텍스트에도 고객 PII가 인용될 수 있어 저장 전 마스킹(총평·항목 코멘트·공백 코멘트).
  const evaluation: Evaluation = {
    scores: {
      attitude: { ...scoring.scores.attitude, comment: maskPII(scoring.scores.attitude.comment) },
      resolution: { ...scoring.scores.resolution, comment: maskPII(scoring.scores.resolution.comment) },
      flow: { ...scoring.scores.flow, comment: maskPII(scoring.scores.flow.comment) },
    },
    overallSummary: maskPII(scoring.overallSummary),
    silenceComments: scoring.silenceComments.map((c) => ({ ...c, note: maskPII(c.note) })),
    transcript,
    error: scoring.error ?? sttError,
  };

  console.log(
    `[evaluate] silence=${t1 - t0}ms stt=${t2 - t1}ms gemini=${t3 - t2}ms (call ${durationSec.toFixed(0)}s, ${stt.length} segs)`,
  );

  return {
    durationSec,
    threshold: { minSilenceSec: opts.minSilenceSec, noiseDb: opts.noiseDb },
    silences,
    silenceSummary: summary,
    evaluation,
  };
}

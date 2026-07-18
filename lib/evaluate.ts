import { runSilenceDetection } from "./silence";
import { runGeminiEvaluation } from "./gemini";
import type { Evaluation, EvaluationResult } from "./types";

function emptyEvaluation(error: string): Evaluation {
  return {
    scores: {
      attitude: { score: 0, comment: "" },
      resolution: { score: 0, comment: "" },
      flow: { score: 0, comment: "" },
    },
    overallSummary: "",
    silenceComments: [],
    error,
  };
}

export async function evaluateFile(
  filePath: string,
  opts: { minSilenceSec: number; noiseDb: number },
): Promise<EvaluationResult> {
  const { durationSec, silences, summary } = await runSilenceDetection(filePath, opts);

  let evaluation: Evaluation;
  try {
    evaluation = await runGeminiEvaluation(filePath, silences, summary);
  } catch (e) {
    evaluation = emptyEvaluation(e instanceof Error ? e.message : String(e));
  }

  return {
    durationSec,
    threshold: { minSilenceSec: opts.minSilenceSec, noiseDb: opts.noiseDb },
    silences,
    silenceSummary: summary,
    evaluation,
  };
}

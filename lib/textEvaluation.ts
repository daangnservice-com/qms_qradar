import { runGeminiTextEvaluation, type GeminiScoring } from "./gemini";
import { getProductionPrompt, validatePromptVersionChannels, type PromptConfig } from "./promptStore";
import { promptChannelForTemplateKey } from './promptDefaults';
import { validateChecklistCoverage } from './checklistCoverage';
import { templateKeyForChannel } from "./promptDefaults";
import { maskPII } from "./pii";
import { listHighRiskFlagRules } from "./highRiskFlagStore";
import { matchFeedbackHighRiskFlags, matchMetricHighRiskFlags } from "./highRiskFlags";
import { snapshotOutputSchema } from "./outputSchema";
import type { Evaluation, EvaluationResult, MetricDetail, ScoreDetail } from "./types";
import type { EvaluationChannel, EvaluationTurn } from "./evaluationChannel";

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

function maskScores(scores: Record<string, ScoreDetail>): Record<string, ScoreDetail> {
  return Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [
      key,
      { score: value.score, comment: maskPII(value.comment ?? "") },
    ]),
  );
}

function maskMetrics(metrics: Record<string, MetricDetail>): Record<string, MetricDetail> {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key,
      { ...value, comment: value.comment == null ? undefined : maskPII(value.comment) },
    ]),
  );
}

function maskSummary(value: Evaluation["overallSummary"]): Evaluation["overallSummary"] {
  if (typeof value === "string") return maskPII(value);
  return Object.fromEntries(Object.entries(value).map(([key, text]) => [key, maskPII(text)]));
}

function relativeDuration(turns: EvaluationTurn[]): number {
  const atSec = turns.map((turn) => turn.atSec).filter((value): value is number => Number.isFinite(value));
  return atSec.length ? Math.max(...atSec) : 0;
}

export async function evaluateText(
  turns: EvaluationTurn[],
  opts: {
    channel: Exclude<EvaluationChannel, "phone">;
    sourceSystem: string;
    sourceId: string;
    promptConfig?: PromptConfig | null;
    /** 인앱 문의 건수 플래그. 목록과 같은 규칙으로 평가 결과에도 붙인다. */
    threadCounts?: { feedbackCount: number; replyCount: number };
  },
): Promise<EvaluationResult & { promptConfig?: PromptConfig; llmCallId?: string | null }> {
  if (!turns.length) throw new Error("평가할 대화 원문이 없습니다.");
  const promptConfig =
    opts.promptConfig ?? (await getProductionPrompt(templateKeyForChannel(opts.channel)));
  const useChecklist = promptConfig.version.useChecklist;
  if (promptChannelForTemplateKey(promptConfig.version.templateKey) !== opts.channel) throw new Error('평가 채널과 평가셋 채널이 다릅니다');
  const frozenCriteria = await validatePromptVersionChannels(promptConfig.version);
  const criteria = useChecklist ? frozenCriteria ?? promptConfig.criteria : undefined;
  if (useChecklist && !frozenCriteria) validateChecklistCoverage(criteria ?? [], promptConfig.version.criterionBindings.filter((b) => b.enabled).map((b) => b.criterionId));
  let scoring: GeminiScoring;
  try {
    scoring = await runGeminiTextEvaluation(turns, {
      checklist: useChecklist,
      criteria,
      promptConfig,
      conversationId: `${opts.channel}:${opts.sourceId}`,
      llmPurpose: "feedback_eval",
    });
  } catch (error) {
    scoring = emptyScoring(error instanceof Error ? error.message : String(error));
  }
  // Reject incomplete/extra output before it can be persisted as review_not_needed.
  if (!scoring.error) validateChecklistCoverage(scoring.csChecklist, criteria?.map((c) => c.id) ?? []);

  let highRiskFlags: Evaluation["highRiskFlags"] = [];
  try {
    const rules = await listHighRiskFlagRules({ channel: opts.channel });
    highRiskFlags = matchMetricHighRiskFlags(rules, scoring.metrics);
    if (opts.threadCounts) {
      highRiskFlags = [...highRiskFlags, ...matchFeedbackHighRiskFlags(rules, opts.threadCounts)];
    }
  } catch (error) {
    console.warn("[textEvaluation] highRiskFlags:", error instanceof Error ? error.message : error);
  }

  const conversation = turns.map((turn) => ({
    ...turn,
    text: maskPII(turn.text),
  }));
  const schemaConfig = promptConfig.version.outputSchemaConfig;
  const evaluation: Evaluation = {
    scores: maskScores(scoring.scores),
    metrics: maskMetrics(scoring.metrics),
    overallSummary: maskSummary(scoring.overallSummary),
    outputSchemaSnapshot: snapshotOutputSchema(schemaConfig),
    silenceComments: [],
    csChecklist: scoring.csChecklist.map((criterion) => ({
      ...criterion,
      reason: maskPII(criterion.reason),
      evidence: criterion.evidence.map((evidence) => ({
        ...evidence,
        quote: maskPII(evidence.quote),
      })),
    })),
    transcript: [],
    conversation,
    highRiskFlags,
    error: scoring.error,
  };

  return {
    durationSec: relativeDuration(turns),
    threshold: { minSilenceSec: 0, noiseDb: 0 },
    silences: [],
    silenceSummary: { count: 0, totalSec: 0, longestSec: 0, silenceRatio: 0 },
    overlaps: [],
    evaluation,
    channel: opts.channel,
    sourceSystem: opts.sourceSystem,
    sourceId: opts.sourceId,
    promptConfig,
    llmCallId: scoring.llmCallId ?? null,
  };
}

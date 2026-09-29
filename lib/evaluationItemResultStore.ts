// 채널 공통 평가 결과(인앱 문의 등). 저장·조회는 서빙 Postgres(serving_eval_results)만 친다.
// BQ 결과 테이블로는 야간 덤프가 내보낸다.
import type { EvaluationChannel, EvaluationItemRef } from "./evaluationChannel";
import type { EvaluationResult } from "./types";
import { checklistFromEvalPayload } from "./humanResultDerive";
import type { ResultParseConfig } from "./promptTypes";
import { mapStoredPurpose } from "./evalItemKey";
import { saveEvalRun } from "./evalResultStore";
import { listServingLatestByItems } from "./servingEvalStore";

/** 전화 레거시 결과 테이블과 분리된 채널 공통 결과 행. */
export type EvaluationItemResultRow = {
  analysisId: string;
  analyzedAt: string;
  channel: EvaluationChannel;
  sourceSystem: string;
  sourceId: string;
  org: string | null;
  purpose: string;
  analyzedBy: string | null;
  model: string | null;
  promptVersionId: string | null;
  promptVersion: string | null;
  aiLabel: string;
  checklistJson: string;
  resultJson: string;
  transcriptJson: string;
  conversationJson: string;
  inputSnapshotJson: string;
  llmCallId: string | null;
  error: string | null;
};

function tsValue(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return String(value ?? "");
}

function channelOf(value: unknown): EvaluationChannel | null {
  return value === "phone" || value === "feedback" || value === "chatcs" ? value : null;
}

export function rowToEvaluationItemResult(row: Record<string, unknown>): EvaluationItemResultRow | null {
  const channel = channelOf(row.channel);
  const sourceSystem = String(row.source_system ?? "").trim();
  const sourceId = String(row.source_id ?? "").trim();
  if (!channel || !sourceSystem || !sourceId) return null;
  const turns = String(row.conversation_json ?? row.turns_json ?? "[]");
  return {
    analysisId: String(row.analysis_id ?? ""),
    analyzedAt: tsValue(row.analyzed_at),
    channel,
    sourceSystem,
    sourceId,
    org: row.org == null ? null : String(row.org),
    purpose: String(row.purpose ?? ""),
    analyzedBy: row.analyzed_by == null ? null : String(row.analyzed_by),
    model: row.model == null ? null : String(row.model),
    promptVersionId: row.prompt_version_id == null ? null : String(row.prompt_version_id),
    promptVersion: row.prompt_version == null ? null : String(row.prompt_version),
    aiLabel: String(row.ai_label ?? ""),
    checklistJson: String(row.checklist_json ?? "[]"),
    resultJson: String(row.result_json ?? "{}"),
    transcriptJson: String(row.transcript_json ?? turns),
    conversationJson: turns,
    inputSnapshotJson: String(row.input_snapshot_json ?? "{}"),
    llmCallId: row.llm_call_id == null ? null : String(row.llm_call_id),
    error: row.error == null ? null : String(row.error),
  };
}

export interface SaveEvaluationItemResultInput extends EvaluationItemRef {
  purpose: string;
  org?: string | null;
  analyzedBy?: string | null;
  model?: string | null;
  promptVersionId?: string | null;
  promptVersion?: string | null;
  llmCallId?: string | null;
  result: EvaluationResult;
  inputSnapshot?: unknown;
  parseConfig?: ResultParseConfig | null;
}

export async function saveEvaluationItemResult(
  input: SaveEvaluationItemResultInput,
): Promise<EvaluationItemResultRow> {
  const conversation = input.result.evaluation.conversation ?? [];
  const saved = await saveEvalRun({
    purpose: mapStoredPurpose(input.purpose),
    org: input.org,
    ref: { channel: input.channel, sourceSystem: input.sourceSystem, sourceId: input.sourceId },
    analyzedBy: input.analyzedBy,
    result: input.result,
    promptVersionId: input.promptVersionId,
    promptVersion: input.promptVersion,
    model: input.model,
    llmCallId: input.llmCallId,
    parseConfig: input.parseConfig,
    turnsJson: JSON.stringify(conversation.length ? conversation : (input.result.evaluation.transcript ?? [])),
    inputSnapshot: input.inputSnapshot ?? { turns: conversation },
  });
  return {
    analysisId: saved.analysisId,
    analyzedAt: saved.analyzedAt,
    channel: input.channel,
    sourceSystem: input.sourceSystem,
    sourceId: input.sourceId,
    org: saved.org,
    purpose: saved.purpose ?? mapStoredPurpose(input.purpose),
    analyzedBy: saved.analyzedBy,
    model: saved.model,
    promptVersionId: saved.promptVersionId,
    promptVersion: saved.promptVersion,
    aiLabel: saved.aiLabel,
    checklistJson: saved.checklistJson,
    resultJson: saved.resultJson,
    transcriptJson: saved.transcriptJson,
    conversationJson: saved.transcriptJson,
    inputSnapshotJson: JSON.stringify(input.inputSnapshot ?? { turns: conversation }),
    llmCallId: saved.llmCallId,
    error: saved.error,
  };
}

export async function getLatestEvaluationItemResult(
  ref: EvaluationItemRef,
): Promise<EvaluationItemResultRow | null> {
  const [raw] = await listServingLatestByItems([ref]);
  return raw ? rowToEvaluationItemResult(raw) : null;
}

export async function listLatestEvaluationItemResults(
  refs: EvaluationItemRef[],
): Promise<Map<string, EvaluationItemResultRow>> {
  const unique = [...new Map(refs.map((ref) => [`${ref.channel}:${ref.sourceSystem}:${ref.sourceId}`, ref])).values()];
  const out = new Map<string, EvaluationItemResultRow>();
  if (!unique.length) return out;
  for (const raw of await listServingLatestByItems(unique)) {
    const row = rowToEvaluationItemResult(raw);
    if (row) out.set(`${row.channel}:${row.sourceSystem}:${row.sourceId}`, row);
  }
  return out;
}

export async function parseStoredEvaluationItemResult(
  row: EvaluationItemResultRow,
): Promise<EvaluationResult | null> {
  try {
    const parsed = JSON.parse(row.resultJson) as Partial<EvaluationResult> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const checklist = checklistFromEvalPayload({
      checklistJson: row.checklistJson,
      resultJson: row.resultJson,
    });
    const evaluation = parsed.evaluation ?? {
      scores: {},
      overallSummary: "",
      silenceComments: [],
      transcript: [],
      csChecklist: checklist,
      error: row.error,
    };
    if (!evaluation.csChecklist?.length && checklist.length) {
      evaluation.csChecklist = checklist;
    }
    return {
      durationSec: parsed.durationSec ?? 0,
      threshold: parsed.threshold ?? { minSilenceSec: 0, noiseDb: 0 },
      silences: parsed.silences ?? [],
      silenceSummary: parsed.silenceSummary ?? { count: 0, totalSec: 0, longestSec: 0, silenceRatio: 0 },
      overlaps: parsed.overlaps ?? [],
      evaluation,
      conversationId: parsed.conversationId,
      analysisId: row.analysisId,
      promptConfig: parsed.promptConfig,
      channel: row.channel,
      sourceSystem: row.sourceSystem,
      sourceId: row.sourceId,
      sttSource: parsed.sttSource,
    };
  } catch {
    return null;
  }
}

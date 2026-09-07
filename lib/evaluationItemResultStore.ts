import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq, qradarTable } from "./bqRefs";
import type { EvaluationChannel, EvaluationItemRef } from "./evaluationChannel";
import type { EvaluationResult } from "./types";
import { checklistFromEvalPayload } from "./humanResultDerive";
import { deriveEvalLabel } from "./resultParse";
import { DEFAULT_RESULT_PARSE_CONFIG, type ResultParseConfig } from "./promptTypes";
import { flattenOverallSummary } from "./outputSchema";

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

const TABLE = qradarTable("evaluation_item_results");
const loc = () => (growthBq.location ? { location: growthBq.location } : {});
const tableRef = () =>
  getBQ().dataset(growthBq.dataset, { projectId: growthBq.projectId }).table(TABLE);
const sql = () => growthBq.resultsSql(TABLE);

const SCHEMA = [
  { name: "analysis_id", type: "STRING", mode: "REQUIRED" },
  { name: "analyzed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "channel", type: "STRING", mode: "REQUIRED" },
  { name: "source_system", type: "STRING", mode: "REQUIRED" },
  { name: "source_id", type: "STRING", mode: "REQUIRED" },
  { name: "org", type: "STRING", mode: "NULLABLE" },
  { name: "purpose", type: "STRING", mode: "REQUIRED" },
  { name: "analyzed_by", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version_id", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version", type: "STRING", mode: "NULLABLE" },
  { name: "ai_label", type: "STRING", mode: "NULLABLE" },
  { name: "checklist_json", type: "STRING", mode: "NULLABLE" },
  { name: "result_json", type: "STRING", mode: "REQUIRED" },
  { name: "transcript_json", type: "STRING", mode: "NULLABLE" },
  { name: "conversation_json", type: "STRING", mode: "NULLABLE" },
  { name: "input_snapshot_json", type: "STRING", mode: "NULLABLE" },
  { name: "llm_call_id", type: "STRING", mode: "NULLABLE" },
  { name: "error", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let ensured: Promise<void> | null = null;

export function ensureEvaluationItemResultsTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const table = tableRef();
      const [exists] = await table.exists();
      if (!exists) {
        await table.create({
          schema: SCHEMA as unknown as { name: string; type: string; mode: string }[],
        }).catch((e) => {
          if (!isAlreadyExists(e)) throw e;
        });
      }
    })().catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
}

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
    transcriptJson: String(row.transcript_json ?? "[]"),
    conversationJson: String(row.conversation_json ?? "[]"),
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
  await ensureEvaluationItemResultsTable();
  const analysisId = randomUUID();
  const analyzedAt = new Date().toISOString();
  const result = {
    ...input.result,
    channel: input.channel,
    sourceSystem: input.sourceSystem,
    sourceId: input.sourceId,
  };
  const checklist = checklistFromEvalPayload({ resultJson: JSON.stringify(result), checklistJson: "[]" });
  const aiLabel = deriveEvalLabel(
    { csChecklist: checklist },
    input.parseConfig ?? DEFAULT_RESULT_PARSE_CONFIG,
  );
  const conversation = result.evaluation.conversation ?? [];
  const row: EvaluationItemResultRow = {
    analysisId,
    analyzedAt,
    channel: input.channel,
    sourceSystem: input.sourceSystem,
    sourceId: input.sourceId,
    org: input.org?.trim() || null,
    purpose: input.purpose,
    analyzedBy: input.analyzedBy?.trim() || null,
    model: input.model?.trim() || process.env.GEMINI_MODEL || "gemini-2.5-flash",
    promptVersionId: input.promptVersionId?.trim() || null,
    promptVersion: input.promptVersion?.trim() || null,
    aiLabel,
    checklistJson: JSON.stringify(checklist),
    resultJson: JSON.stringify(result),
    transcriptJson: JSON.stringify(result.evaluation.transcript ?? []),
    conversationJson: JSON.stringify(conversation),
    inputSnapshotJson: JSON.stringify(input.inputSnapshot ?? { turns: conversation }),
    llmCallId: input.llmCallId?.trim() || null,
    error: result.evaluation.error ?? null,
  };

  await getBQ().query({
    query: `
      insert into ${sql()} (
        analysis_id, analyzed_at, channel, source_system, source_id, org, purpose,
        analyzed_by, model, prompt_version_id, prompt_version, ai_label, checklist_json,
        result_json, transcript_json, conversation_json, input_snapshot_json, llm_call_id, error
      ) values (
        @analysis_id, timestamp(@analyzed_at), @channel, @source_system, @source_id, @org, @purpose,
        @analyzed_by, @model, @prompt_version_id, @prompt_version, @ai_label, @checklist_json,
        @result_json, @transcript_json, @conversation_json, @input_snapshot_json, @llm_call_id, @error
      )
    `,
    params: {
      analysis_id: row.analysisId,
      analyzed_at: row.analyzedAt,
      channel: row.channel,
      source_system: row.sourceSystem,
      source_id: row.sourceId,
      org: row.org,
      purpose: row.purpose,
      analyzed_by: row.analyzedBy,
      model: row.model,
      prompt_version_id: row.promptVersionId,
      prompt_version: row.promptVersion,
      ai_label: row.aiLabel,
      checklist_json: row.checklistJson,
      result_json: row.resultJson,
      transcript_json: row.transcriptJson,
      conversation_json: row.conversationJson,
      input_snapshot_json: row.inputSnapshotJson,
      llm_call_id: row.llmCallId,
      error: row.error,
    },
    types: {
      analysis_id: "STRING",
      analyzed_at: "STRING",
      channel: "STRING",
      source_system: "STRING",
      source_id: "STRING",
      org: "STRING",
      purpose: "STRING",
      analyzed_by: "STRING",
      model: "STRING",
      prompt_version_id: "STRING",
      prompt_version: "STRING",
      ai_label: "STRING",
      checklist_json: "STRING",
      result_json: "STRING",
      transcript_json: "STRING",
      conversation_json: "STRING",
      input_snapshot_json: "STRING",
      llm_call_id: "STRING",
      error: "STRING",
    },
    ...loc(),
  });
  return row;
}

export async function getLatestEvaluationItemResult(
  ref: EvaluationItemRef,
): Promise<EvaluationItemResultRow | null> {
  await ensureEvaluationItemResultsTable();
  const [rows] = await getBQ().query({
    query: `
      select *
      from ${sql()}
      where channel = @channel and source_system = @source_system and source_id = @source_id
      order by analyzed_at desc
      limit 1
    `,
    params: ref,
    ...loc(),
  });
  return rowToEvaluationItemResult((rows as Record<string, unknown>[])[0] ?? {});
}

export async function listLatestEvaluationItemResults(
  refs: EvaluationItemRef[],
): Promise<Map<string, EvaluationItemResultRow>> {
  const unique = [...new Map(refs.map((ref) => [`${ref.channel}:${ref.sourceSystem}:${ref.sourceId}`, ref])).values()];
  const out = new Map<string, EvaluationItemResultRow>();
  if (!unique.length) return out;
  await ensureEvaluationItemResultsTable();
  const keys = unique.map((ref) => `${ref.channel}:${ref.sourceSystem}:${ref.sourceId}`);
  const [rows] = await getBQ().query({
    query: `
      select *
      from ${sql()}
      where concat(channel, ':', source_system, ':', source_id) in unnest(@keys)
      qualify row_number() over (
        partition by channel, source_system, source_id order by analyzed_at desc
      ) = 1
    `,
    params: { keys },
    ...loc(),
  });
  for (const raw of rows as Record<string, unknown>[]) {
    const row = rowToEvaluationItemResult(raw);
    if (row) out.set(`${row.channel}:${row.sourceSystem}:${row.sourceId}`, row);
  }
  return out;
}

export async function parseStoredEvaluationItemResult(
  row: EvaluationItemResultRow,
): Promise<EvaluationResult | null> {
  try {
    const result = JSON.parse(row.resultJson) as EvaluationResult;
    result.analysisId = row.analysisId;
    result.channel = row.channel;
    result.sourceSystem = row.sourceSystem;
    result.sourceId = row.sourceId;
    return result;
  } catch {
    return null;
  }
}

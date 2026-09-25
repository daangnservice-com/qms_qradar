import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import type { CallQualityOrg } from "./callQualityOrg";
import {
  isEvalItemKeyV2,
  itemIdCol,
  mapStoredPurpose,
  phoneIdEqSql,
  phoneIdInSql,
  phoneItemRef,
  phoneScopeParams,
  phoneScopeSql,
} from "./evalItemKey";
import { PHONE_SOURCE_SYSTEM, type EvaluationChannel, type EvaluationItemRef } from "./evaluationChannel";
import { EVAL_RESULTS_V2_SCHEMA } from "./evalSchemaV2";
import { listEvalReviews, listEvalReviewsByConversationIds } from "./evalReviewStore";
import {
  getLatestReviewCompletion,
  listLatestReviewCompletionsByConversationIds,
  listRecentCompletedConversationIds,
  listReviewCompletionsInPeriod,
  saveReviewCompletion,
} from "./evalReviewCompletionStore";
import {
  checklistFromEvalPayload,
  deriveHumanReviewNeededLabel,
  deriveHumanResultLabel,
  overlayLiveHumanResult,
} from "./humanResultDerive";
import {
  deriveEvalLabel,
  labelsMatch,
  normalizeHumanResult,
} from "./resultParse";
import { DEFAULT_RESULT_PARSE_CONFIG, type ResultParseConfig } from "./promptTypes";
import type { CallEvalVersionSummary } from "./callArtifactVersions";
import { parseSttSource, type ChecklistResult, type EvaluationResult, type SttSource, type TranscriptSegment } from "./types";
import { flattenOverallSummary } from "./outputSchema";
import { parseTranscriptJson } from "./sttReuse";
import { getPromptConfigByVersionId } from "./promptStore";
import {
  loadEvaluationCriterionResults,
  saveEvaluationCriterionResults,
} from "./evaluationDimensionStore";

export {
  checklistFromEvalPayload,
  deriveHumanResultLabel,
  deriveHumanReviewNeededLabel,
  deriveHumanReviewNeededIds,
  deriveHumanViolatedIds,
  overlayLiveHumanResult,
} from "./humanResultDerive";

/** 콜 단위 AI 평가 결과 목적 */
export type EvalResultPurpose = "call_eval" | "qa_eval";

export type EvalResultRow = {
  analysisId: string;
  analyzedAt: string;
  conversationId: string;
  channel: EvaluationChannel | null;
  sourceSystem: string | null;
  sourceId: string;
  phoneInquiryId: string | null;
  org: CallQualityOrg | null;
  purpose: EvalResultPurpose | null;
  analyzedBy: string | null;
  model: string | null;
  promptVersionId: string | null;
  promptVersion: string | null;
  humanResult: string;
  aiLabel: string;
  match: boolean | null;
  /** 수기 최종 Cold/Hot. 조회 시 파생. BQ 컬럼 없음. */
  humanFinalLabel?: string;
  checklistJson: string;
  resultJson: string;
  transcriptJson: string;
  llmCallId: string | null;
  audioKept: boolean | null;
  audioPath: string | null;
  error: string | null;
  reviewCompletedAt: string | null;
  reviewCompletedBy: string | null;
  sttSource: SttSource | null;
};

const TABLE = growthBq.resultsTable;
const loc = () => (growthBq.location ? { location: growthBq.location } : {});
const sql = () => growthBq.resultsSql(TABLE);
const tableRef = () =>
  getBQ().dataset(growthBq.dataset, { projectId: growthBq.projectId }).table(TABLE);

const SCHEMA = [
  { name: "analysis_id", type: "STRING", mode: "REQUIRED" },
  { name: "analyzed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "conversation_id", type: "STRING", mode: "REQUIRED" },
  { name: "phone_inquiry_id", type: "STRING", mode: "NULLABLE" },
  { name: "org", type: "STRING", mode: "NULLABLE" },
  { name: "purpose", type: "STRING", mode: "NULLABLE" },
  { name: "analyzed_by", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version_id", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version", type: "STRING", mode: "NULLABLE" },
  { name: "human_result", type: "STRING", mode: "NULLABLE" },
  { name: "ai_label", type: "STRING", mode: "NULLABLE" },
  { name: "match", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "checklist_json", type: "STRING", mode: "NULLABLE" },
  { name: "attitude_score", type: "INTEGER", mode: "NULLABLE" },
  { name: "attitude_comment", type: "STRING", mode: "NULLABLE" },
  { name: "resolution_score", type: "INTEGER", mode: "NULLABLE" },
  { name: "resolution_comment", type: "STRING", mode: "NULLABLE" },
  { name: "flow_score", type: "INTEGER", mode: "NULLABLE" },
  { name: "flow_comment", type: "STRING", mode: "NULLABLE" },
  { name: "overall_summary", type: "STRING", mode: "NULLABLE" },
  { name: "duration_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "silence_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "silence_total_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "silence_longest_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "silence_ratio", type: "FLOAT", mode: "NULLABLE" },
  { name: "min_silence_sec", type: "INTEGER", mode: "NULLABLE" },
  { name: "noise_db", type: "INTEGER", mode: "NULLABLE" },
  { name: "transcript_json", type: "STRING", mode: "NULLABLE" },
  { name: "result_json", type: "STRING", mode: "NULLABLE" },
  { name: "llm_call_id", type: "STRING", mode: "NULLABLE" },
  { name: "audio_kept", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "audio_path", type: "STRING", mode: "NULLABLE" },
  { name: "error", type: "STRING", mode: "NULLABLE" },
  { name: "review_completed_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "review_completed_by", type: "STRING", mode: "NULLABLE" },
  { name: "high_risk_flags_json", type: "STRING", mode: "NULLABLE" },
  { name: "stt_source", type: "STRING", mode: "NULLABLE" },
] as const;

const EXTRA_COLUMNS = [
  { name: "purpose", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version_id", type: "STRING", mode: "NULLABLE" },
  { name: "human_result", type: "STRING", mode: "NULLABLE" },
  { name: "ai_label", type: "STRING", mode: "NULLABLE" },
  { name: "match", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "checklist_json", type: "STRING", mode: "NULLABLE" },
  { name: "llm_call_id", type: "STRING", mode: "NULLABLE" },
  { name: "audio_kept", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "audio_path", type: "STRING", mode: "NULLABLE" },
  { name: "review_completed_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "review_completed_by", type: "STRING", mode: "NULLABLE" },
  { name: "high_risk_flags_json", type: "STRING", mode: "NULLABLE" },
  { name: "stt_source", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureEvalResultsTable(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const t = tableRef();
      const [exists] = await t.exists();
      if (!exists) {
        await t
          .create({
            schema: EVAL_RESULTS_V2_SCHEMA,
            timePartitioning: { type: "DAY", field: "analyzed_at" },
            clustering: { fields: ["channel", "source_id", "purpose"] },
          })
          .catch((e) => {
            if (!isAlreadyExists(e)) throw e;
          });
      } else if (!(await isEvalItemKeyV2())) {
        await addColumnsIfMissing(t, [...EXTRA_COLUMNS], {
          location: growthBq.location,
          logTag: "evalResultStore",
        });
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

async function phoneQuery() {
  const v2 = await isEvalItemKeyV2();
  return {
    v2,
    id: itemIdCol(v2),
    eq: (param = "cid") => phoneIdEqSql(v2, param),
    inn: (param = "ids") => phoneIdInSql(v2, param),
    params: phoneScopeParams(v2),
    partition: v2 ? "channel, source_system, source_id" : "conversation_id",
    transcript: v2 ? "turns_json" : "transcript_json",
    transcriptSelect: v2
      ? `analysis_id, analyzed_at,
         safe_cast(json_value(channel_attrs_json, '$.durationSec') as float64) as duration_sec,
         turns_json as transcript_json, result_json,
         json_value(channel_attrs_json, '$.sttSource') as stt_source`
      : `analysis_id, analyzed_at, duration_sec, transcript_json, result_json, stt_source`,
    nonEmptyTranscript: v2
      ? `turns_json is not null and turns_json != '' and turns_json != '[]'`
      : `transcript_json is not null and transcript_json != '' and transcript_json != '[]'`,
  };
}

function tsValue(updated: unknown): string {
  if (updated && typeof updated === "object" && "value" in (updated as object)) {
    return String((updated as { value: string }).value);
  }
  return String(updated ?? "");
}

export function rowToEvalResult(r: Record<string, unknown>): EvalResultRow {
  const purposeRaw = r.purpose != null ? String(r.purpose) : "";
  const purpose: EvalResultPurpose | null = !purposeRaw
    ? null
    : mapStoredPurpose(purposeRaw);
  const orgRaw = r.org != null ? String(r.org) : null;
  const org: CallQualityOrg | null = orgRaw === "pay" || orgRaw === "growth" ? orgRaw : null;
  const analysisId = String(r.analysis_id ?? r.qa_run_id ?? "");
  const sourceId = String(r.source_id ?? r.conversation_id ?? "");
  const channel: EvaluationChannel | null =
    r.channel === "phone" || r.channel === "feedback" || r.channel === "chatcs"
      ? r.channel
      : r.conversation_id
        ? "phone"
        : null;
  let attrs: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(r.channel_attrs_json ?? "{}")) as unknown;
    if (parsed && typeof parsed === "object") attrs = parsed as Record<string, unknown>;
  } catch {
    attrs = {};
  }
  const phoneInquiryId =
    r.phone_inquiry_id != null
      ? String(r.phone_inquiry_id)
      : attrs.phoneInquiryId != null
        ? String(attrs.phoneInquiryId)
        : null;
  return {
    analysisId,
    analyzedAt: tsValue(r.analyzed_at),
    conversationId: sourceId,
    channel,
    sourceSystem: r.source_system != null ? String(r.source_system) : channel === "phone" ? PHONE_SOURCE_SYSTEM : null,
    sourceId,
    phoneInquiryId,
    org,
    purpose,
    analyzedBy: r.analyzed_by != null ? String(r.analyzed_by) : null,
    model: r.model != null ? String(r.model) : null,
    promptVersionId: r.prompt_version_id != null ? String(r.prompt_version_id) : null,
    promptVersion: r.prompt_version != null ? String(r.prompt_version) : null,
    humanResult: String(r.human_result ?? ""),
    aiLabel: String(r.ai_label ?? ""),
    match: r.match == null ? null : Boolean(r.match),
    checklistJson: String(r.checklist_json ?? "[]"),
    resultJson: String(r.result_json ?? "{}"),
    transcriptJson: String(r.transcript_json ?? r.turns_json ?? "[]"),
    llmCallId: r.llm_call_id != null ? String(r.llm_call_id) : null,
    audioKept: r.audio_kept == null ? (attrs.audioKept == null ? null : Boolean(attrs.audioKept)) : Boolean(r.audio_kept),
    audioPath: r.audio_path != null ? String(r.audio_path) : attrs.audioPath != null ? String(attrs.audioPath) : null,
    error: r.error != null ? String(r.error) : null,
    reviewCompletedAt: r.review_completed_at != null ? tsValue(r.review_completed_at) : null,
    reviewCompletedBy: r.review_completed_by != null ? String(r.review_completed_by) : null,
    sttSource: parseSttSource(r.stt_source) ?? parseSttSource(attrs.sttSource),
  };
}

async function parseResult(row: EvalResultRow): Promise<EvaluationResult | null> {
  try {
    const result = JSON.parse(row.resultJson) as EvaluationResult;
    result.analysisId = row.analysisId;
    result.conversationId = row.conversationId;
    const normalizedChecklist = await loadEvaluationCriterionResults(row.analysisId);
    if (normalizedChecklist?.length) {
      result.evaluation.csChecklist = normalizedChecklist;
    }
    if (!result.promptConfig && row.promptVersionId) {
      const promptConfig = await getPromptConfigByVersionId(row.promptVersionId);
      if (promptConfig) result.promptConfig = promptConfig;
    }
    result.sttSource = parseSttSource(row.sttSource) ?? parseSttSource(result.sttSource);
    return result;
  } catch {
    return null;
  }
}

/** 저장 결과를 읽기 모델로 복원한다. 신규 정규화 행과 legacy JSON을 모두 지원한다. */
export async function parseStoredEvaluationResult(row: EvalResultRow): Promise<EvaluationResult | null> {
  return parseResult(row);
}

async function withLiveHumanResult(row: EvalResultRow): Promise<EvalResultRow> {
  if (row.purpose === "qa_eval") return row;
  let completedAt = row.reviewCompletedAt;
  let completedBy = row.reviewCompletedBy;
  try {
    const completion = await getLatestReviewCompletion(row.conversationId);
    if (completion) {
      completedAt = completion.completedAt;
      completedBy = completion.completedBy;
    }
  } catch (e) {
    console.warn("[evalResultStore] completion lookup:", e instanceof Error ? e.message : e);
  }
  const withMeta = {
    ...row,
    reviewCompletedAt: completedAt,
    reviewCompletedBy: completedBy,
  };
  if (!completedAt) return overlayLiveHumanResult(withMeta, []);
  try {
    const reviews = await listEvalReviews(row.conversationId);
    return overlayLiveHumanResult(withMeta, reviews);
  } catch (e) {
    console.warn("[evalResultStore] live human:", e instanceof Error ? e.message : e);
    return withMeta;
  }
}

async function withLiveHumanResults(rows: EvalResultRow[]): Promise<EvalResultRow[]> {
  if (!rows.length) return rows;
  const callRows = rows.filter((r) => r.purpose !== "qa_eval");
  let completions = new Map<string, { completedAt: string; completedBy: string }>();
  try {
    const m = await listLatestReviewCompletionsByConversationIds(callRows.map((r) => r.conversationId));
    completions = new Map(
      [...m.entries()].map(([id, c]) => [id, { completedAt: c.completedAt, completedBy: c.completedBy }]),
    );
  } catch (e) {
    console.warn("[evalResultStore] completion batch:", e instanceof Error ? e.message : e);
  }
  const merged = rows.map((r) => {
    if (r.purpose === "qa_eval") return r;
    const c = completions.get(r.conversationId);
    return {
      ...r,
      reviewCompletedAt: c?.completedAt ?? r.reviewCompletedAt,
      reviewCompletedBy: c?.completedBy ?? r.reviewCompletedBy,
    };
  });
  const need = merged.filter((r) => r.purpose !== "qa_eval" && r.reviewCompletedAt);
  if (!need.length) return merged.map((r) => (r.purpose === "qa_eval" ? r : overlayLiveHumanResult(r, [])));
  try {
    const reviewsByConv = await listEvalReviewsByConversationIds(need.map((r) => r.conversationId));
    return merged.map((r) => {
      if (r.purpose === "qa_eval") return r;
      if (!r.reviewCompletedAt) return overlayLiveHumanResult(r, []);
      return overlayLiveHumanResult(r, reviewsByConv.get(r.conversationId) ?? []);
    });
  } catch (e) {
    console.warn("[evalResultStore] live human batch:", e instanceof Error ? e.message : e);
    return merged;
  }
}

async function applyLiveHumanToFlags(
  out: Map<
    string,
    {
      reviewCompleted: boolean;
      highRiskFlagKeys: string[];
      aiLabel: string | null;
      humanResult: string | null;
    }
  >,
  checklistById: Map<string, string>,
): Promise<void> {
  if (!out.size) return;
  const completions = await listLatestReviewCompletionsByConversationIds([...out.keys()]).catch(
    () => new Map(),
  );
  for (const [id, flag] of out) {
    if (completions.has(id)) {
      out.set(id, { ...flag, reviewCompleted: true });
    }
  }
  const completed = [...out.entries()].filter(([, f]) => f.reviewCompleted).map(([id]) => id);
  const reviewsByConv = completed.length
    ? await listEvalReviewsByConversationIds(completed).catch(() => new Map())
    : new Map();
  for (const [id, flag] of out) {
    if (!flag.reviewCompleted) {
      out.set(id, { ...flag, humanResult: null });
      continue;
    }
    const live = overlayLiveHumanResult(
      {
        purpose: "call_eval",
        reviewCompletedAt: "1",
        humanResult: flag.humanResult ?? "",
        aiLabel: flag.aiLabel ?? "",
        match: null,
        checklistJson: checklistById.get(id) ?? "[]",
      },
      reviewsByConv.get(id) ?? [],
    );
    out.set(id, {
      ...flag,
      aiLabel: live.aiLabel.trim() || flag.aiLabel,
      humanResult: live.humanResult || null,
    });
  }
}

export type SaveEvalResultInput = {
  purpose: EvalResultPurpose;
  org: CallQualityOrg;
  conversationId: string;
  phoneInquiryId?: string | null;
  analyzedBy?: string | null;
  result: EvaluationResult;
  promptVersionId?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  llmCallId?: string | null;
  humanResult?: string | null;
  audioKept?: boolean | null;
  audioPath?: string | null;
  parseConfig?: ResultParseConfig | null;
};

export type SaveEvalRunInput = {
  purpose: EvalResultPurpose;
  org?: string | null;
  ref: EvaluationItemRef;
  analyzedBy?: string | null;
  result: EvaluationResult;
  promptVersionId?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  llmCallId?: string | null;
  parseConfig?: ResultParseConfig | null;
  channelAttrs?: Record<string, unknown>;
  turnsJson?: string;
  inputSnapshot?: unknown;
};

/** v2 통합 결과 테이블에 실행 1건 append. */
export async function saveEvalRun(input: SaveEvalRunInput): Promise<EvalResultRow> {
  await ensureEvalResultsTable();
  if (!(await isEvalItemKeyV2())) {
    throw new Error("saveEvalRun requires the v2 evaluation_results schema");
  }
  const checklist = (input.result.evaluation.csChecklist ?? []) as ChecklistResult[];
  const parseConfig = input.parseConfig ?? DEFAULT_RESULT_PARSE_CONFIG;
  const aiLabel = input.result.evaluation.error ? "" : deriveEvalLabel({ csChecklist: checklist }, parseConfig);
  const analysisId = randomUUID();
  const analyzedAt = new Date().toISOString();
  const e = input.result.evaluation;
  const r = input.result;
  const persistedResult = { ...r, channel: input.ref.channel, sourceSystem: input.ref.sourceSystem, sourceId: input.ref.sourceId };
  delete persistedResult.promptConfig;
  const turnsJson = input.turnsJson
    ?? JSON.stringify(e.conversation?.length ? e.conversation : (e.transcript ?? []));
  const orgRaw = input.org?.trim() || null;
  const org: CallQualityOrg | null = orgRaw === "pay" || orgRaw === "growth" ? orgRaw : null;

  await getBQ().query({
    query: `
      insert into ${sql()} (
        analysis_id, analyzed_at, channel, source_system, source_id, org, purpose,
        analyzed_by, model, prompt_version_id, prompt_version, ai_label,
        turns_json, input_snapshot_json, channel_attrs_json, result_json, llm_call_id, error
      ) values (
        @analysis_id, timestamp(@analyzed_at), @channel, @source_system, @source_id, @org, @purpose,
        @analyzed_by, @model, @prompt_version_id, @prompt_version, @ai_label,
        @turns_json, @input_snapshot_json, @channel_attrs_json, @result_json, @llm_call_id, @error
      )
    `,
    params: {
      analysis_id: analysisId,
      analyzed_at: analyzedAt,
      channel: input.ref.channel,
      source_system: input.ref.sourceSystem,
      source_id: input.ref.sourceId,
      org,
      purpose: mapStoredPurpose(input.purpose),
      analyzed_by: input.analyzedBy ?? null,
      model: input.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      prompt_version_id: input.promptVersionId ?? null,
      prompt_version: input.promptVersion ?? null,
      ai_label: aiLabel,
      turns_json: turnsJson,
      input_snapshot_json: JSON.stringify(input.inputSnapshot ?? {}),
      channel_attrs_json: JSON.stringify(input.channelAttrs ?? {}),
      result_json: JSON.stringify(persistedResult),
      llm_call_id: input.llmCallId ?? null,
      error: e.error ?? null,
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
      turns_json: "STRING",
      input_snapshot_json: "STRING",
      channel_attrs_json: "STRING",
      result_json: "STRING",
      llm_call_id: "STRING",
      error: "STRING",
    },
    ...loc(),
  });
  await saveEvaluationCriterionResults({
    analysisId,
    evalSetId: input.promptVersionId,
    checklist,
    createdAt: analyzedAt,
  }).catch((err) =>
    console.warn("[evalResultStore] normalized criterion results sync:", err instanceof Error ? err.message : err),
  );

  return {
    analysisId,
    analyzedAt,
    conversationId: input.ref.sourceId,
    channel: input.ref.channel,
    sourceSystem: input.ref.sourceSystem,
    sourceId: input.ref.sourceId,
    phoneInquiryId: input.channelAttrs?.phoneInquiryId != null ? String(input.channelAttrs.phoneInquiryId) : null,
    org,
    purpose: mapStoredPurpose(input.purpose),
    analyzedBy: input.analyzedBy ?? null,
    model: input.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    promptVersionId: input.promptVersionId ?? null,
    promptVersion: input.promptVersion ?? null,
    humanResult: "",
    aiLabel,
    match: null,
    checklistJson: JSON.stringify(checklist),
    resultJson: JSON.stringify(r),
    transcriptJson: turnsJson,
    llmCallId: input.llmCallId ?? null,
    audioKept: input.channelAttrs?.audioKept == null ? null : Boolean(input.channelAttrs.audioKept),
    audioPath: input.channelAttrs?.audioPath != null ? String(input.channelAttrs.audioPath) : null,
    error: e.error ?? null,
    reviewCompletedAt: null,
    reviewCompletedBy: null,
    sttSource: parseSttSource(r.sttSource) ?? parseSttSource(input.channelAttrs?.sttSource),
  };
}

/** AI 평가 결과 1건 append. analysis_id 반환. */
export async function saveEvalResult(input: SaveEvalResultInput): Promise<EvalResultRow> {
  await ensureEvalResultsTable();
  if (await isEvalItemKeyV2()) {
    const e = input.result.evaluation;
    return saveEvalRun({
      purpose: input.purpose,
      org: input.org,
      ref: phoneItemRef(input.conversationId),
      analyzedBy: input.analyzedBy,
      result: input.result,
      promptVersionId: input.promptVersionId,
      promptVersion: input.promptVersion,
      model: input.model,
      llmCallId: input.llmCallId,
      parseConfig: input.parseConfig,
      turnsJson: JSON.stringify(e.transcript ?? []),
      channelAttrs: {
        phoneInquiryId: input.phoneInquiryId ?? null,
        durationSec: input.result.durationSec,
        silenceCount: input.result.silenceSummary.count,
        silenceTotalSec: input.result.silenceSummary.totalSec,
        silenceLongestSec: input.result.silenceSummary.longestSec,
        silenceRatio: input.result.silenceSummary.silenceRatio,
        minSilenceSec: input.result.threshold.minSilenceSec,
        noiseDb: input.result.threshold.noiseDb,
        audioKept: input.audioKept ?? null,
        audioPath: input.audioPath ?? null,
        sttSource: parseSttSource(input.result.sttSource),
        highRiskFlags: e.highRiskFlags ?? [],
      },
    });
  }
  const checklist = (input.result.evaluation.csChecklist ?? []) as ChecklistResult[];
  const parseConfig = input.parseConfig ?? DEFAULT_RESULT_PARSE_CONFIG;
  const aiLabel = deriveEvalLabel({ csChecklist: checklist }, parseConfig);
  const human = normalizeHumanResult(input.humanResult ?? "");
  const match = human ? labelsMatch(human, aiLabel) : null;
  const analysisId = randomUUID();
  const analyzedAt = new Date().toISOString();
  const e = input.result.evaluation;
  const r = input.result;
  // 평가셋/기준 정의는 eval_set_criteria와 prompt dimension에서 복원한다.
  // 기존 result_json을 읽는 legacy 결과는 promptConfig가 남아 있을 수 있다.
  const persistedResult = { ...r };
  delete persistedResult.promptConfig;

  await getBQ().query({
    query: `
      insert into ${sql()} (
        analysis_id, analyzed_at, conversation_id, phone_inquiry_id, org, purpose, analyzed_by,
        model, prompt_version_id, prompt_version, human_result, ai_label, match, checklist_json,
        attitude_score, attitude_comment, resolution_score, resolution_comment,
        flow_score, flow_comment, overall_summary,
        duration_sec, silence_count, silence_total_sec, silence_longest_sec, silence_ratio,
        min_silence_sec, noise_db, transcript_json, result_json,
        llm_call_id, audio_kept, audio_path, error,
        review_completed_at, review_completed_by, high_risk_flags_json, stt_source
      ) values (
        @analysis_id, timestamp(@analyzed_at), @conversation_id, @phone_inquiry_id, @org, @purpose, @analyzed_by,
        @model, @prompt_version_id, @prompt_version, @human_result, @ai_label, @match, @checklist_json,
        @attitude_score, @attitude_comment, @resolution_score, @resolution_comment,
        @flow_score, @flow_comment, @overall_summary,
        @duration_sec, @silence_count, @silence_total_sec, @silence_longest_sec, @silence_ratio,
        @min_silence_sec, @noise_db, @transcript_json, @result_json,
        @llm_call_id, @audio_kept, @audio_path, @error,
        null, null, @high_risk_flags_json, @stt_source
      )
    `,
    params: {
      analysis_id: analysisId,
      analyzed_at: analyzedAt,
      conversation_id: input.conversationId,
      phone_inquiry_id: input.phoneInquiryId ?? null,
      org: input.org,
      purpose: input.purpose,
      analyzed_by: input.analyzedBy ?? null,
      model: input.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      prompt_version_id: input.promptVersionId ?? null,
      prompt_version: input.promptVersion ?? null,
      human_result: human || null,
      ai_label: aiLabel,
      match,
      checklist_json: JSON.stringify(checklist),
      attitude_score: e.scores?.attitude?.score ?? null,
      attitude_comment: e.scores?.attitude?.comment ?? null,
      resolution_score: e.scores?.resolution?.score ?? null,
      resolution_comment: e.scores?.resolution?.comment ?? null,
      flow_score: e.scores?.flow?.score ?? null,
      flow_comment: e.scores?.flow?.comment ?? null,
      overall_summary: flattenOverallSummary(e.overallSummary) || null,
      duration_sec: r.durationSec,
      silence_count: r.silenceSummary.count,
      silence_total_sec: r.silenceSummary.totalSec,
      silence_longest_sec: r.silenceSummary.longestSec,
      silence_ratio: r.silenceSummary.silenceRatio,
      min_silence_sec: r.threshold.minSilenceSec,
      noise_db: r.threshold.noiseDb,
      transcript_json: JSON.stringify(e.transcript ?? []),
      result_json: JSON.stringify(persistedResult),
      llm_call_id: input.llmCallId ?? null,
      audio_kept: input.audioKept ?? null,
      audio_path: input.audioPath ?? null,
      error: e.error ?? null,
      high_risk_flags_json: JSON.stringify(e.highRiskFlags ?? []),
      stt_source: parseSttSource(r.sttSource),
    },
    types: {
      analysis_id: "STRING",
      analyzed_at: "STRING",
      conversation_id: "STRING",
      phone_inquiry_id: "STRING",
      org: "STRING",
      purpose: "STRING",
      analyzed_by: "STRING",
      model: "STRING",
      prompt_version_id: "STRING",
      prompt_version: "STRING",
      human_result: "STRING",
      ai_label: "STRING",
      match: "BOOL",
      checklist_json: "STRING",
      attitude_score: "INT64",
      attitude_comment: "STRING",
      resolution_score: "INT64",
      resolution_comment: "STRING",
      flow_score: "INT64",
      flow_comment: "STRING",
      overall_summary: "STRING",
      duration_sec: "FLOAT64",
      silence_count: "INT64",
      silence_total_sec: "FLOAT64",
      silence_longest_sec: "FLOAT64",
      silence_ratio: "FLOAT64",
      min_silence_sec: "INT64",
      noise_db: "INT64",
      transcript_json: "STRING",
      result_json: "STRING",
      llm_call_id: "STRING",
      audio_kept: "BOOL",
      audio_path: "STRING",
      error: "STRING",
      high_risk_flags_json: "STRING",
      stt_source: "STRING",
    },
    ...loc(),
  });
  await saveEvaluationCriterionResults({
    analysisId,
    evalSetId: input.promptVersionId,
    checklist,
    createdAt: analyzedAt,
  }).catch((e) =>
    console.warn("[evalResultStore] normalized criterion results sync:", e instanceof Error ? e.message : e),
  );

  return {
    analysisId,
    analyzedAt,
    conversationId: input.conversationId,
    channel: "phone",
    sourceSystem: PHONE_SOURCE_SYSTEM,
    sourceId: input.conversationId,
    phoneInquiryId: input.phoneInquiryId ?? null,
    org: input.org,
    purpose: input.purpose,
    analyzedBy: input.analyzedBy ?? null,
    model: input.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    promptVersionId: input.promptVersionId ?? null,
    promptVersion: input.promptVersion ?? null,
    humanResult: human,
    aiLabel,
    match,
    checklistJson: JSON.stringify(checklist),
    resultJson: JSON.stringify(r),
    transcriptJson: JSON.stringify(e.transcript ?? []),
    llmCallId: input.llmCallId ?? null,
    audioKept: input.audioKept ?? null,
    audioPath: input.audioPath ?? null,
    error: e.error ?? null,
    reviewCompletedAt: null,
    reviewCompletedBy: null,
    sttSource: parseSttSource(r.sttSource),
  };
}

/** conversation 기준 최근 비어 있지 않은 STT transcript (org/purpose 무관 — STT 재활용용). */
export async function getLatestStoredTranscript(conversationId: string): Promise<{
  conversationId: string;
  analysisId: string;
  analyzedAt: string;
  durationSec: number;
  transcript: import("./types").TranscriptSegment[];
  sttSource: SttSource | null;
} | null> {
  await ensureEvalResultsTable();
  const cid = conversationId.trim();
  if (!cid) return null;
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select ${q.transcriptSelect}
        from ${sql()}
        where ${q.eq("cid")}
          and ${q.nonEmptyTranscript}
        order by analyzed_at desc
        limit 1
      `,
      params: { cid, ...q.params },
      ...loc(),
    });
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;
    let transcript = parseTranscriptJson(String(r.transcript_json ?? ""));
    let fromJson: EvaluationResult | null = null;
    if (!transcript.length) {
      try {
        fromJson = JSON.parse(String(r.result_json ?? "{}")) as EvaluationResult;
        transcript = fromJson.evaluation?.transcript ?? [];
      } catch {
        transcript = [];
      }
    }
    transcript = transcript.filter((t) => (t.text ?? "").trim().length > 0);
    if (!transcript.length) return null;
    if (!fromJson) {
      try {
        fromJson = JSON.parse(String(r.result_json ?? "{}")) as EvaluationResult;
      } catch {
        fromJson = null;
      }
    }
    return {
      conversationId: cid,
      analysisId: String(r.analysis_id ?? ""),
      analyzedAt: tsValue(r.analyzed_at),
      durationSec: Number(r.duration_sec ?? 0) || 0,
      transcript,
      sttSource: parseSttSource(r.stt_source) ?? parseSttSource(fromJson?.sttSource) ?? "gcp",
    };
  } catch (e) {
    console.warn("[evalResultStore] getLatestStoredTranscript:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type StoredTranscriptVersion = {
  conversationId: string;
  analysisId: string;
  analyzedAt: string;
  durationSec: number;
  transcript: TranscriptSegment[];
  sttSource: SttSource | null;
};

const STORED_TRANSCRIPT_VERSION_LIMIT = 50;

function transcriptFromEvalRow(r: Record<string, unknown>): {
  transcript: TranscriptSegment[];
  fromJson: EvaluationResult | null;
} {
  let transcript = parseTranscriptJson(String(r.transcript_json ?? ""));
  let fromJson: EvaluationResult | null = null;
  if (!transcript.length) {
    try {
      fromJson = JSON.parse(String(r.result_json ?? "{}")) as EvaluationResult;
      transcript = fromJson.evaluation?.transcript ?? [];
    } catch {
      transcript = [];
    }
  }
  transcript = transcript.filter((t) => (t.text ?? "").trim().length > 0);
  if (transcript.length && !fromJson) {
    try {
      fromJson = JSON.parse(String(r.result_json ?? "{}")) as EvaluationResult;
    } catch {
      fromJson = null;
    }
  }
  return { transcript, fromJson };
}

/** conversation의 비어 있지 않은 저장 전사들(최신순). STT 버전 목록용. */
export async function listStoredTranscriptVersions(conversationId: string): Promise<StoredTranscriptVersion[]> {
  await ensureEvalResultsTable();
  const cid = conversationId.trim();
  if (!cid) return [];
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select ${q.transcriptSelect}
        from ${sql()}
        where ${q.eq("cid")}
          and ${q.nonEmptyTranscript}
        order by analyzed_at desc
        limit @limit
      `,
      params: { cid, limit: STORED_TRANSCRIPT_VERSION_LIMIT, ...q.params },
      ...loc(),
    });
    const out: StoredTranscriptVersion[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      const { transcript, fromJson } = transcriptFromEvalRow(r);
      if (!transcript.length) continue;
      out.push({
        conversationId: cid,
        analysisId: String(r.analysis_id ?? ""),
        analyzedAt: tsValue(r.analyzed_at),
        durationSec: Number(r.duration_sec ?? 0) || 0,
        transcript,
        sttSource: parseSttSource(r.stt_source) ?? parseSttSource(fromJson?.sttSource) ?? "gcp",
      });
    }
    return out;
  } catch (e) {
    console.warn("[evalResultStore] listStoredTranscriptVersions:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function getStoredTranscriptByAnalysisId(analysisId: string): Promise<StoredTranscriptVersion | null> {
  const id = analysisId.trim();
  if (!id) return null;
  await ensureEvalResultsTable();
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select ${q.id} as conversation_id, ${q.transcriptSelect}
        from ${sql()}
        where analysis_id = @id
        limit 1
      `,
      params: { id },
      ...loc(),
    });
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;
    const { transcript, fromJson } = transcriptFromEvalRow(r);
    if (!transcript.length) return null;
    return {
      conversationId: String(r.conversation_id ?? ""),
      analysisId: String(r.analysis_id ?? id),
      analyzedAt: tsValue(r.analyzed_at),
      durationSec: Number(r.duration_sec ?? 0) || 0,
      transcript,
      sttSource: parseSttSource(r.stt_source) ?? parseSttSource(fromJson?.sttSource) ?? "gcp",
    };
  } catch (e) {
    console.warn("[evalResultStore] getStoredTranscriptByAnalysisId:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type SttPresenceInfo = { hasStt: boolean; sttSource: SttSource | null };

/** conversation별 최신 비어 있지 않은 STT transcript 존재 여부(org 무관). */
export async function listStoredSttPresenceByConversationIds(
  conversationIds: string[],
): Promise<Map<string, SttPresenceInfo>> {
  const ids = [...new Set(conversationIds.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, SttPresenceInfo>();
  if (!ids.length) return out;
  await ensureEvalResultsTable();
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select ${q.id} as conversation_id, ${q.transcript} as transcript_json, result_json,
               ${q.v2 ? "json_value(channel_attrs_json, '$.sttSource')" : "stt_source"} as stt_source
        from ${sql()}
        where ${q.inn("ids")}
          and ${q.nonEmptyTranscript}
        qualify row_number() over (partition by ${q.partition} order by analyzed_at desc) = 1
      `,
      params: { ids, ...q.params },
      ...loc(),
    });
    for (const r of rows as Record<string, unknown>[]) {
      const id = String(r.conversation_id ?? "").trim();
      if (!id) continue;
      let transcript = parseTranscriptJson(String(r.transcript_json ?? ""));
      if (!transcript.length) {
        try {
          const fromJson = JSON.parse(String(r.result_json ?? "{}")) as EvaluationResult;
          transcript = fromJson.evaluation?.transcript ?? [];
        } catch {
          transcript = [];
        }
      }
      transcript = transcript.filter((t) => (t.text ?? "").trim().length > 0);
      if (!transcript.length) continue;
      out.set(id, {
        hasStt: true,
        sttSource: parseSttSource(r.stt_source) ?? "gcp",
      });
    }
  } catch (e) {
    console.warn("[evalResultStore] listStoredSttPresence:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** STT가 저장된 최근 conversation_id (org 무관, 배치·평가 저장분). */
export async function listRecentConversationIdsWithStoredStt(limit = 100): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  await ensureEvalResultsTable();
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select ${q.id} as conversation_id
        from ${sql()}
        where ${phoneScopeSql(q.v2)} and ${q.id} is not null and ${q.id} != ''
          and ${q.nonEmptyTranscript}
        qualify row_number() over (partition by ${q.partition} order by analyzed_at desc) = 1
        order by analyzed_at desc
        limit @limit
      `,
      params: { limit: lim, ...q.params },
      ...loc(),
    });
    return (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
  } catch (e) {
    console.warn("[evalResultStore] listRecentConversationIdsWithStoredStt:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** conversation 최신 1건 (org 지정 시 해당 org만) */
export async function getLatestEvalResult(opts: {
  conversationId: string;
  org?: CallQualityOrg | null;
  purpose?: EvalResultPurpose | null;
}): Promise<EvalResultRow | null> {
  await ensureEvalResultsTable();
  const cid = opts.conversationId.trim();
  if (!cid) return null;
  const q = await phoneQuery();
  const clauses = [q.eq("cid")];
  const params: Record<string, string> = { cid, ...q.params };
  if (opts.org) {
    clauses.push("org = @org");
    params.org = opts.org;
  }
  if (opts.purpose) {
    clauses.push("purpose = @purpose");
    params.purpose = opts.purpose;
  }
  try {
    const [rows] = await getBQ().query({
      query: `
        select * from ${sql()}
        where ${clauses.join(" and ")}
        order by analyzed_at desc
        limit 1
      `,
      params,
      ...loc(),
    });
    const r = (rows as Record<string, unknown>[])[0];
    return r ? withLiveHumanResult(rowToEvalResult(r)) : null;
  } catch (e) {
    console.warn("[evalResultStore] getLatest:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getLatestEvaluationResult(
  org: CallQualityOrg,
  conversationId: string,
): Promise<EvaluationResult | null> {
  const row = await getLatestEvalResult({ conversationId, org });
  return row ? await parseResult(row) : null;
}

const EVAL_VERSION_LIMIT = 50;

/** conversation의 AI 평가 버전 메타(최신순). 본문 JSON은 안 읽는다. */
export async function listEvalResultSummaries(opts: {
  conversationId: string;
  org?: CallQualityOrg | null;
}): Promise<CallEvalVersionSummary[]> {
  await ensureEvalResultsTable();
  const cid = opts.conversationId.trim();
  if (!cid) return [];
  const q = await phoneQuery();
  const clauses = [q.eq("cid")];
  const params: Record<string, string | number> = { cid, limit: EVAL_VERSION_LIMIT, ...q.params };
  if (opts.org) {
    clauses.push("org = @org");
    params.org = opts.org;
  }
  clauses.push("(purpose is null or purpose != 'qa_eval')");
  try {
    const [rows] = await getBQ().query({
      query: `
        select analysis_id, analyzed_at, prompt_version, prompt_version_id, ai_label, analyzed_by, purpose
        from ${sql()}
        where ${clauses.join(" and ")}
        order by analyzed_at desc
        limit @limit
      `,
      params,
      ...loc(),
    });
    return (rows as Record<string, unknown>[]).map((r) => {
      const purposeRaw = r.purpose != null ? String(r.purpose) : null;
      return {
        analysisId: String(r.analysis_id ?? ""),
        analyzedAt: tsValue(r.analyzed_at),
        promptVersion: r.prompt_version != null ? String(r.prompt_version) : null,
        promptVersionId: r.prompt_version_id != null ? String(r.prompt_version_id) : null,
        aiLabel: String(r.ai_label ?? "").trim() || null,
        analyzedBy: r.analyzed_by != null ? String(r.analyzed_by) : null,
        purpose: purposeRaw,
      };
    }).filter((r) => r.analysisId);
  } catch (e) {
    console.warn("[evalResultStore] listEvalResultSummaries:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function getEvalResultByAnalysisId(analysisId: string): Promise<{
  row: EvalResultRow;
  result: EvaluationResult;
} | null> {
  const id = analysisId.trim();
  if (!id) return null;
  await ensureEvalResultsTable();
  try {
    const [rows] = await getBQ().query({
      query: `select * from ${sql()} where analysis_id = @id limit 1`,
      params: { id },
      ...loc(),
    });
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;
    const row = await withLiveHumanResult(rowToEvalResult(r));
    const result = await parseResult(row);
    if (!result) return null;
    return { row, result };
  } catch (e) {
    console.warn("[evalResultStore] getById:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function listAnalyzedConversationIds(
  org: CallQualityOrg,
  conversationIds: string[],
): Promise<string[]> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (!ids.length) return [];
  await ensureEvalResultsTable();
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select distinct ${q.id} as conversation_id
        from ${sql()}
        where org = @org and ${q.inn("ids")}
      `,
      params: { org, ids, ...q.params },
      ...loc(),
    });
    return (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
  } catch (e) {
    console.error("[evalResultStore] listAnalyzed:", e);
    return [];
  }
}

export async function listRecentAnalyzedConversationIds(org: CallQualityOrg, limit = 100): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  await ensureEvalResultsTable();
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select ${q.id} as conversation_id
        from ${sql()}
        where org = @org and ${q.id} is not null and ${q.id} != ''
        qualify row_number() over (partition by ${q.partition} order by analyzed_at desc) = 1
        order by analyzed_at desc
        limit @limit
      `,
      params: { org, limit: lim, ...q.params },
      ...loc(),
    });
    return (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
  } catch (e) {
    console.error("[evalResultStore] listRecent:", e);
    return [];
  }
}

function highRiskKeysFromRow(r: Record<string, unknown>): string[] {
  const fromCol = r.high_risk_flags_json;
  const raw = fromCol != null && String(fromCol) !== ""
    ? String(fromCol)
    : (() => {
        try {
          const attrs = JSON.parse(String(r.channel_attrs_json ?? "{}")) as { highRiskFlags?: unknown };
          return JSON.stringify(attrs.highRiskFlags ?? []);
        } catch {
          return "[]";
        }
      })();
  try {
    const parsed = JSON.parse(raw) as Array<{ key?: string }>;
    if (Array.isArray(parsed)) return parsed.map((h) => String(h.key ?? "")).filter(Boolean);
  } catch {
    /* ignore */
  }
  return [];
}

/** conversation별 최신 결과의 수기 검수 완료 여부 + 고위험 플래그 키 + Hot/Cold 라벨 */
export async function listEvalFlagsByConversationIds(
  org: CallQualityOrg,
  conversationIds: string[],
  opts?: { liveHuman?: boolean },
): Promise<
  Map<
    string,
    {
      reviewCompleted: boolean;
      highRiskFlagKeys: string[];
      aiLabel: string | null;
      humanResult: string | null;
    }
  >
> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<
    string,
    {
      reviewCompleted: boolean;
      highRiskFlagKeys: string[];
      aiLabel: string | null;
      humanResult: string | null;
    }
  >();
  if (!ids.length) return out;
  await ensureEvalResultsTable();
  const liveHuman = opts?.liveHuman !== false;
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: q.v2
        ? `
        select ${q.id} as conversation_id, ai_label, result_json, channel_attrs_json
        from ${sql()}
        where org = @org and ${q.inn("ids")}
        qualify row_number() over (partition by ${q.partition} order by analyzed_at desc) = 1
      `
        : `
        select conversation_id, review_completed_at, high_risk_flags_json, ai_label, human_result, checklist_json
        from ${sql()}
        where org = @org and conversation_id in unnest(@ids)
        qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
      `,
      params: { org, ids, ...q.params },
      ...loc(),
    });
    const checklistById = new Map<string, string>();
    for (const r of rows as Record<string, unknown>[]) {
      const id = String(r.conversation_id ?? "");
      if (!id) continue;
      const checklistJson = r.checklist_json != null && String(r.checklist_json) !== ""
        ? String(r.checklist_json)
        : JSON.stringify(checklistFromEvalPayload({
            checklistJson: "[]",
            resultJson: String(r.result_json ?? "{}"),
          }));
      checklistById.set(id, checklistJson);
      out.set(id, {
        reviewCompleted: r.review_completed_at != null,
        highRiskFlagKeys: highRiskKeysFromRow(r),
        aiLabel: String(r.ai_label ?? "").trim() || null,
        humanResult: String(r.human_result ?? "").trim() || null,
      });
    }
    if (liveHuman) {
      await applyLiveHumanToFlags(out, checklistById);
    }
  } catch (e) {
    if (q.v2) {
      console.error("[evalResultStore] listEvalFlags:", e);
      return out;
    }
    // high_risk_flags_json / 라벨 컬럼 미존재 시 폴백
    try {
      const [rows] = await getBQ().query({
        query: `
          select conversation_id, review_completed_at, ai_label, human_result
          from ${sql()}
          where org = @org and conversation_id in unnest(@ids)
          qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
        `,
        params: { org, ids },
        ...loc(),
      });
      for (const r of rows as Record<string, unknown>[]) {
        const id = String(r.conversation_id ?? "");
        if (!id) continue;
        out.set(id, {
          reviewCompleted: r.review_completed_at != null,
          highRiskFlagKeys: [],
          aiLabel: String(r.ai_label ?? "").trim() || null,
          humanResult: String(r.human_result ?? "").trim() || null,
        });
      }
    } catch (e2) {
      try {
        const [rows] = await getBQ().query({
          query: `
            select conversation_id, review_completed_at
            from ${sql()}
            where org = @org and conversation_id in unnest(@ids)
            qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
          `,
          params: { org, ids },
          ...loc(),
        });
        for (const r of rows as Record<string, unknown>[]) {
          const id = String(r.conversation_id ?? "");
          if (!id) continue;
          out.set(id, {
            reviewCompleted: r.review_completed_at != null,
            highRiskFlagKeys: [],
            aiLabel: null,
            humanResult: null,
          });
        }
      } catch (e3) {
        console.error("[evalResultStore] listEvalFlags:", e3);
      }
    }
    console.warn("[evalResultStore] listEvalFlags high_risk:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** 최신 결과 기준 수기 검수 완료/미완료 conversation id */
export async function listRecentConversationIdsByReview(
  org: CallQualityOrg,
  opts: { reviewCompleted: boolean; limit?: number },
): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 100) || 100, 1), 500);
  const q = await phoneQuery();
  if (opts.reviewCompleted) {
    const fromNew = await listRecentCompletedConversationIds({ org, limit: lim });
    if (fromNew.length >= lim || q.v2) return fromNew.slice(0, lim);
    // 레거시: 결과 행에 review_completed_at 이 찍힌 케이스
    await ensureEvalResultsTable();
    try {
      const [rows] = await getBQ().query({
        query: `
          select conversation_id
          from (
            select conversation_id, review_completed_at, analyzed_at
            from ${sql()}
            where org = @org and conversation_id is not null and conversation_id != ''
              and review_completed_at is not null
            qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
          )
          order by review_completed_at desc
          limit @limit
        `,
        params: { org, limit: lim },
        ...loc(),
      });
      const legacy = (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
      const seen = new Set(fromNew);
      const merged = [...fromNew];
      for (const id of legacy) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
        if (merged.length >= lim) break;
      }
      return merged;
    } catch (e) {
      console.error("[evalResultStore] listByReview legacy:", e);
      return fromNew;
    }
  }

  await ensureEvalResultsTable();
  if (q.v2) {
    const candidates = await listRecentAnalyzedConversationIds(org, Math.min(lim * 3, 1500));
    if (!candidates.length) return [];
    const completions = await listLatestReviewCompletionsByConversationIds(candidates);
    return candidates.filter((id) => !completions.has(id)).slice(0, lim);
  }
  try {
    const [rows] = await getBQ().query({
      query: `
        select conversation_id
        from (
          select conversation_id, review_completed_at, analyzed_at
          from ${sql()}
          where org = @org and conversation_id is not null and conversation_id != ''
          qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
        )
        where review_completed_at is null
        order by analyzed_at desc
        limit @limit
      `,
      params: { org, limit: Math.min(lim * 3, 1500) },
      ...loc(),
    });
    const candidates = (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
    if (!candidates.length) return [];
    const completions = await listLatestReviewCompletionsByConversationIds(candidates);
    return candidates.filter((id) => !completions.has(id)).slice(0, lim);
  } catch (e) {
    console.error("[evalResultStore] listByReview:", e);
    return [];
  }
}

/** purpose=qa_eval 기준 conversation별 최신 */
export async function listLatestQaEvalResults(opts?: {
  promptVersionId?: string | null;
}): Promise<Map<string, EvalResultRow>> {
  await ensureEvalResultsTable();
  const versionId = (opts?.promptVersionId ?? "").trim() || null;
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: versionId
        ? `
        select *
        from ${sql()}
        where purpose = 'qa_eval' and prompt_version_id = @prompt_version_id
        qualify row_number() over (partition by ${q.partition} order by analyzed_at desc) = 1
      `
        : `
        select *
        from ${sql()}
        where purpose = 'qa_eval'
        qualify row_number() over (partition by ${q.partition} order by analyzed_at desc) = 1
      `,
      ...(versionId ? { params: { prompt_version_id: versionId } } : {}),
      ...loc(),
    });
    const m = new Map<string, EvalResultRow>();
    for (const r of rows as Record<string, unknown>[]) {
      const row = rowToEvalResult(r);
      if (row.conversationId) m.set(row.conversationId, row);
    }
    return m;
  } catch (e) {
    console.warn("[evalResultStore] listLatestQa:", e instanceof Error ? e.message : e);
    return new Map();
  }
}

export async function listUsedQaPromptVersions(): Promise<Array<{ versionId: string; resultCount: number }>> {
  await ensureEvalResultsTable();
  const q = await phoneQuery();
  try {
    const [rows] = await getBQ().query({
      query: `
        select prompt_version_id as version_id,
               count(distinct ${q.id}) as result_count
        from ${sql()}
        where purpose = 'qa_eval'
          and prompt_version_id is not null and prompt_version_id != ''
        group by prompt_version_id
        order by result_count desc
      `,
      ...loc(),
    });
    return (rows as Record<string, unknown>[]).map((r) => ({
      versionId: String(r.version_id),
      resultCount: Number(r.result_count) || 0,
    }));
  } catch (e) {
    console.warn("[evalResultStore] listUsedVersions:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 검수 완료: 얇은 완료 이벤트만 append.
 * 결과 JSON을 복사하지 않는다. human_result 는 조회 시 현재 검수로 파생.
 * 예전에는 결과 행을 복제하며 review_completed_* 를 채웠고, 그 레거시 행은 조회 시 폴백으로 인식한다.
 */
export async function markReviewComplete(input: {
  conversationId: string;
  org: CallQualityOrg;
  completedBy: string;
}): Promise<EvalResultRow> {
  const latest = await getLatestEvalResult({
    conversationId: input.conversationId,
    org: input.org,
  });
  if (!latest) throw new Error("저장된 AI 평가 결과가 없습니다");

  // getLatestEvalResult 가 이미 completion overlay 를 적용했을 수 있어, AI 원본 메타로 다시 읽지 않고
  // analysisId 는 최신 결과 행 기준.
  const completion = await saveReviewCompletion({
    conversationId: input.conversationId,
    completedBy: input.completedBy,
    analysisId: latest.analysisId,
    org: input.org,
  });

  const reviews = await listEvalReviews(input.conversationId);
  const checklist = checklistFromEvalPayload(latest);
  const humanResult = deriveHumanReviewNeededLabel(checklist, reviews);
  const humanFinalLabel = deriveHumanResultLabel(checklist, reviews);
  const aiLabel = latest.aiLabel || deriveEvalLabel({ csChecklist: checklist }, DEFAULT_RESULT_PARSE_CONFIG);
  const match = labelsMatch(humanResult, aiLabel);

  return {
    ...latest,
    humanResult,
    humanFinalLabel,
    aiLabel,
    match,
    reviewCompletedAt: completion.completedAt,
    reviewCompletedBy: completion.completedBy,
  };
}

/**
 * 수기 검수 완료된 call_eval 결과 (conversation별 최신 1건).
 * 완료 시각은 eval_review_completions 우선, 없으면 레거시 review_completed_at.
 */
export async function listReviewedCallEvalResults(opts: {
  org?: CallQualityOrg | null;
  startIso: string;
  endIso: string;
  limit?: number;
}): Promise<EvalResultRow[]> {
  await ensureEvalResultsTable();
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 2000) || 2000, 1), 5000);
  const org = opts.org ?? null;

  const completions = await listReviewCompletionsInPeriod({
    startIso: opts.startIso,
    endIso: opts.endIso,
    org,
    limit: lim,
  });
  const completionById = new Map(completions.map((c) => [c.conversationId, c]));
  const q = await phoneQuery();

  // 레거시 완료 행 (결과 테이블에 review_completed_at)
  let legacyIds: string[] = [];
  if (!q.v2) {
    try {
      const [rows] = await getBQ().query({
        query: `
          select conversation_id
          from (
            select conversation_id, review_completed_at
            from ${sql()}
            where purpose = 'call_eval'
              and review_completed_at is not null
              and review_completed_at >= timestamp(@start_iso)
              and review_completed_at < timestamp(@end_iso)
              ${org ? "and org = @org" : ""}
            qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
          )
          order by review_completed_at desc
          limit @limit
        `,
        params: {
          start_iso: opts.startIso,
          end_iso: opts.endIso,
          limit: lim,
          ...(org ? { org } : {}),
        },
        ...loc(),
      });
      legacyIds = (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
    } catch (e) {
      console.warn("[evalResultStore] listReviewed legacy:", e instanceof Error ? e.message : e);
    }
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const c of completions) {
    if (seen.has(c.conversationId)) continue;
    seen.add(c.conversationId);
    ids.push(c.conversationId);
    if (ids.length >= lim) break;
  }
  for (const id of legacyIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= lim) break;
  }
  if (!ids.length) return [];

  try {
    const [rows] = await getBQ().query({
      query: `
        select *
        from ${sql()}
        where purpose = 'call_eval'
          and ${q.inn("ids")}
          ${org ? "and org = @org" : ""}
        qualify row_number() over (partition by ${q.partition} order by analyzed_at desc) = 1
      `,
      params: { ids, ...q.params, ...(org ? { org } : {}) },
      ...loc(),
    });
    const mapped = (rows as Record<string, unknown>[]).map((r) => {
      const row = rowToEvalResult(r);
      const c = completionById.get(row.conversationId);
      if (c) {
        return {
          ...row,
          reviewCompletedAt: c.completedAt,
          reviewCompletedBy: c.completedBy,
        };
      }
      return row;
    });
    const live = await withLiveHumanResults(mapped);
    live.sort((a, b) => {
      const ta = a.reviewCompletedAt ?? "";
      const tb = b.reviewCompletedAt ?? "";
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
    return live;
  } catch (e) {
    console.error("[evalResultStore] listReviewed:", e);
    return [];
  }
}


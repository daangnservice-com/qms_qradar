import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import type { CallQualityOrg } from "./callQualityOrg";
import { isEvalItemKeyV2, mapStoredPurpose, phoneItemRef } from "./evalItemKey";
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
import { servingQuery } from "./servingDb";
import {
  findLatestServingEval,
  findServingEvalByAnalysisId,
  insertServingEvalResult,
  listServingAnalyzedIds,
  listServingEvalSummaries,
  listServingLatestRows,
  listServingPromptVersionCounts,
  listServingRecentAnalyzedIds,
  listServingTranscriptRows,
} from "./servingEvalStore";
import { patchCallApp } from "./callServingStore";
import { parseTranscriptJson } from "./sttReuse";
import { getPromptConfigByVersionId } from "./promptStore";
import { loadEvaluationCriterionResults } from "./evaluationDimensionStore";

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
    const normalizedChecklist = result.evaluation?.csChecklist?.length
      ? null
      : await loadEvaluationCriterionResults(row.analysisId);
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
  const checklist = (input.result.evaluation.csChecklist ?? []) as ChecklistResult[];
  const parseConfig = input.parseConfig ?? DEFAULT_RESULT_PARSE_CONFIG;
  const aiLabel = input.result.evaluation.error ? "" : deriveEvalLabel({ csChecklist: checklist }, parseConfig);
  const analysisId = randomUUID();
  const analyzedAt = new Date().toISOString();
  const e = input.result.evaluation;
  const r = input.result;
  const persistedResult = { ...r, channel: input.ref.channel, sourceSystem: input.ref.sourceSystem, sourceId: input.ref.sourceId };
  const turnsJson = input.turnsJson
    ?? JSON.stringify(e.conversation?.length ? e.conversation : (e.transcript ?? []));
  const orgRaw = input.org?.trim() || null;
  const org: CallQualityOrg | null = orgRaw === "pay" || orgRaw === "growth" ? orgRaw : null;
  const sttSource = parseSttSource(r.sttSource) ?? parseSttSource(input.channelAttrs?.sttSource);
  const flagKeys = (e.highRiskFlags ?? []).map((f) => f.key).filter(Boolean);
  let transcript: TranscriptSegment[] = [];
  try {
    transcript = JSON.parse(turnsJson) as TranscriptSegment[];
  } catch {
    transcript = [];
  }
  const hasStt = transcript.some((t) => (t.text ?? "").trim().length > 0);

  await insertServingEvalResult({
    record: {
      analysis_id: analysisId,
      analyzed_at: analyzedAt,
      conversation_id: input.ref.sourceId,
      channel: input.ref.channel,
      source_system: input.ref.sourceSystem,
      source_id: input.ref.sourceId,
      phone_inquiry_id: input.channelAttrs?.phoneInquiryId ?? null,
      org,
      purpose: mapStoredPurpose(input.purpose),
      analyzed_by: input.analyzedBy ?? null,
      model: input.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      prompt_version_id: input.promptVersionId ?? null,
      prompt_version: input.promptVersion ?? null,
      ai_label: aiLabel,
      turns_json: turnsJson,
      transcript_json: turnsJson,
      input_snapshot_json: JSON.stringify(input.inputSnapshot ?? {}),
      channel_attrs_json: JSON.stringify(input.channelAttrs ?? {}),
      result_json: JSON.stringify(persistedResult),
      llm_call_id: input.llmCallId ?? null,
      error: e.error ?? null,
      stt_source: sttSource,
      duration_sec: input.channelAttrs?.durationSec ?? r.durationSec ?? null,
    },
    flagKeys,
    hasStt,
    phoneInquiryId: input.channelAttrs?.phoneInquiryId != null ? String(input.channelAttrs.phoneInquiryId) : null,
  });

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

/** conversation 기준 최근 비어 있지 않은 STT transcript (org/purpose 무관 — STT 재활용용). */
export async function getLatestStoredTranscript(conversationId: string): Promise<{
  conversationId: string;
  analysisId: string;
  analyzedAt: string;
  durationSec: number;
  transcript: import("./types").TranscriptSegment[];
  sttSource: SttSource | null;
} | null> {
  const cid = conversationId.trim();
  if (!cid) return null;
  try {
    const r = (await listServingTranscriptRows(cid, 1))[0];
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
  const cid = conversationId.trim();
  if (!cid) return [];
  try {
    const rows = await listServingTranscriptRows(cid, STORED_TRANSCRIPT_VERSION_LIMIT);
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
  try {
    const r = await findServingEvalByAnalysisId(id);
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
  try {
    const rows = await servingQuery<{ conversation_id: string; has_stt: boolean; stt_source: string | null }>(
      `select conversation_id, has_stt, stt_source from call_serving where conversation_id = any($1::text[]) and has_stt`,
      [ids],
    );
    for (const r of rows) {
      out.set(r.conversation_id, {
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
  try {
    const rows = await servingQuery<{ conversation_id: string }>(
      `
      select conversation_id from call_serving
      where has_stt
      order by updated_at desc
      limit $1
      `,
      [lim],
    );
    return rows.map((r) => r.conversation_id);
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
  const cid = opts.conversationId.trim();
  if (!cid) return null;
  try {
    const r = await findLatestServingEval({
      conversationId: cid,
      org: opts.org ?? null,
      purpose: opts.purpose ?? null,
    });
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
  const cid = opts.conversationId.trim();
  if (!cid) return [];
  try {
    const rows = await listServingEvalSummaries({
      conversationId: cid,
      org: opts.org ?? null,
      limit: EVAL_VERSION_LIMIT,
    });
    return rows.map((r) => {
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
  try {
    const r = await findServingEvalByAnalysisId(id);
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

/** 평가 결과가 있는 conversation. 배치 중복 방지에 쓰므로 조회 실패는 그대로 던진다. */
export async function listAnalyzedConversationIds(
  org: CallQualityOrg,
  conversationIds: string[],
): Promise<string[]> {
  return listServingAnalyzedIds(org, conversationIds);
}

export async function listRecentAnalyzedConversationIds(org: CallQualityOrg, limit = 100): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(limit) || 100, 1), 1500);
  try {
    return await listServingRecentAnalyzedIds(org, lim);
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
  try {
    const rows = await listServingLatestRows({ org, conversationIds: ids });
    const checklistById = new Map<string, string>();
    for (const r of rows) {
      const id = String(r.conversation_id ?? r.source_id ?? "");
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
    if (opts?.liveHuman !== false) {
      await applyLiveHumanToFlags(out, checklistById);
    }
  } catch (e) {
    console.error("[evalResultStore] listEvalFlags:", e);
  }
  return out;
}

/** 최신 결과 기준 수기 검수 완료/미완료 conversation id */
export async function listRecentConversationIdsByReview(
  org: CallQualityOrg,
  opts: { reviewCompleted: boolean; limit?: number },
): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 100) || 100, 1), 500);
  if (opts.reviewCompleted) return listRecentCompletedConversationIds({ org, limit: lim });
  const candidates = await listRecentAnalyzedConversationIds(org, Math.min(lim * 3, 1500));
  if (!candidates.length) return [];
  const completions = await listLatestReviewCompletionsByConversationIds(candidates);
  return candidates.filter((id) => !completions.has(id)).slice(0, lim);
}

/** purpose=qa_eval 기준 conversation별 최신 */
export async function listLatestQaEvalResults(opts?: {
  promptVersionId?: string | null;
}): Promise<Map<string, EvalResultRow>> {
  const versionId = (opts?.promptVersionId ?? "").trim() || null;
  try {
    const rows = await listServingLatestRows({ purpose: "qa_eval", promptVersionId: versionId });
    const m = new Map<string, EvalResultRow>();
    for (const r of rows) {
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
  try {
    return await listServingPromptVersionCounts("qa_eval");
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
  await patchCallApp(input.conversationId, {
    reviewCompleted: true,
    humanResult,
    aiLabel,
    clearClaim: true,
    org: input.org,
  });

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
 * 완료 시각은 serving_review_completions 기준.
 */
export async function listReviewedCallEvalResults(opts: {
  org?: CallQualityOrg | null;
  startIso: string;
  endIso: string;
  limit?: number;
}): Promise<EvalResultRow[]> {
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 2000) || 2000, 1), 5000);
  const org = opts.org ?? null;

  const completions = await listReviewCompletionsInPeriod({
    startIso: opts.startIso,
    endIso: opts.endIso,
    org,
    limit: lim,
  });
  const completionById = new Map(completions.map((c) => [c.conversationId, c]));
  const ids = [...completionById.keys()].slice(0, lim);
  if (!ids.length) return [];

  try {
    const rows = await listServingLatestRows({ org, conversationIds: ids, purpose: "call_eval" });
    const mapped = rows.map((r) => {
      const row = rowToEvalResult(r);
      const c = completionById.get(row.conversationId);
      return c ? { ...row, reviewCompletedAt: c.completedAt, reviewCompletedBy: c.completedBy } : row;
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

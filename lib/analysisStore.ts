/**
 * @deprecated 통합 스토어 `lib/evalResultStore.ts` 래퍼.
 * 기존 import 경로 유지용.
 */
import type { EvaluationResult } from "./types";
import type { CallQualityOrg } from "./callQualityOrg";
import {
  ensureEvalResultsTable,
  getEvalResultByAnalysisId,
  getLatestEvalResult,
  getLatestEvaluationResult,
  listAnalyzedConversationIds as listAnalyzedIds,
  listEvalFlagsByConversationIds as listEvalFlags,
  listRecentAnalyzedConversationIds as listRecentIds,
  listRecentConversationIdsByReview as listRecentByReview,
  saveEvalResult,
} from "./evalResultStore";

export async function saveAnalysisResult(input: {
  org: CallQualityOrg;
  conversationId: string;
  phoneInquiryId?: string | null;
  analyzedBy: string;
  result: EvaluationResult;
  promptVersionId?: string | null;
  promptVersion?: string | null;
  llmCallId?: string | null;
}): Promise<string> {
  const row = await saveEvalResult({
    purpose: "call_eval",
    org: input.org,
    conversationId: input.conversationId,
    phoneInquiryId: input.phoneInquiryId,
    analyzedBy: input.analyzedBy,
    result: input.result,
    promptVersionId: input.promptVersionId ?? null,
    promptVersion: input.promptVersion ?? process.env.CALL_PROMPT_VERSION ?? "v1",
    llmCallId:
      input.llmCallId ?? (input.result as EvaluationResult & { llmCallId?: string | null }).llmCallId ?? null,
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  });
  return row.analysisId;
}

export async function listAnalyzedConversationIds(
  org: CallQualityOrg,
  conversationIds: string[],
): Promise<string[]> {
  return listAnalyzedIds(org, conversationIds);
}

export async function listRecentAnalyzedConversationIds(org: CallQualityOrg, limit = 100): Promise<string[]> {
  return listRecentIds(org, limit);
}

export async function listEvalFlagsByConversationIds(
  org: CallQualityOrg,
  conversationIds: string[],
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
  return listEvalFlags(org, conversationIds);
}

export async function listRecentConversationIdsByReview(
  org: CallQualityOrg,
  opts: { reviewCompleted: boolean; limit?: number },
): Promise<string[]> {
  return listRecentByReview(org, opts);
}

export async function getLatestResultByConversation(
  org: CallQualityOrg,
  conversationId: string,
): Promise<EvaluationResult | null> {
  return getLatestEvaluationResult(org, conversationId);
}

/** 결과 + 검수 메타 */
export async function getLatestResultMeta(org: CallQualityOrg, conversationId: string) {
  await ensureEvalResultsTable();
  return getLatestEvalResult({ conversationId, org });
}

export async function getAnalysisById(analysisId: string) {
  const found = await getEvalResultByAnalysisId(analysisId);
  if (!found) return null;
  return {
    result: found.result,
    org: (found.row.org ?? "growth") as CallQualityOrg,
    conversationId: found.row.conversationId,
    phoneInquiryId: found.row.phoneInquiryId,
    analyzedBy: found.row.analyzedBy,
    analyzedAt: found.row.analyzedAt,
    humanResult: found.row.humanResult,
    humanFinalLabel: found.row.humanFinalLabel,
    aiLabel: found.row.aiLabel,
    match: found.row.match,
    reviewCompletedAt: found.row.reviewCompletedAt,
    reviewCompletedBy: found.row.reviewCompletedBy,
    promptVersionId: found.row.promptVersionId,
    purpose: found.row.purpose,
  };
}

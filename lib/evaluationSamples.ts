// 콜 샘플 조회. 온디맨드 경로는 call_serving 인덱스 한 번만 읽는다.
import {
  listServingCaseMeta,
  listServingFilterOptions,
  listServingSamples,
  servingConversationByInquiry,
  servingPhoneInquiryId,
} from "./callServingStore";
import type { EvaluationSample, SampleFilters } from "./types";

export async function listFilterOptions(): Promise<{ teamAgents: { team: string; name: string }[]; categories: string[] }> {
  return listServingFilterOptions();
}

export async function listEvaluationSamples(filters: SampleFilters = {}, limit = 100): Promise<EvaluationSample[]> {
  return listServingSamples({ filters, limit });
}

export async function listCaseMetaByConversationIds(
  conversationIds: string[],
): Promise<Map<string, { adminName: string; callDate: string }>> {
  return listServingCaseMeta(conversationIds);
}

export async function resolvePhoneInquiryIdByConversationId(conversationId: string): Promise<string | null> {
  return servingPhoneInquiryId(conversationId);
}

export async function resolveConversationIdByPhoneInquiryId(
  phoneInquiryId: string,
): Promise<{ conversationId: string; phoneInquiryId: string } | null> {
  return servingConversationByInquiry(phoneInquiryId);
}

import { resolveConversationIdByPhoneInquiryId } from "./evaluationSamples";

export type ObserveTargetInput = {
  conversationId?: string | null;
  inquiryId?: string | null;
};

export type ObserveTarget = {
  conversationId: string;
  phoneInquiryId: string | null;
  resolvedFrom: "conversationId" | "inquiryId";
};

/** observe API·딥링크용 conversation_id 확정 (conversationId 우선, 없으면 상담이력 ID 조회) */
export async function resolveObserveTarget(
  input: ObserveTargetInput,
): Promise<ObserveTarget | null> {
  const conversationId = (input.conversationId ?? "").trim();
  const inquiryId = (input.inquiryId ?? "").trim();

  if (conversationId) {
    return {
      conversationId,
      phoneInquiryId: inquiryId || null,
      resolvedFrom: "conversationId",
    };
  }

  if (!inquiryId) return null;

  const resolved = await resolveConversationIdByPhoneInquiryId(inquiryId);
  if (!resolved) return null;

  return {
    conversationId: resolved.conversationId,
    phoneInquiryId: resolved.phoneInquiryId,
    resolvedFrom: "inquiryId",
  };
}

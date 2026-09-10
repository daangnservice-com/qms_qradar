import { listStoredSttPresenceByConversationIds, listRecentConversationIdsWithStoredStt } from "./evalResultStore";
import {
  listBatchTranscriptConversationIds,
  listBatchTranscriptPresenceByConversationIds,
} from "./sttBatchStore";
import type { SttSource } from "./types";

export type SttPresence = { hasStt: boolean; sttSource: SttSource | null };

/** 배치·평가 저장 STT 존재 여부를 conversation별로 조회한다. */
export async function listSttPresenceByConversationIds(
  conversationIds: string[],
): Promise<Map<string, SttPresence>> {
  const ids = [...new Set(conversationIds.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, SttPresence>();
  for (const id of ids) out.set(id, { hasStt: false, sttSource: null });

  const [stored, batchIds] = await Promise.all([
    listStoredSttPresenceByConversationIds(ids),
    // 반환 행만 경로 exists — 전사 JSON 전량 파싱하지 않음
    listBatchTranscriptPresenceByConversationIds(ids),
  ]);

  for (const id of ids) {
    const fromStore = stored.get(id);
    if (fromStore?.hasStt) {
      out.set(id, fromStore);
      continue;
    }
    if (batchIds.has(id)) {
      out.set(id, { hasStt: true, sttSource: "local" });
    }
  }
  return out;
}

/** STT가 있는 최근 conversation_id (배치·평가 저장분 합집합). */
export async function listRecentConversationIdsWithStt(limit = 100): Promise<string[]> {
  const [stored, batchIds] = await Promise.all([
    listRecentConversationIdsWithStoredStt(limit),
    listBatchTranscriptConversationIds(),
  ]);
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of [...stored, ...batchIds]) {
    const cid = id.trim();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    merged.push(cid);
    if (merged.length >= limit) break;
  }
  return merged;
}

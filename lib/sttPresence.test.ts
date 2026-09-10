import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./evalResultStore", () => ({
  listStoredSttPresenceByConversationIds: vi.fn(),
  listRecentConversationIdsWithStoredStt: vi.fn(),
}));
vi.mock("./sttBatchStore", () => ({
  listBatchTranscriptConversationIds: vi.fn(),
  listBatchTranscriptPresenceByConversationIds: vi.fn(),
}));

import { listStoredSttPresenceByConversationIds, listRecentConversationIdsWithStoredStt } from "./evalResultStore";
import {
  listBatchTranscriptConversationIds,
  listBatchTranscriptPresenceByConversationIds,
} from "./sttBatchStore";
import { listSttPresenceByConversationIds, listRecentConversationIdsWithStt } from "./sttPresence";

beforeEach(() => vi.clearAllMocks());

describe("listSttPresenceByConversationIds", () => {
  it("prefers stored STT over batch and only probes given ids", async () => {
    (listStoredSttPresenceByConversationIds as any).mockResolvedValue(
      new Map([["c1", { hasStt: true, sttSource: "gcp" }]]),
    );
    (listBatchTranscriptPresenceByConversationIds as any).mockResolvedValue(new Set(["c2"]));

    const out = await listSttPresenceByConversationIds(["c1", "c2", "c3"]);
    expect(listBatchTranscriptPresenceByConversationIds).toHaveBeenCalledWith(["c1", "c2", "c3"]);
    expect(listBatchTranscriptConversationIds).not.toHaveBeenCalled();
    expect(out.get("c1")).toEqual({ hasStt: true, sttSource: "gcp" });
    expect(out.get("c2")).toEqual({ hasStt: true, sttSource: "local" });
    expect(out.get("c3")).toEqual({ hasStt: false, sttSource: null });
  });
});

describe("listRecentConversationIdsWithStt", () => {
  it("merges stored and batch ids without duplicates", async () => {
    (listRecentConversationIdsWithStoredStt as any).mockResolvedValue(["a", "b"]);
    (listBatchTranscriptConversationIds as any).mockResolvedValue(new Set(["b", "c"]));

    const ids = await listRecentConversationIdsWithStt(10);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

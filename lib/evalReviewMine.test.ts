import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./evalResultStore", () => ({
  listEvalFlagsByConversationIds: vi.fn(),
}));
vi.mock("./evalReviewStore", () => ({
  listConversationIdsReviewedBy: vi.fn(),
}));
vi.mock("./evalReviewClaimStore", () => ({
  listActiveClaimConversationIdsBy: vi.fn(),
}));

import { listEvalFlagsByConversationIds } from "./evalResultStore";
import { listConversationIdsReviewedBy } from "./evalReviewStore";
import { listActiveClaimConversationIdsBy } from "./evalReviewClaimStore";
import { listMyEvalQueueConversationIds } from "./evalReviewMine";

beforeEach(() => vi.clearAllMocks());

describe("listMyEvalQueueConversationIds", () => {
  it("unions reviews and claims, drops completed", async () => {
    (listConversationIdsReviewedBy as any).mockResolvedValue(["a", "b"]);
    (listActiveClaimConversationIdsBy as any).mockResolvedValue(["b", "c"]);
    (listEvalFlagsByConversationIds as any).mockResolvedValue(
      new Map([
        ["a", { reviewCompleted: false, highRiskFlagKeys: [], aiLabel: null, humanResult: null }],
        ["b", { reviewCompleted: true, highRiskFlagKeys: [], aiLabel: null, humanResult: null }],
        ["c", { reviewCompleted: false, highRiskFlagKeys: [], aiLabel: null, humanResult: null }],
      ]),
    );
    const ids = await listMyEvalQueueConversationIds({
      email: "karla@daangnservice.com",
      org: "growth",
    });
    expect(ids.sort()).toEqual(["a", "c"]);
  });

  it("keeps unanalyzed claims (no flags row)", async () => {
    (listConversationIdsReviewedBy as any).mockResolvedValue([]);
    (listActiveClaimConversationIdsBy as any).mockResolvedValue(["x"]);
    (listEvalFlagsByConversationIds as any).mockResolvedValue(new Map());
    const ids = await listMyEvalQueueConversationIds({
      email: "karla@daangnservice.com",
      org: "growth",
    });
    expect(ids).toEqual(["x"]);
  });
});

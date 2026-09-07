import { describe, it, expect, vi } from "vitest";
import { resolveObserveTarget } from "./observeResolve";

vi.mock("./evaluationSamples", () => ({
  resolveConversationIdByPhoneInquiryId: vi.fn(),
}));

import { resolveConversationIdByPhoneInquiryId } from "./evaluationSamples";

describe("resolveObserveTarget", () => {
  it("prefers conversationId when provided", async () => {
    await expect(
      resolveObserveTarget({ conversationId: "conv-1", inquiryId: "inq-1" }),
    ).resolves.toEqual({
      conversationId: "conv-1",
      phoneInquiryId: "inq-1",
      resolvedFrom: "conversationId",
    });
  });

  it("resolves inquiry id via BQ lookup", async () => {
    (resolveConversationIdByPhoneInquiryId as ReturnType<typeof vi.fn>).mockResolvedValue({
      conversationId: "conv-2",
      phoneInquiryId: "inq-2",
    });
    await expect(resolveObserveTarget({ inquiryId: "inq-2" })).resolves.toEqual({
      conversationId: "conv-2",
      phoneInquiryId: "inq-2",
      resolvedFrom: "inquiryId",
    });
  });

  it("returns null when inquiry id not found", async () => {
    (resolveConversationIdByPhoneInquiryId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(resolveObserveTarget({ inquiryId: "missing" })).resolves.toBeNull();
  });
});

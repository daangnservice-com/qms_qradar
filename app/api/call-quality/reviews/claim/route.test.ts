import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/evalReviewClaimStore", () => ({
  ReviewClaimConflictError: class ReviewClaimConflictError extends Error {
    claimedBy: string;
    constructor(claimedBy: string, message: string) {
      super(message);
      this.name = "ReviewClaimConflictError";
      this.claimedBy = claimedBy;
    }
  },
  claimReview: vi.fn(),
  getActiveClaim: vi.fn(),
  releaseReviewClaim: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { claimReview, releaseReviewClaim } from "@/lib/evalReviewClaimStore";
import { POST } from "./route";

const KARLA = "karla@daangnservice.com";
const req = (body: unknown) =>
  new Request("http://localhost/api/call-quality/reviews/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/call-quality/reviews/claim", () => {
  it("403 without allowlist access", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    expect((await POST(req({ conversationId: "c1" }))).status).toBe(403);
  });

  it("claims a conversation", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (claimReview as any).mockResolvedValue({
      conversationId: "c1",
      claimedBy: KARLA,
      claimedAt: "2026-08-26T00:00:00.000Z",
    });
    const res = await POST(req({ conversationId: "c1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claim.claimedBy).toBe(KARLA);
    expect(claimReview).toHaveBeenCalledWith({ conversationId: "c1", claimedBy: KARLA });
  });

  it("releases a claim", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (releaseReviewClaim as any).mockResolvedValue(undefined);
    const res = await POST(req({ conversationId: "c1", release: true }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claim).toBeNull();
    expect(releaseReviewClaim).toHaveBeenCalledWith({ conversationId: "c1", releasedBy: KARLA });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/callServingStore", () => ({ listServingSamples: vi.fn() }));
vi.mock("@/lib/reviewAssignStore", () => ({
  listReviewRequestConversationIds: vi.fn().mockResolvedValue([]),
}));

import { getServerSession } from "next-auth";
import { listServingSamples } from "@/lib/callServingStore";
import { listReviewRequestConversationIds } from "@/lib/reviewAssignStore";
import { POST } from "./route";

const KARLA = "karla@daangnservice.com";
const req = (body: unknown = {}) =>
  new Request("http://localhost/api/call-quality/samples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/call-quality/samples", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await POST(req())).status).toBe(401);
  });

  it("403 for an account outside the domain", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@gmail.com" } });
    expect((await POST(req())).status).toBe(403);
  });

  it("allows any domain member", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    (listServingSamples as any).mockResolvedValue([]);
    expect((await POST(req())).status).toBe(200);
  });

  it("returns the index query result", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listServingSamples as any).mockResolvedValue([{ conversationId: "c1", phoneInquiryId: "p1" }]);
    const res = await POST(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.samples).toHaveLength(1);
    expect(json.samples[0].conversationId).toBe("c1");
    expect(listServingSamples).toHaveBeenCalledTimes(1);
  });


  it("passes filters and clamps the limit", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listServingSamples as any).mockResolvedValue([]);
    const filters = { teams: ["pay-cs"], callDateStart: "2026-05-01" };
    await POST(req({ filters, limit: 9999 }));
    expect(listServingSamples).toHaveBeenCalledWith({
      filters,
      limit: 500,
      mineEmail: KARLA,
      reviewRequestIds: null,
    });
  });

  it("loads the local review-request reservoir only when that filter is on", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listReviewRequestConversationIds as any).mockResolvedValue(["c9"]);
    (listServingSamples as any).mockResolvedValue([]);
    await POST(req({ filters: { reviewRequestedOnly: true } }));
    expect(listReviewRequestConversationIds).toHaveBeenCalledTimes(1);
    expect(listServingSamples).toHaveBeenCalledWith({
      filters: { reviewRequestedOnly: true },
      limit: 100,
      mineEmail: KARLA,
      reviewRequestIds: ["c9"],
    });
  });
});

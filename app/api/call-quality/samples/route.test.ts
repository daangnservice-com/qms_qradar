import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/evaluationSamples", () => ({ listEvaluationSamples: vi.fn() }));
vi.mock("@/lib/analysisStore", () => ({ listAnalyzedConversationIds: vi.fn().mockResolvedValue([]) }));

import { getServerSession } from "next-auth";
import { listEvaluationSamples } from "@/lib/evaluationSamples";
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

  it("403 for an account not on the allowlist", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    expect((await POST(req())).status).toBe(403);
  });

  it("allows the added call-quality members (e.g. laika)", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "laika@daangnservice.com" } });
    (listEvaluationSamples as any).mockResolvedValue([]);
    expect((await POST(req())).status).toBe(200);
  });

  it("returns samples for karla", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listEvaluationSamples as any).mockResolvedValue([{ conversationId: "c1", phoneInquiryId: "p1" }]);
    const res = await POST(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.samples).toHaveLength(1);
    expect(json.samples[0].conversationId).toBe("c1");
  });

  it("gates by org: pay member allowed, growth-only member forbidden on pay", async () => {
    (listEvaluationSamples as any).mockResolvedValue([]);
    (getServerSession as any).mockResolvedValue({ user: { email: "heather@daangnservice.com" } });
    expect((await POST(req({ org: "pay" }))).status).toBe(200);
    (getServerSession as any).mockResolvedValue({ user: { email: "laika@daangnservice.com" } });
    expect((await POST(req({ org: "pay" }))).status).toBe(403);
  });

  it("passes filters and clamps the limit", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listEvaluationSamples as any).mockResolvedValue([]);
    const filters = { teams: ["pay-cs"], callDateStart: "2026-05-01" };
    await POST(req({ filters, limit: 9999 }));
    expect(listEvaluationSamples).toHaveBeenCalledWith(filters, 500);
  });
});

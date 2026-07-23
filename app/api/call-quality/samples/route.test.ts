import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/evaluationSamples", () => ({ listEvaluationSamples: vi.fn() }));

import { getServerSession } from "next-auth";
import { listEvaluationSamples } from "@/lib/evaluationSamples";
import { GET } from "./route";

const KARLA = "karla@daangnservice.com";
const req = (url = "http://localhost/api/call-quality/samples") => new Request(url);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/call-quality/samples", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it("403 for a non-karla account", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    expect((await GET(req())).status).toBe(403);
  });

  it("returns samples for karla", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listEvaluationSamples as any).mockResolvedValue([
      { conversationId: "c1", phoneInquiryId: "p1", contentSnippet: "hi", yearMonth: "2026-05" },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.samples).toHaveLength(1);
    expect(json.samples[0].conversationId).toBe("c1");
  });

  it("clamps the limit param", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listEvaluationSamples as any).mockResolvedValue([]);
    await GET(req("http://localhost/api/call-quality/samples?limit=9999"));
    expect(listEvaluationSamples).toHaveBeenCalledWith(500);
  });
});

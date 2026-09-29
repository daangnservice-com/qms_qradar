import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/evaluationSamples", () => ({ listFilterOptions: vi.fn() }));

import { getServerSession } from "next-auth";
import { listFilterOptions } from "@/lib/evaluationSamples";
import { GET } from "./route";

const OPTIONS = { teamAgents: [{ team: "페이CS", name: "홍길동" }], categories: ["결제"] };

beforeEach(() => vi.clearAllMocks());

describe("GET /api/call-quality/filter-options", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("403 for an account outside the domain", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@gmail.com" } });
    expect((await GET()).status).toBe(403);
  });

  it("allows any domain member", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    (listFilterOptions as any).mockResolvedValue(OPTIONS);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OPTIONS);
  });

  it("surfaces a BigQuery failure as 500 instead of empty options", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    (listFilterOptions as any).mockRejectedValue(new Error("bq down"));
    expect((await GET()).status).toBe(500);
  });
});

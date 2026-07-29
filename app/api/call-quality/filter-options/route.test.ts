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

  it("403 for an account not on any call-quality allowlist", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    expect((await GET()).status).toBe(403);
  });

  // 옵션은 조직 공통이라 페이팀 전용 계정도 받아야 한다(과거 403 → 드롭다운 전부 빔).
  it("allows a pay-only member (heather)", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "heather@daangnservice.com" } });
    (listFilterOptions as any).mockResolvedValue(OPTIONS);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OPTIONS);
  });

  it("allows a growth-only member (laika)", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "laika@daangnservice.com" } });
    (listFilterOptions as any).mockResolvedValue(OPTIONS);
    expect((await GET()).status).toBe(200);
  });

  it("surfaces a BigQuery failure as 500 instead of empty options", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    (listFilterOptions as any).mockRejectedValue(new Error("bq down"));
    expect((await GET()).status).toBe(500);
  });
});

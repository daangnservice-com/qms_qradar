import { beforeEach, describe, expect, it, vi } from "vitest";

const getCsat = vi.hoisted(() => vi.fn());
const canAccess = vi.hoisted(() => vi.fn());
const getServingCsat = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/sessionAccessServer", () => ({
  ensureSessionCanAccessEvalProgress: (...args: unknown[]) => canAccess(...args),
}));
vi.mock("@/lib/csatServer", () => ({
  getCsatByCsatId: (...args: unknown[]) => getCsat(...args),
}));
vi.mock("@/lib/feedbackServingStore", () => ({
  getServingFeedbackCsat: (...args: unknown[]) => getServingCsat(...args),
}));

import { getServerSession } from "next-auth";
import { GET } from "./route";

const req = (csatId?: string) =>
  new Request(
    `http://localhost/api/evaluations/feedback/csat${csatId != null ? `?csatId=${encodeURIComponent(csatId)}` : ""}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { email: "fixture@example.invalid" },
  });
  canAccess.mockResolvedValue(true);
  getServingCsat.mockResolvedValue(null);
});

describe("GET /api/evaluations/feedback/csat", () => {
  it("rejects missing access or csatId", async () => {
    canAccess.mockResolvedValueOnce(false);
    expect((await GET(req("552840"))).status).toBe(403);
    expect((await GET(req())).status).toBe(400);
    expect(getCsat).not.toHaveBeenCalled();
  });

  it("returns the CSAT record, or null when the customer skipped the survey", async () => {
    getCsat.mockResolvedValue({
      csatId: "552840",
      adminUserId: "1",
      phoneInquiryId: "1409590",
      createdAt: "2026-09-01 10:00:00",
      rate: 2,
      comment: "느려요",
      choices: [],
      issueType: "",
      resolved: null,
      isProfane: false,
    });
    const found = await GET(req("552840"));
    expect(found.status).toBe(200);
    expect(getCsat).toHaveBeenCalledWith("552840");
    expect(await found.json()).toEqual({
      csat: {
        csatId: "552840",
        adminUserId: "1",
        phoneInquiryId: "1409590",
        createdAt: "2026-09-01 10:00:00",
        rate: 2,
        comment: "느려요",
        choices: [],
        issueType: "",
        resolved: null,
        isProfane: false,
      },
    });

    getCsat.mockResolvedValueOnce(null);
    const skipped = await GET(req("1"));
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toEqual({ csat: null });
  });

  it("serves the serving copy without touching the source view", async () => {
    getServingCsat.mockResolvedValueOnce({ csatId: "7", rate: 5 });
    const res = await GET(req("7"));
    expect(await res.json()).toEqual({ csat: { csatId: "7", rate: 5 } });
    expect(getCsat).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/evaluationSamples", () => ({ listEvaluationSamples: vi.fn() }));
vi.mock("@/lib/analysisStore", () => ({
  listAnalyzedConversationIds: vi.fn().mockResolvedValue([]),
  listEvalFlagsByConversationIds: vi.fn().mockResolvedValue(new Map()),
  listRecentAnalyzedConversationIds: vi.fn().mockResolvedValue([]),
  listRecentConversationIdsByReview: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/highRiskFlagStore", () => ({
  listHighRiskFlagRules: vi.fn().mockResolvedValue([]),
  listLongCallConversationIds: vi.fn().mockResolvedValue([]),
  listHighRiskConversationIds: vi.fn().mockResolvedValue({ ids: [], longCallIds: [] }),
  listConversationIdsByCsatRates: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/longCallThresholdStore", () => ({
  getOrRefreshLongCallThreshold: vi.fn().mockResolvedValue(null),
}));
// CSAT 점수 조회만 가로채고 DSAT 판정(isDsatRate)은 실제 구현을 쓴다.
vi.mock("@/lib/csat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csat")>()),
  listCsatRatesByPhoneInquiryIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/evalReviewClaimStore", () => ({
  listActiveClaimsByConversationIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/evalReviewMine", () => ({
  listMyEvalQueueConversationIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/evalReviewClaimCache", () => ({
  rememberEvalSamples: vi.fn(),
  cachedEvalSamplesFor: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/sttPresence", () => ({
  listSttPresenceByConversationIds: vi.fn().mockResolvedValue(new Map()),
  listRecentConversationIdsWithStt: vi.fn().mockResolvedValue([]),
}));

import { getServerSession } from "next-auth";
import { listEvaluationSamples } from "@/lib/evaluationSamples";
import { listMyEvalQueueConversationIds } from "@/lib/evalReviewMine";
import { listConversationIdsByCsatRates, listHighRiskConversationIds, listHighRiskFlagRules } from "@/lib/highRiskFlagStore";
import { getOrRefreshLongCallThreshold } from "@/lib/longCallThresholdStore";
import { listCsatRatesByPhoneInquiryIds } from "@/lib/csat";
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

  it("returns empty when mineOnly queue is empty", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listMyEvalQueueConversationIds as any).mockResolvedValue([]);
    const res = await POST(req({ filters: { mineOnly: true } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ samples: [] });
    expect(listEvaluationSamples).not.toHaveBeenCalled();
  });

  it("restricts samples to my eval queue when mineOnly", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listMyEvalQueueConversationIds as any).mockResolvedValue(["c9"]);
    (listEvaluationSamples as any).mockResolvedValue([{ conversationId: "c9" }]);
    await POST(req({ filters: { mineOnly: true } }));
    expect(listEvaluationSamples).toHaveBeenCalledWith({ conversationIds: ["c9"] }, 100);
  });
});

describe("CSAT / 고위험 플래그", () => {
  const threeSamples = [
    { conversationId: "c1", phoneInquiryId: "p1" },
    { conversationId: "c2", phoneInquiryId: "p2" },
    { conversationId: "c3", phoneInquiryId: "p3" },
  ];
  // p1=1점(DSAT), p2=5점, p3=설문 미참여
  const rates = () => new Map([["p1", 1], ["p2", 5]]);

  beforeEach(() => {
    (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
    (listEvaluationSamples as any).mockResolvedValue(threeSamples);
    (listCsatRatesByPhoneInquiryIds as any).mockResolvedValue(rates());
  });

  it("상담이력 ID로 CSAT 점수를 붙이고, 기준 이하면 dsat 플래그를 단다", async () => {
    const json = await (await POST(req())).json();
    const by = Object.fromEntries(json.samples.map((s: any) => [s.conversationId, s]));
    expect(by.c1.csatRate).toBe(1);
    expect(by.c1.highRiskFlagKeys).toContain("dsat");
    expect(by.c2.csatRate).toBe(5);
    expect(by.c2.highRiskFlagKeys).not.toContain("dsat");
    // 설문 미참여는 점수 없음 — DSAT도 아니다
    expect(by.c3.csatRate).toBeNull();
    expect(by.c3.highRiskFlagKeys).not.toContain("dsat");
  });

  it("csatRates 로 점수를 거른다", async () => {
    (listConversationIdsByCsatRates as any).mockResolvedValue(["c1", "c2", "c3"]);
    const json = await (await POST(req({ filters: { csatRates: [5] } }))).json();
    expect(json.samples.map((s: any) => s.conversationId)).toEqual(["c2"]);
  });

  it("csatIncludeNone 이면 설문 미참여 건이 남는다", async () => {
    (listConversationIdsByCsatRates as any).mockResolvedValue(["c1", "c2", "c3"]);
    const json = await (
      await POST(req({ filters: { csatRates: [1], csatIncludeNone: true } }))
    ).json();
    expect(json.samples.map((s: any) => s.conversationId)).toEqual(["c1", "c3"]);
  });

  it("highRiskFlagKeys 는 고른 플래그 중 하나라도 가진 건만 남긴다", async () => {
    // 개별 키 선택도 고위험군 풀을 먼저 거친다(풀이 비면 결과도 비어야 정상).
    (listHighRiskConversationIds as any).mockResolvedValue({
      ids: ["c1", "c2", "c3"],
      longCallIds: [],
    });
    const json = await (await POST(req({ filters: { highRiskFlagKeys: ["dsat"] } }))).json();
    expect(json.samples.map((s: any) => s.conversationId)).toEqual(["c1"]);
  });

  it("장콜은 저장된 MA 임계분과 callDurationSec 비교로 단다", async () => {
    (listHighRiskFlagRules as any).mockResolvedValue([
      {
        ruleId: "r1",
        key: "long_call",
        label: "장콜",
        enabled: true,
        kind: "long_call_percentile",
        params: { percentile: 10, minMinutes: null },
        sortOrder: 1,
        updatedAt: "",
        updatedBy: "",
      },
    ]);
    (getOrRefreshLongCallThreshold as any).mockResolvedValue({
      thresholdMinutes: 12,
      percentile: 10,
    });
    (listEvaluationSamples as any).mockResolvedValue([
      { conversationId: "c1", phoneInquiryId: "p1", callDurationSec: 15 * 60 },
      { conversationId: "c2", phoneInquiryId: "p2", callDurationSec: 5 * 60 },
    ]);
    (listCsatRatesByPhoneInquiryIds as any).mockResolvedValue(new Map());

    const json = await (await POST(req())).json();
    const by = Object.fromEntries(json.samples.map((s: any) => [s.conversationId, s]));
    expect(by.c1.highRiskFlagKeys).toContain("long_call");
    expect(by.c2.highRiskFlagKeys).not.toContain("long_call");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const listSamples = vi.hoisted(() => vi.fn());
const listResults = vi.hoisted(() => vi.fn());
const listRules = vi.hoisted(() => vi.fn());
const canAccess = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/sessionAccessServer", () => ({
  ensureSessionCanAccessEvalProgress: (...args: unknown[]) => canAccess(...args),
}));
vi.mock("@/lib/feedbackSamples", () => ({
  FEEDBACK_SOURCE_SYSTEM: "karrotmarket.team_operation.feedback_thread_aggregation",
  listFeedbackSamples: (...args: unknown[]) => listSamples(...args),
}));
vi.mock("@/lib/evaluationItemResultStore", () => ({
  listLatestEvaluationItemResults: (...args: unknown[]) => listResults(...args),
}));
vi.mock("@/lib/highRiskFlagStore", () => ({
  listHighRiskFlagRules: (...args: unknown[]) => listRules(...args),
}));

import { getServerSession } from "next-auth";
import { POST } from "./route";

const req = (body: unknown = {}) =>
  new Request("http://localhost/api/evaluations/feedback/samples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const countRule = {
  ruleId: "r1",
  key: "many_replies",
  label: "답변 과다",
  enabled: true,
  channel: "feedback",
  kind: "feedback_message_count",
  params: { countTarget: "reply", minCount: 3 },
  sortOrder: 1,
  updatedAt: "",
  updatedBy: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { email: "fixture@example.invalid" },
  });
  canAccess.mockResolvedValue(true);
  listResults.mockResolvedValue(new Map());
  listRules.mockResolvedValue([countRule]);
  listSamples.mockResolvedValue([
    {
      sourceSystem: "fixture",
      sourceId: "1",
      feedbackCount: 1,
      replyCount: 4,
    },
  ]);
});

describe("POST /api/evaluations/feedback/samples", () => {
  it("403 without access", async () => {
    canAccess.mockResolvedValueOnce(false);
    expect((await POST(req())).status).toBe(403);
    expect(listSamples).not.toHaveBeenCalled();
  });

  it("pushes high-risk count rules into the source query instead of filtering the latest 100", async () => {
    const response = await POST(req({ filters: { highRiskOnly: true, replyCountMin: 1 } }));
    expect(response.status).toBe(200);
    expect(listSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        replyCountMin: 1,
        highRiskCountAny: [{ countTarget: "reply", minCount: 3 }],
      }),
      100,
    );
    const body = (await response.json()) as { samples: Array<{ highRiskFlags: Array<{ key: string }> }> };
    expect(body.samples).toHaveLength(1);
    expect(body.samples[0].highRiskFlags.map((hit) => hit.key)).toEqual(["many_replies"]);
  });

  it("returns empty when high-risk is on but no count rules exist", async () => {
    listRules.mockResolvedValueOnce([]);
    const response = await POST(req({ filters: { highRiskOnly: true } }));
    expect(response.status).toBe(200);
    expect(listSamples).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ samples: [] });
  });
});

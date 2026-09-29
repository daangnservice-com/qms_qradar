import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatest = vi.hoisted(() => vi.fn());
const parseStored = vi.hoisted(() => vi.fn());
const getPromptConfig = vi.hoisted(() => vi.fn());
const canAccess = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/sessionAccessServer", () => ({
  ensureSessionCanAccessEvalProgress: (...args: unknown[]) => canAccess(...args),
}));
vi.mock("@/lib/feedbackSamples", () => ({
  FEEDBACK_SOURCE_SYSTEM: "karrotmarket.team_operation.feedback_thread_aggregation",
}));
vi.mock("@/lib/evaluationItemResultStore", () => ({
  getLatestEvaluationItemResult: (...args: unknown[]) => getLatest(...args),
  parseStoredEvaluationItemResult: (...args: unknown[]) => parseStored(...args),
}));
vi.mock("@/lib/promptStore", () => ({
  getPromptConfigByVersionId: (...args: unknown[]) => getPromptConfig(...args),
}));

import { getServerSession } from "next-auth";
import { GET } from "./route";

const req = (sourceId?: string) =>
  new Request(
    `http://localhost/api/evaluations/feedback/results${sourceId != null ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { email: "fixture@example.invalid" },
  });
  canAccess.mockResolvedValue(true);
});

describe("GET /api/evaluations/feedback/results", () => {
  it("rejects missing access or sourceId", async () => {
    canAccess.mockResolvedValueOnce(false);
    expect((await GET(req("1409590"))).status).toBe(403);
    expect((await GET(req())).status).toBe(400);
    expect(getLatest).not.toHaveBeenCalled();
  });

  it("returns the stored result and hydrates promptConfig when the snapshot is missing", async () => {
    getLatest.mockResolvedValue({
      analysisId: "a1",
      purpose: "text_eval",
      promptVersionId: "draft-1",
      promptVersion: "260916_ver1",
      aiLabel: "review_needed",
      analyzedAt: "2026-09-16T00:00:00Z",
      analyzedBy: "fixture@example.invalid",
    });
    parseStored.mockResolvedValue({
      evaluation: { scores: {}, overallSummary: "", csChecklist: [{ id: 415, violated: true, reason: "공감 없음", evidence: [] }], error: null },
      sourceId: "1409590",
    });
    getPromptConfig.mockResolvedValue({
      version: { versionId: "draft-1", versionLabel: "260916_ver1", status: "draft" },
      criteria: [{ id: 415, category: "공감", label: "공감 미흡" }],
    });

    const response = await GET(req("1409590"));
    expect(response.status).toBe(200);
    expect(getLatest).toHaveBeenCalledWith({
      channel: "feedback",
      sourceSystem: "karrotmarket.team_operation.feedback_thread_aggregation",
      sourceId: "1409590",
    });
    const body = (await response.json()) as {
      result: { promptConfig?: { version: { versionId: string } }; evaluation: { csChecklist: { id: number }[] } };
      meta: { promptVersion: string };
    };
    expect(body.meta.promptVersion).toBe("260916_ver1");
    expect(body.result.promptConfig?.version.versionId).toBe("draft-1");
    expect(body.result.evaluation.csChecklist).toEqual([
      expect.objectContaining({ id: 415, violated: true }),
    ]);
  });

  it("404 when no stored row exists", async () => {
    getLatest.mockResolvedValue(null);
    expect((await GET(req("1409590"))).status).toBe(404);
  });
});

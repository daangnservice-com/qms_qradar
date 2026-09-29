import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestMeta = vi.hoisted(() => vi.fn());
const parseStored = vi.hoisted(() => vi.fn());
const getById = vi.hoisted(() => vi.fn());
const listSummaries = vi.hoisted(() => vi.fn());
const canAccess = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/sessionAccessServer", () => ({
  ensureSessionCanAccessEvalProgress: (...args: unknown[]) => canAccess(...args),
}));
vi.mock("@/lib/analysisStore", () => ({
  getLatestResultMeta: (...args: unknown[]) => getLatestMeta(...args),
}));
vi.mock("@/lib/evalResultStore", () => ({
  parseStoredEvaluationResult: (...args: unknown[]) => parseStored(...args),
  getEvalResultByAnalysisId: (...args: unknown[]) => getById(...args),
  listEvalResultSummaries: (...args: unknown[]) => listSummaries(...args),
}));

import { getServerSession } from "next-auth";
import { GET } from "./route";

const req = (q: string) => new Request(`http://localhost/api/call-quality/results?${q}`);

const result = {
  durationSec: 10,
  threshold: { minSilenceSec: 3, noiseDb: 0 },
  silences: [],
  silenceSummary: { count: 0, totalSec: 0, longestSec: 0, silenceRatio: 0 },
  evaluation: { scores: {}, overallSummary: "", silenceComments: [], transcript: [], error: null },
  promptConfig: { version: { versionId: "p1", versionLabel: "v1", status: "production" as const }, criteria: [] },
};

const versions = [
  { analysisId: "new", analyzedAt: "2026-09-18T00:00:00.000Z", promptVersion: "v2", promptVersionId: "p2", aiLabel: "review_needed", analyzedBy: null },
  { analysisId: "old", analyzedAt: "2026-09-17T00:00:00.000Z", promptVersion: "v1", promptVersionId: "p1", aiLabel: "review_not_needed", analyzedBy: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { email: "karla@daangnservice.com" },
  });
  canAccess.mockResolvedValue(true);
  listSummaries.mockResolvedValue(versions);
});

describe("GET /api/call-quality/results", () => {
  it("returns the latest result plus version summaries", async () => {
    getLatestMeta.mockResolvedValue({
      analysisId: "new",
      purpose: "call_eval",
      promptVersionId: "p2",
      promptVersion: "v2",
      humanResult: "",
      aiLabel: "review_needed",
      match: null,
      reviewCompletedAt: null,
      reviewCompletedBy: null,
      analyzedAt: "2026-09-18T00:00:00.000Z",
      analyzedBy: "karla@daangnservice.com",
    });
    parseStored.mockResolvedValue(result);

    const response = await GET(req("conversationId=c1&org=growth"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta.analysisId).toBe("new");
    expect(body.versions).toEqual(versions);
    expect(getById).not.toHaveBeenCalled();
  });

  it("loads a specific analysis when analysisId is given", async () => {
    getById.mockResolvedValue({
      result: { ...result, analysisId: "old" },
      row: {
        analysisId: "old",
        conversationId: "c1",
        org: "growth",
        purpose: "call_eval",
        promptVersionId: "p1",
        promptVersion: "v1",
        humanResult: "",
        aiLabel: "review_not_needed",
        match: null,
        reviewCompletedAt: null,
        reviewCompletedBy: null,
        analyzedAt: "2026-09-17T00:00:00.000Z",
        analyzedBy: null,
      },
    });

    const response = await GET(req("conversationId=c1&org=growth&analysisId=old"));
    expect(response.status).toBe(200);
    expect(getLatestMeta).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.meta.analysisId).toBe("old");
    expect(body.versions).toHaveLength(2);
  });

  it("404s when the requested analysis belongs to another call", async () => {
    getById.mockResolvedValue({
      result,
      row: {
        analysisId: "old",
        conversationId: "other",
        org: "growth",
        purpose: "call_eval",
        promptVersionId: null,
        promptVersion: null,
        humanResult: "",
        aiLabel: "",
        match: null,
        reviewCompletedAt: null,
        reviewCompletedBy: null,
        analyzedAt: "",
        analyzedBy: null,
      },
    });
    const response = await GET(req("conversationId=c1&org=growth&analysisId=old"));
    expect(response.status).toBe(404);
  });
});

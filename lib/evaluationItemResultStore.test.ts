import { beforeEach, describe, expect, it, vi } from "vitest";

const { listServingLatestByItems } = vi.hoisted(() => ({ listServingLatestByItems: vi.fn() }));
vi.mock("./servingEvalStore", () => ({ listServingLatestByItems }));
vi.mock("./evalResultStore", () => ({ saveEvalRun: vi.fn() }));

import {
  getLatestEvaluationItemResult,
  parseStoredEvaluationItemResult,
  type EvaluationItemResultRow,
} from "./evaluationItemResultStore";

const row = (overrides: Partial<EvaluationItemResultRow> = {}): EvaluationItemResultRow => ({
  analysisId: "a1",
  analyzedAt: "2026-09-16T00:00:00Z",
  channel: "feedback",
  sourceSystem: "fixture.source",
  sourceId: "1409590",
  org: null,
  purpose: "text_eval",
  analyzedBy: "fixture",
  model: "gemini",
  promptVersionId: "draft-1",
  promptVersion: "260916_ver1",
  aiLabel: "review_needed",
  checklistJson: JSON.stringify([{ id: 415, violated: true, reason: "공감 없음", evidence: [] }]),
  resultJson: "{}",
  transcriptJson: "[]",
  conversationJson: "[]",
  inputSnapshotJson: "{}",
  llmCallId: null,
  error: null,
  ...overrides,
});

describe("parseStoredEvaluationItemResult", () => {
  it("rebuilds checklist from checklist_json when result_json omitted it", async () => {
    const parsed = await parseStoredEvaluationItemResult(row());
    expect(parsed?.sourceId).toBe("1409590");
    expect(parsed?.evaluation.csChecklist).toEqual([
      expect.objectContaining({ id: 415, violated: true, reason: "공감 없음" }),
    ]);
  });

  it("keeps the stored prompt snapshot and checklist from result_json", async () => {
    const parsed = await parseStoredEvaluationItemResult(
      row({
        resultJson: JSON.stringify({
          evaluation: {
            scores: {},
            overallSummary: "총평",
            csChecklist: [{ id: 423, violated: false, reason: "정상", evidence: [] }],
            error: null,
          },
          promptConfig: { version: { versionId: "draft-1", versionLabel: "260916_ver1" }, criteria: [] },
        }),
      }),
    );
    expect(parsed?.evaluation.overallSummary).toBe("총평");
    expect(parsed?.evaluation.csChecklist?.[0]?.id).toBe(423);
    expect(parsed?.promptConfig?.version.versionId).toBe("draft-1");
  });
});

describe("getLatestEvaluationItemResult", () => {
  beforeEach(() => {
    listServingLatestByItems.mockReset();
    listServingLatestByItems.mockResolvedValue([]);
  });

  it("looks up the serving row by the camelCase item ref", async () => {
    await getLatestEvaluationItemResult({
      channel: "feedback",
      sourceSystem: "fixture.source",
      sourceId: "1416835",
    });
    expect(listServingLatestByItems).toHaveBeenCalledWith([
      { channel: "feedback", sourceSystem: "fixture.source", sourceId: "1416835" },
    ]);
  });

  it("maps the stored row_json back to an item result", async () => {
    listServingLatestByItems.mockResolvedValue([
      {
        analysis_id: "a9",
        analyzed_at: "2026-09-20T00:00:00Z",
        channel: "feedback",
        source_system: "fixture.source",
        source_id: "1416835",
        purpose: "call_eval",
        ai_label: "Hot",
        turns_json: "[]",
        result_json: "{}",
      },
    ]);
    const row = await getLatestEvaluationItemResult({
      channel: "feedback",
      sourceSystem: "fixture.source",
      sourceId: "1416835",
    });
    expect(row).toMatchObject({ analysisId: "a9", channel: "feedback", sourceId: "1416835", aiLabel: "Hot" });
  });
});

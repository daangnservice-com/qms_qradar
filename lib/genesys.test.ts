import { describe, it, expect } from "vitest";
import { extractUrls, batchStatus, batchResultItems, isBatchComplete, batchErrorMessages } from "./genesys";

describe("extractUrls", () => {
  it("picks downloadUri/mediaUri/resultUrl at top level", () => {
    expect(extractUrls({ downloadUri: "a" })).toEqual(["a"]);
    expect(extractUrls({ mediaUri: "b" })).toEqual(["b"]);
    expect(extractUrls({ resultUrl: "c" })).toEqual(["c"]);
  });

  it("walks mediaUris array and object forms", () => {
    expect(extractUrls({ mediaUris: [{ mediaUri: "x" }, { downloadUri: "y" }] })).toEqual(["x", "y"]);
    expect(extractUrls({ mediaUris: { audio: { downloadUri: "z" } } })).toEqual(["z"]);
  });

  it("recurses into nested recording", () => {
    expect(extractUrls({ recording: { downloadUri: "nested" } })).toEqual(["nested"]);
  });

  it("dedupes and ignores non-string/empty", () => {
    expect(extractUrls({ downloadUri: "dup", mediaUris: [{ mediaUri: "dup" }, { mediaUri: "" }] })).toEqual(["dup"]);
    expect(extractUrls(null)).toEqual([]);
    expect(extractUrls("nope")).toEqual([]);
  });

  it("picks resultUrl (batch result item)", () => {
    expect(extractUrls({ conversationId: "c", recordingId: "r", resultUrl: "https://x" })).toEqual(["https://x"]);
  });
});

describe("batchStatus", () => {
  it("reads status/state/processingStatus, uppercased", () => {
    expect(batchStatus({ status: "complete" })).toBe("COMPLETE");
    expect(batchStatus({ state: "Processing" })).toBe("PROCESSING");
    expect(batchStatus({ processingStatus: "failed" })).toBe("FAILED");
    expect(batchStatus({})).toBe("");
  });
});

describe("batchResultItems", () => {
  it("returns the first present array among results/entities/recordings", () => {
    expect(batchResultItems({ results: [{ id: "a" }, null, "x"] })).toEqual([{ id: "a" }]);
    expect(batchResultItems({ entities: [{ id: "b" }] })).toEqual([{ id: "b" }]);
    expect(batchResultItems({})).toEqual([]);
  });
});

describe("isBatchComplete", () => {
  it("is done when resultCount reaches expectedResultCount", () => {
    expect(isBatchComplete({ expectedResultCount: 2, resultCount: 2, results: [] })).toBe(true);
    expect(isBatchComplete({ expectedResultCount: 2, resultCount: 1, results: [{ resultUrl: "u" }] })).toBe(false);
    expect(isBatchComplete({ expectedResultCount: 0, resultCount: 0 })).toBe(true); // 녹취 없음 → 즉시 완료
  });

  it("honors an explicit done status", () => {
    expect(isBatchComplete({ status: "COMPLETED" })).toBe(true);
  });

  it("falls back to per-item resolution when counts are absent", () => {
    expect(isBatchComplete({ results: [{ resultUrl: "u" }, { errorMsg: "no recording" }] })).toBe(true);
    expect(isBatchComplete({ results: [{ resultUrl: "u" }, { recordingId: "r" }] })).toBe(false); // 미결 1건
    expect(isBatchComplete({})).toBe(false);
  });
});

describe("batchErrorMessages", () => {
  it("collects non-empty errorMsg strings", () => {
    expect(batchErrorMessages([{ errorMsg: "boom" }, { resultUrl: "u" }, { errorMsg: "" }])).toEqual(["boom"]);
    expect(batchErrorMessages([])).toEqual([]);
  });
});

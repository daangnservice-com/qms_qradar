import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./evalResultStore", () => ({
  getLatestStoredTranscript: vi.fn(),
  listStoredTranscriptVersions: vi.fn(),
  getStoredTranscriptByAnalysisId: vi.fn(),
}));
vi.mock("./sttBatchStore", () => ({
  getLatestBatchTranscript: vi.fn(),
  listBatchTranscriptVersions: vi.fn(),
  saveSttBatchTranscript: vi.fn(),
}));
vi.mock("./audio", () => ({ saveTempFile: vi.fn(), cleanupTempFile: vi.fn() }));
vi.mock("./genesys", () => ({ getConversationAudioUrl: vi.fn(), downloadAudio: vi.fn() }));
vi.mock("./stt", () => ({
  STT_CHANNEL_COUNT: 2,
  STT_LANG: "ko-KR",
  STT_MODEL: "latest_long",
  transcribeCall: vi.fn(),
}));
vi.mock("./sttCallLog", () => ({ logSttCall: vi.fn() }));
vi.mock("./sttSpeaker", () => ({ sttSegmentsToTranscript: vi.fn() }));

import {
  getLatestStoredTranscript,
  listStoredTranscriptVersions,
  getStoredTranscriptByAnalysisId,
} from "./evalResultStore";
import { getLatestBatchTranscript, listBatchTranscriptVersions } from "./sttBatchStore";
import {
  getObserveTranscript,
  getObserveTranscriptByVersion,
  loadObserveTranscriptCatalog,
} from "./observeStt";
import { BATCH_STT_VERSION_ID, batchSttVersionId, evalSttVersionId } from "./callArtifactVersions";

const getStored = getLatestStoredTranscript as unknown as ReturnType<typeof vi.fn>;
const listStored = listStoredTranscriptVersions as unknown as ReturnType<typeof vi.fn>;
const getById = getStoredTranscriptByAnalysisId as unknown as ReturnType<typeof vi.fn>;
const getBatch = getLatestBatchTranscript as unknown as ReturnType<typeof vi.fn>;
const listBatch = listBatchTranscriptVersions as unknown as ReturnType<typeof vi.fn>;

const segs = [{ atSec: 0, speaker: "상담원", text: "안녕하세요" }];
const other = [{ atSec: 0, speaker: "상담원", text: "다른 전사입니다" }];

beforeEach(() => {
  vi.clearAllMocks();
  getStored.mockResolvedValue(null);
  listStored.mockResolvedValue([]);
  getById.mockResolvedValue(null);
  getBatch.mockResolvedValue(null);
  listBatch.mockResolvedValue([]);
});

describe("getObserveTranscript", () => {
  it("picks the newer of eval-stored vs batch STT", async () => {
    getStored.mockResolvedValue({
      conversationId: "c1",
      analysisId: "a-old",
      analyzedAt: "2026-09-17T00:00:00.000Z",
      durationSec: 10,
      transcript: segs,
      sttSource: "gcp",
    });
    getBatch.mockResolvedValue({
      conversationId: "c1",
      analysisId: "stt-batch:c1",
      analyzedAt: "2026-09-18T00:00:00.000Z",
      durationSec: 10,
      transcript: other,
    });
    const latest = await getObserveTranscript("c1");
    expect(latest?.sttSource).toBe("local");
    expect(latest?.transcript).toEqual(other);
    expect(latest?.versionId).toBe(BATCH_STT_VERSION_ID);
  });
});

describe("loadObserveTranscriptCatalog", () => {
  it("dedupes identical transcripts and lists distinct versions newest first", async () => {
    listStored.mockResolvedValue([
      {
        conversationId: "c1",
        analysisId: "a2",
        analyzedAt: "2026-09-18T03:00:00.000Z",
        durationSec: 12,
        transcript: segs,
        sttSource: "gcp",
      },
      {
        conversationId: "c1",
        analysisId: "a1",
        analyzedAt: "2026-09-17T03:00:00.000Z",
        durationSec: 12,
        transcript: segs,
        sttSource: "gcp",
      },
    ]);
    listBatch.mockResolvedValue([
      {
        versionId: BATCH_STT_VERSION_ID,
        conversationId: "c1",
        analysisId: "stt-batch:c1",
        analyzedAt: "2026-09-16T03:00:00.000Z",
        durationSec: 11,
        transcript: other,
        remoteJobId: null,
      },
    ]);
    const catalog = await loadObserveTranscriptCatalog("c1");
    expect(catalog.versions.map((v) => v.versionId)).toEqual([
      evalSttVersionId("a2"),
      BATCH_STT_VERSION_ID,
    ]);
    const loaded = await getObserveTranscriptByVersion("c1");
    expect(loaded?.result.versionId).toBe(evalSttVersionId("a2"));
    const picked = await getObserveTranscriptByVersion("c1", BATCH_STT_VERSION_ID);
    expect(picked?.result.transcript).toEqual(other);
  });

  it("keeps an older local transcript beside the latest one", async () => {
    const older = [{ atSec: 8, speaker: "상담원", text: "예전 시계" }];
    listBatch.mockResolvedValue([
      {
        versionId: BATCH_STT_VERSION_ID,
        conversationId: "c1",
        analysisId: "stt-batch:new",
        analyzedAt: "2026-09-18T03:00:00.000Z",
        durationSec: 30,
        transcript: other,
        remoteJobId: "new",
      },
      {
        versionId: batchSttVersionId("old"),
        conversationId: "c1",
        analysisId: "stt-batch:old",
        analyzedAt: "2026-09-16T03:00:00.000Z",
        durationSec: 12,
        transcript: older,
        remoteJobId: "old",
      },
    ]);
    const catalog = await loadObserveTranscriptCatalog("c1");
    expect(catalog.versions.map((v) => v.versionId)).toEqual([
      BATCH_STT_VERSION_ID,
      batchSttVersionId("old"),
    ]);
    const picked = await getObserveTranscriptByVersion("c1", batchSttVersionId("old"));
    expect(picked?.result.transcript).toEqual(older);
  });
});

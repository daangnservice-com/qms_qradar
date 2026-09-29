import { saveTempFile, cleanupTempFile } from "./audio";
import {
  analyzedAtMs,
  analysisIdFromSttVersionId,
  BATCH_STT_VERSION_ID,
  evalSttVersionId,
  isBatchSttVersionId,
  mergeSttVersions,
  transcriptFingerprint,
  type CallSttVersionSummary,
  type SttVersionCandidate,
} from "./callArtifactVersions";
import {
  getLatestStoredTranscript,
  getStoredTranscriptByAnalysisId,
  listStoredTranscriptVersions,
} from "./evalResultStore";
import { getLatestBatchTranscript, listBatchTranscriptVersions, saveSttBatchTranscript } from "./sttBatchStore";
import { getConversationAudioUrl, downloadAudio } from "./genesys";
import { STT_CHANNEL_COUNT, STT_LANG, STT_MODEL, transcribeCall } from "./stt";
import { logSttCall } from "./sttCallLog";
import { sttSegmentsToTranscript } from "./sttSpeaker";
import type { SttSource, TranscriptSegment } from "./types";

export type ObserveSttStep = "genesys" | "download" | "transcode" | "transcribe" | "save";

export type ObserveSttResult = {
  conversationId: string;
  durationSec: number;
  transcript: TranscriptSegment[];
  sttSource: SttSource;
  sttReused: boolean;
  versionId?: string;
};

export type ObserveSttEvent =
  | { type: "progress"; step: ObserveSttStep; elapsedMs: number }
  | { type: "heartbeat"; elapsedMs: number }
  | { type: "result"; result: ObserveSttResult }
  | { type: "error"; message: string };

function durationFromTranscript(segments: TranscriptSegment[]): number {
  let max = 0;
  for (const s of segments) {
    const at = Number(s.atSec ?? 0);
    if (at > max) max = at;
  }
  return max;
}

function toObserveResult(input: {
  conversationId: string;
  durationSec: number;
  transcript: TranscriptSegment[];
  sttSource: SttSource | null;
  versionId: string;
  fallbackSource: SttSource;
}): ObserveSttResult {
  return {
    conversationId: input.conversationId,
    durationSec: input.durationSec || durationFromTranscript(input.transcript),
    transcript: input.transcript,
    sttSource: input.sttSource ?? input.fallbackSource,
    sttReused: true,
    versionId: input.versionId,
  };
}

export type ObserveTranscriptCatalog = {
  versions: CallSttVersionSummary[];
  byId: Map<string, ObserveSttResult>;
};

/** 평가 저장분 + 로컬 배치 전사를 모아 동일 원문은 최신 1개만 남긴다. */
export async function loadObserveTranscriptCatalog(conversationId: string): Promise<ObserveTranscriptCatalog> {
  const cid = conversationId.trim();
  const empty: ObserveTranscriptCatalog = { versions: [], byId: new Map() };
  if (!cid) return empty;

  const [storedList, batches] = await Promise.all([
    listStoredTranscriptVersions(cid),
    listBatchTranscriptVersions(cid),
  ]);

  const candidates: SttVersionCandidate[] = [];
  const rawById = new Map<string, ObserveSttResult>();

  for (const row of storedList) {
    if (!row.transcript.length || !row.analysisId) continue;
    const versionId = evalSttVersionId(row.analysisId);
    candidates.push({
      versionId,
      analyzedAt: row.analyzedAt,
      sttSource: row.sttSource,
      segmentCount: row.transcript.length,
      durationSec: row.durationSec || durationFromTranscript(row.transcript),
      origin: "eval",
      analysisId: row.analysisId,
      fingerprint: transcriptFingerprint(row.transcript),
    });
    rawById.set(
      versionId,
      toObserveResult({
        conversationId: cid,
        durationSec: row.durationSec,
        transcript: row.transcript,
        sttSource: row.sttSource,
        versionId,
        fallbackSource: "gcp",
      }),
    );
  }

  for (const batch of batches) {
    if (!batch.transcript.length) continue;
    candidates.push({
      versionId: batch.versionId,
      analyzedAt: batch.analyzedAt,
      sttSource: "local",
      segmentCount: batch.transcript.length,
      durationSec: batch.durationSec || durationFromTranscript(batch.transcript),
      origin: "batch",
      analysisId: batch.analysisId,
      fingerprint: transcriptFingerprint(batch.transcript),
    });
    rawById.set(
      batch.versionId,
      toObserveResult({
        conversationId: cid,
        durationSec: batch.durationSec,
        transcript: batch.transcript,
        sttSource: "local",
        versionId: batch.versionId,
        fallbackSource: "local",
      }),
    );
  }

  const versions = mergeSttVersions(candidates);
  const byId = new Map<string, ObserveSttResult>();
  for (const v of versions) {
    const payload = rawById.get(v.versionId);
    if (payload) byId.set(v.versionId, { ...payload, versionId: v.versionId, sttSource: v.sttSource ?? payload.sttSource });
  }
  return { versions, byId };
}

export async function getObserveTranscriptByVersion(
  conversationId: string,
  versionId?: string | null,
): Promise<{ result: ObserveSttResult; versions: CallSttVersionSummary[] } | null> {
  const cid = conversationId.trim();
  if (!cid) return null;
  const catalog = await loadObserveTranscriptCatalog(cid);
  if (!catalog.versions.length) return null;
  const wanted = (versionId ?? "").trim() || catalog.versions[0].versionId;
  let result = catalog.byId.get(wanted) ?? null;
  if (!result) {
    const analysisId = analysisIdFromSttVersionId(wanted);
    if (analysisId) {
      const row = await getStoredTranscriptByAnalysisId(analysisId);
      if (row?.transcript.length && row.conversationId === cid) {
        result = toObserveResult({
          conversationId: cid,
          durationSec: row.durationSec,
          transcript: row.transcript,
          sttSource: row.sttSource,
          versionId: evalSttVersionId(row.analysisId),
          fallbackSource: "gcp",
        });
      }
    } else if (isBatchSttVersionId(wanted)) {
      const batch = (await listBatchTranscriptVersions(cid)).find((v) => v.versionId === wanted);
      if (batch?.transcript.length) {
        result = toObserveResult({
          conversationId: cid,
          durationSec: batch.durationSec,
          transcript: batch.transcript,
          sttSource: "local",
          versionId: batch.versionId,
          fallbackSource: "local",
        });
      }
    }
  }
  if (!result) return null;
  return { result, versions: catalog.versions };
}

/** 저장된 STT(평가·배치)가 있으면 반환. 시각이 더 최근인 쪽을 고른다. */
export async function getObserveTranscript(conversationId: string): Promise<ObserveSttResult | null> {
  const cid = conversationId.trim();
  if (!cid) return null;

  const [stored, batch] = await Promise.all([
    getLatestStoredTranscript(cid),
    getLatestBatchTranscript(cid),
  ]);

  const storedOk = Boolean(stored?.transcript.length);
  const batchOk = Boolean(batch?.transcript.length);
  const useBatch =
    batchOk &&
    (!storedOk || analyzedAtMs(batch?.analyzedAt) > analyzedAtMs(stored?.analyzedAt));

  if (useBatch && batch) {
    return toObserveResult({
      conversationId: cid,
      durationSec: batch.durationSec,
      transcript: batch.transcript,
      sttSource: "local",
      versionId: BATCH_STT_VERSION_ID,
      fallbackSource: "local",
    });
  }
  if (storedOk && stored) {
    return toObserveResult({
      conversationId: cid,
      durationSec: stored.durationSec,
      transcript: stored.transcript,
      sttSource: stored.sttSource,
      versionId: stored.analysisId ? evalSttVersionId(stored.analysisId) : evalSttVersionId("stored"),
      fallbackSource: "gcp",
    });
  }
  return null;
}

/** Genesys 녹취 → GCP STT → 로컬 배치 전사 저장. 기존 전사가 있으면 재활용. */
export async function runObserveStt(input: {
  conversationId: string;
  force?: boolean;
  onProgress?: (step: ObserveSttStep, elapsedMs: number) => void;
}): Promise<ObserveSttResult> {
  const cid = input.conversationId.trim();
  if (!cid) throw new Error("conversationId가 필요합니다.");

  const t0 = Date.now();
  const progress = (step: ObserveSttStep) => input.onProgress?.(step, Date.now() - t0);

  if (!input.force) {
    const existing = await getObserveTranscript(cid);
    if (existing) return existing;
  }

  progress("genesys");
  const url = await getConversationAudioUrl(cid);
  progress("download");
  const { bytes } = await downloadAudio(url);
  progress("transcode");
  const srcPath = await saveTempFile(bytes, ".audio");
  const tStt0 = Date.now();
  try {
    progress("transcribe");
    const out = await transcribeCall(srcPath);
    const transcript = sttSegmentsToTranscript(out.segments);
    if (!transcript.length) throw new Error("전사(STT) 결과가 비어 있어요.");
    const durationSec = Math.max(out.durationSec, durationFromTranscript(transcript));
    void logSttCall({
      purpose: "call_eval",
      conversationId: cid,
      model: out.model,
      language: out.language,
      channelCount: out.channelCount,
      audioDurationSec: durationSec,
      segmentCount: out.segments.length,
      latencyMs: Date.now() - tStt0,
    });
    progress("save");
    await saveSttBatchTranscript({
      conversationId: cid,
      durationSec,
      remoteJobId: null,
      transcript,
    });
    return {
      conversationId: cid,
      durationSec,
      transcript,
      sttSource: "gcp",
      sttReused: false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void logSttCall({
      purpose: "call_eval",
      conversationId: cid,
      model: STT_MODEL,
      language: STT_LANG,
      channelCount: STT_CHANNEL_COUNT,
      audioDurationSec: 0,
      segmentCount: 0,
      latencyMs: Date.now() - tStt0,
      error: message.startsWith("전사(STT)") ? message : `전사(STT) 실패: ${message}`,
    });
    throw e;
  } finally {
    await cleanupTempFile(srcPath);
  }
}

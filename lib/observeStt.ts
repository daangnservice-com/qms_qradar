import { saveTempFile, cleanupTempFile } from "./audio";
import { getLatestStoredTranscript } from "./evalResultStore";
import { getLatestBatchTranscript, saveSttBatchTranscript } from "./sttBatchStore";
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

/** 저장된 STT(평가·배치)가 있으면 반환. */
export async function getObserveTranscript(conversationId: string): Promise<ObserveSttResult | null> {
  const cid = conversationId.trim();
  if (!cid) return null;

  const stored = await getLatestStoredTranscript(cid);
  if (stored?.transcript.length) {
    return {
      conversationId: cid,
      durationSec: stored.durationSec || durationFromTranscript(stored.transcript),
      transcript: stored.transcript,
      sttSource: stored.sttSource ?? "gcp",
      sttReused: true,
    };
  }

  const batch = await getLatestBatchTranscript(cid);
  if (batch?.transcript.length) {
    return {
      conversationId: cid,
      durationSec: batch.durationSec || durationFromTranscript(batch.transcript),
      transcript: batch.transcript,
      sttSource: "local",
      sttReused: true,
    };
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

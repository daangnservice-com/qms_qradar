import { randomUUID } from "node:crypto";
import { SpeechClient, v2 } from "@google-cloud/speech";
import type { Bucket } from "@google-cloud/storage";
import { ensureGcsBucket, FEEDBACK_BUCKET, getStorage } from "./storage";
import { appBq } from "./bqRefs";
import { gcpAdcPreferredAuth } from "./gcpCredentials";
import { transcodeToWav, cleanupTempFile } from "./audio";
import type { SttSegment } from "./sttSpeaker";

export { DEFAULT_AGENT_CHANNEL_TAG, mapSpeaker, type SttSegment } from "./sttSpeaker";

// 콜 오디오를 Google Cloud Speech-to-Text로 전사한다.
// - 기본: v1 longRunningRecognize(GCS 입력)
// - 선택: v2 batchRecognize + DYNAMIC_BATCHING(저비용, 고지연)
// - 듀얼채널: Genesys 녹취는 상담원/고객이 좌우 채널로 분리됨 → 채널별 인식 사용
// - 텍스트는 각 result의 transcript, 타임스탬프는 첫/마지막 word 기준, 화자는 channelTag.
// 인증: ADC 우선(gcpAdcPreferredAuth). GCS 업로드만 SA JSON. ⚠️ Cloud Speech API 활성화 필요.
const PROJECT_ID = appBq.projectId;
const STT_BUCKET = process.env.STT_TEMP_BUCKET ?? FEEDBACK_BUCKET;
export const STT_MODEL = process.env.STT_MODEL ?? "latest_long";
export const STT_LANG = process.env.STT_LANGUAGE ?? "ko-KR";
export const STT_CHANNEL_COUNT = 2;
export const STT_API_VERSION = process.env.STT_API_VERSION ?? "v1";
export const STT_V2_LOCATION = process.env.STT_V2_LOCATION ?? "global";
export const STT_V2_RECOGNIZER = process.env.STT_V2_RECOGNIZER ?? "_";
export const STT_V2_DYNAMIC_BATCH = process.env.STT_V2_DYNAMIC_BATCH !== "0";

export type SttRawResult = { transcript: string; startSec: number; endSec: number; speakerTag: number };

export type TranscribeOutcome = {
  segments: SttSegment[];
  durationSec: number;
  channelCount: number;
  model: string;
  language: string;
};

let _client: SpeechClient | null = null;
function getSpeech(): SpeechClient {
  if (!_client) {
    _client = new SpeechClient({
      projectId: PROJECT_ID,
      ...gcpAdcPreferredAuth(),
    });
  }
  return _client;
}

let _clientV2: v2.SpeechClient | null = null;
function getSpeechV2(): v2.SpeechClient {
  if (!_clientV2) {
    _clientV2 = new v2.SpeechClient({
      projectId: PROJECT_ID,
      ...gcpAdcPreferredAuth(),
    });
  }
  return _clientV2;
}

function durToSec(d?: { seconds?: number | string | null; nanos?: number | null } | null): number {
  if (!d) return 0;
  return Number(d.seconds ?? 0) + Number(d.nanos ?? 0) / 1e9;
}

export function resultsToSegments(results: SttRawResult[]): SttSegment[] {
  return results
    .map((r) => ({ atSec: r.startSec, endSec: r.endSec, speakerTag: r.speakerTag, text: r.transcript.trim() }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.atSec - b.atSec);
}

function recognizerPath(): string {
  return `projects/${PROJECT_ID}/locations/${STT_V2_LOCATION}/recognizers/${STT_V2_RECOGNIZER}`;
}

async function prepareSttUpload(sourcePath: string): Promise<{
  stereoWav: string;
  bucket: Bucket;
  dest: string;
  gcsUri: string;
}> {
  const stereoWav = await transcodeToWav(sourcePath, STT_CHANNEL_COUNT);
  const dest = `call-stt/${randomUUID()}.wav`;
  await ensureGcsBucket(STT_BUCKET);
  const bucket = getStorage().bucket(STT_BUCKET);
  await bucket.upload(stereoWav, { destination: dest, resumable: false });
  return {
    stereoWav,
    bucket,
    dest,
    gcsUri: `gs://${STT_BUCKET}/${dest}`,
  };
}

function normalizeOutcome(results: SttRawResult[], model: string): TranscribeOutcome {
  const segments = resultsToSegments(results);
  const durationSec = segments.reduce((m, s) => Math.max(m, s.endSec), 0);
  return {
    segments,
    durationSec,
    channelCount: STT_CHANNEL_COUNT,
    model,
    language: STT_LANG,
  };
}

async function transcribeCallV1(gcsUri: string): Promise<TranscribeOutcome> {
  const [operation] = await getSpeech().longRunningRecognize({
    audio: { uri: gcsUri },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      audioChannelCount: STT_CHANNEL_COUNT,
      enableSeparateRecognitionPerChannel: true,
      languageCode: STT_LANG,
      enableWordTimeOffsets: true,
      model: STT_MODEL,
    },
  });
  const [response] = await operation.promise();

  type Dur = { seconds?: number | string | null; nanos?: number | null } | null;
  const results = (response.results ?? []) as {
    channelTag?: number | null;
    alternatives?: { transcript?: string | null; words?: { startTime?: Dur; endTime?: Dur }[] }[];
  }[];

  const norm: SttRawResult[] = results.map((r) => {
    const alt = r.alternatives?.[0];
    const words = alt?.words ?? [];
    const first = words[0];
    const last = words[words.length - 1];
    return {
      transcript: String(alt?.transcript ?? ""),
      startSec: first ? durToSec(first.startTime) : 0,
      endSec: last ? durToSec(last.endTime) : 0,
      speakerTag: Number(r.channelTag ?? 0),
    };
  });
  return normalizeOutcome(norm, STT_MODEL);
}

async function transcribeCallV2(gcsUri: string): Promise<TranscribeOutcome> {
  const request = {
    recognizer: recognizerPath(),
    config: {
      autoDecodingConfig: {},
      languageCodes: [STT_LANG],
      model: STT_MODEL,
      features: {
        enableWordTimeOffsets: true,
        multiChannelMode: "SEPARATE_RECOGNITION_PER_CHANNEL",
      },
    },
    files: [{ uri: gcsUri }],
    recognitionOutputConfig: {
      inlineResponseConfig: {},
    },
    ...(STT_V2_DYNAMIC_BATCH ? { processingStrategy: "DYNAMIC_BATCHING" } : {}),
  };
  const [operation] = await getSpeechV2().batchRecognize(request as never);
  const [response] = await operation.promise();

  const byFile = (response.results ?? {}) as Record<
    string,
    {
      inlineResult?: {
        transcript?: {
          results?: Array<{
            alternatives?: Array<{
              transcript?: string | null;
              words?: Array<{
                startOffset?: { seconds?: number | string | null; nanos?: number | null } | null;
                endOffset?: { seconds?: number | string | null; nanos?: number | null } | null;
              }>;
            }>;
            channelTag?: number | null;
            resultEndOffset?: { seconds?: number | string | null; nanos?: number | null } | null;
          }>;
        };
      };
      transcript?: {
        results?: Array<{
          alternatives?: Array<{
            transcript?: string | null;
            words?: Array<{
              startOffset?: { seconds?: number | string | null; nanos?: number | null } | null;
              endOffset?: { seconds?: number | string | null; nanos?: number | null } | null;
            }>;
          }>;
          channelTag?: number | null;
          resultEndOffset?: { seconds?: number | string | null; nanos?: number | null } | null;
        }>;
      };
    }
  >;
  const fileResult = byFile[gcsUri];
  const transcript = fileResult?.inlineResult?.transcript ?? fileResult?.transcript;
  const results = transcript?.results ?? [];

  const norm: SttRawResult[] = results.map((r) => {
    const alt = r.alternatives?.[0];
    const words = alt?.words ?? [];
    const first = words[0];
    const last = words[words.length - 1];
    return {
      transcript: String(alt?.transcript ?? ""),
      startSec: first ? durToSec(first.startOffset) : 0,
      endSec: last ? durToSec(last.endOffset) : durToSec(r.resultEndOffset),
      speakerTag: Number(r.channelTag ?? 0),
    };
  });
  return normalizeOutcome(norm, `${STT_MODEL} (v2${STT_V2_DYNAMIC_BATCH ? ":dynamic_batch" : ""})`);
}

/** 소스 오디오 → 스테레오 wav → GCS → 선택된 STT(v1/v2) 실행. */
export async function transcribeCall(sourcePath: string): Promise<TranscribeOutcome> {
  const { stereoWav, bucket, dest, gcsUri } = await prepareSttUpload(sourcePath);

  try {
    if (STT_API_VERSION === "v2_dynamic_batch" || STT_API_VERSION === "v2") {
      return await transcribeCallV2(gcsUri);
    }
    return await transcribeCallV1(gcsUri);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/bucket does not exist/i.test(msg)) {
      throw new Error(
        `${msg} (STT 버킷: ${STT_BUCKET}. .env에 STT_TEMP_BUCKET 또는 GCS_FEEDBACK_BUCKET으로 기존 버킷을 지정하거나, 해당 프로젝트에 버킷 생성 권한이 필요합니다.)`,
      );
    }
    throw e;
  } finally {
    await bucket
      .file(dest)
      .delete()
      .catch(() => {});
    await cleanupTempFile(stereoWav);
  }
}

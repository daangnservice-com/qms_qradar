import { randomUUID } from "node:crypto";
import { SpeechClient } from "@google-cloud/speech";
import { getStorage } from "./storage";
import { transcodeToWav, cleanupTempFile } from "./audio";

// 콜 오디오를 Google Cloud Speech-to-Text로 전사한다.
// - 긴 통화는 동기 한도(~1분)를 넘어 longRunningRecognize(GCS 입력) 사용 → 스테레오 WAV를 GCS에 잠깐 올리고 끝나면 삭제.
// - 듀얼채널: Genesys 녹취는 상담원/고객이 좌우 채널로 분리됨 → enableSeparateRecognitionPerChannel로 채널별 인식(=화자 분리).
// - 텍스트는 각 result의 클린 transcript, 타임스탬프는 words[0], 화자는 channelTag.
// 인증: GOOGLE_SERVICE_ACCOUNT_JSON(서비스계정 키) 우선, 없으면 ADC. ⚠️ Cloud Speech API 활성화 + SA 권한 필요.
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID ?? "striped-option-493506-a7";
const STT_BUCKET = process.env.STT_TEMP_BUCKET ?? process.env.GCS_FEEDBACK_BUCKET ?? "striped-option-493506-a7-helpdesk-x-feedback";
const STT_MODEL = process.env.STT_MODEL ?? "latest_long"; // 한국어 정확도 좋은 최신 모델. env로 변경 가능
const STT_LANG = process.env.STT_LANGUAGE ?? "ko-KR";

export type SttSegment = { atSec: number; endSec: number; speakerTag: number; text: string };
export type SttRawResult = { transcript: string; startSec: number; endSec: number; speakerTag: number };

let _client: SpeechClient | null = null;
function getSpeech(): SpeechClient {
  if (!_client) {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    _client = new SpeechClient({
      projectId: PROJECT_ID,
      ...(saJson ? { credentials: JSON.parse(saJson) } : {}),
    });
  }
  return _client;
}

function durToSec(d?: { seconds?: number | string | null; nanos?: number | null } | null): number {
  if (!d) return 0;
  return Number(d.seconds ?? 0) + Number(d.nanos ?? 0) / 1e9;
}

// STT result별 클린 transcript + 시작 시각으로 세그먼트 구성(순수 함수). 채널이 섞여 오므로 시각순 정렬.
export function resultsToSegments(results: SttRawResult[]): SttSegment[] {
  return results
    .map((r) => ({ atSec: r.startSec, endSec: r.endSec, speakerTag: r.speakerTag, text: r.transcript.trim() }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.atSec - b.atSec);
}

// STT 화자 태그(=채널) → 표시 라벨. Gemini가 판별한 상담원 태그(agentTag) 기준.
export function mapSpeaker(speakerTag: number, agentTag: number | null): string {
  if (agentTag != null) return speakerTag === agentTag ? "상담원" : "고객";
  return `화자 ${speakerTag}`;
}

// 소스 오디오를 스테레오 wav로 변환 → GCS 업로드 → 듀얼채널 STT. 끝나면 GCS·임시파일 삭제. 실패 시 throw(호출부 폴백).
export async function transcribeCall(sourcePath: string): Promise<SttSegment[]> {
  const stereoWav = await transcodeToWav(sourcePath, 2);
  const dest = `call-stt/${randomUUID()}.wav`;
  const bucket = getStorage().bucket(STT_BUCKET);

  try {
    await bucket.upload(stereoWav, { destination: dest, resumable: false });
    const gcsUri = `gs://${STT_BUCKET}/${dest}`;

    const [operation] = await getSpeech().longRunningRecognize({
      audio: { uri: gcsUri },
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        audioChannelCount: 2,
        enableSeparateRecognitionPerChannel: true, // 채널별 인식 = 상담원/고객 분리
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
        speakerTag: Number(r.channelTag ?? 0), // 채널 = 화자
      };
    });
    return resultsToSegments(norm);
  } finally {
    await bucket
      .file(dest)
      .delete()
      .catch(() => {}); // 처리 후 즉시 삭제(영구 저장 X)
    await cleanupTempFile(stereoWav);
  }
}

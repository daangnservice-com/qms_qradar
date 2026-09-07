import { maskPII } from "./pii";
import type { TranscriptSegment } from "./types";

export type SttSegment = { atSec: number; endSec: number; speakerTag: number; text: string };

export function mapSpeaker(speakerTag: number, agentTag: number | null): string {
  if (agentTag != null) return speakerTag === agentTag ? "상담원" : "고객";
  return `화자 ${speakerTag}`;
}

/** Genesys 듀얼채널 GCP STT: channelTag 1 = 상담원 (LLM agentSpeakerTag 판별 전 폴백) */
export const DEFAULT_AGENT_CHANNEL_TAG = 1;

/** STT/UI에서 상담원(우측) 버블로 그릴 화자 라벨인지 */
export function isAgentSpeakerLabel(speaker: string): boolean {
  const s = speaker.trim();
  if (/상담|agent|상담사/i.test(s)) return true;
  // observe STT 초기 버전: agentTag 없이 "화자 N"만 저장됐을 때 채널 1 = 상담원
  if (/^화자\s*1$/i.test(s)) return true;
  return false;
}

/** STT 세그먼트 → 저장/표시용 transcript (듀얼채널 기본: tag 1 = 상담원) */
export function sttSegmentsToTranscript(
  segments: SttSegment[],
  agentTag: number | null = DEFAULT_AGENT_CHANNEL_TAG,
): TranscriptSegment[] {
  const diarized = new Set(segments.map((s) => s.speakerTag)).size > 1;
  return segments.map((s) => ({
    atSec: s.atSec,
    speaker: diarized ? mapSpeaker(s.speakerTag, agentTag) : "",
    text: maskPII(s.text),
  }));
}

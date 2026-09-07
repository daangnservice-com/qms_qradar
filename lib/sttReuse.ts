import type { SttSegment } from "./sttSpeaker";
import type { TranscriptSegment } from "./types";

/** 저장된 화자 라벨 → STT speakerTag. 상담원=1, 고객=2, "화자 N"=N, 그 외=1 */
export function speakerLabelToTag(speaker: string): number {
  const s = speaker.trim();
  if (s === "상담원") return 1;
  if (s === "고객") return 2;
  const m = /^화자\s*(\d+)$/i.exec(s);
  if (m) return Math.max(1, Number(m[1]) || 1);
  return 1;
}

/**
 * 저장된 transcript → STT 세그먼트.
 * endSec는 다음 발화 시작(또는 durationSec)으로 추정한다.
 */
export function transcriptToSttSegments(
  transcript: TranscriptSegment[],
  durationSec = 0,
): SttSegment[] {
  const segs = transcript.filter((t) => (t.text ?? "").trim().length > 0);
  return segs.map((t, i) => {
    const atSec = Number(t.atSec) || 0;
    const nextAt = i + 1 < segs.length ? Number(segs[i + 1].atSec) || 0 : durationSec;
    let endSec = nextAt > atSec ? nextAt : atSec + Math.max(0.4, (t.text?.length ?? 0) * 0.08);
    if (durationSec > 0 && endSec > durationSec) endSec = durationSec;
    if (endSec <= atSec) endSec = atSec + 0.4;
    return {
      atSec,
      endSec,
      speakerTag: speakerLabelToTag(t.speaker ?? ""),
      text: t.text.trim(),
    };
  });
}

export function parseTranscriptJson(raw: string | null | undefined): TranscriptSegment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        const o = x as Record<string, unknown>;
        return {
          atSec: Number(o.atSec ?? o.at_sec ?? 0) || 0,
          speaker: String(o.speaker ?? ""),
          text: String(o.text ?? "").trim(),
        };
      })
      .filter((t) => t.text.length > 0);
  } catch {
    return [];
  }
}

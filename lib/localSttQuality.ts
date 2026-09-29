/**
 * 로컬 STT 세그먼트를 저장·재생하기 전에 정리한다.
 * 클릭 시각은 긴 턴의 시작이 아니라 그 문장의 첫 단어다.
 */

export const LOCAL_STT_HOTWORDS = "당근 당근페이 비즈니스 비즈프로필";
export const LOCAL_STT_HALLUCINATION_SILENCE_SEC = 2;
export const LOCAL_STT_MAX_SEGMENT_SEC = 10;
export const LOCAL_STT_COMPRESSION_RATIO_LIMIT = 2.4;
const PROMPT_ECHO = "통화 녹취";
const AFFIRMATION = /^[네예에요아응어]+$/;
const SENTENCE_END = /[.?!。…]$/;

export type TimedWord = { start: number; end: number; word: string };

export type LocalSttSegmentDetail = {
  atSec: number;
  endSec: number;
  speaker: string;
  text: string;
  avgLogprob: number | null;
  compressionRatio: number | null;
};

export type TimedSttSegment = {
  atSec: number;
  endSec: number;
  text: string;
  avgLogprob: number | null;
  compressionRatio: number | null;
  words: TimedWord[];
  speaker?: string;
  speakerTag?: number;
};

export function seekSecForTranscript(segment: { atSec: number; wordAtSec?: number | null }): number {
  const word = segment.wordAtSec;
  if (typeof word === "number" && Number.isFinite(word) && word >= 0) return word;
  return Number.isFinite(segment.atSec) ? segment.atSec : 0;
}

export function isPromptEcho(text: string): boolean {
  return (text ?? "").includes(PROMPT_ECHO);
}

export function isAffirmationLoop(text: string): boolean {
  const compact = (text ?? "").replace(/[\s,.\u3002!?~…·]+/g, "");
  return compact.length >= 4 && AFFIRMATION.test(compact);
}

export function isHighCompression(ratio: number | null | undefined): boolean {
  return ratio != null && Number.isFinite(ratio) && ratio > LOCAL_STT_COMPRESSION_RATIO_LIMIT;
}

function fromWords(segment: TimedSttSegment, words: TimedWord[]): TimedSttSegment {
  const text = words.map((w) => w.word).join("").trim();
  return {
    ...segment,
    atSec: words[0].start,
    endSec: words[words.length - 1].end,
    text,
    words,
  };
}

export function splitLongSegment(segment: TimedSttSegment, maxSec = LOCAL_STT_MAX_SEGMENT_SEC): TimedSttSegment[] {
  const words = segment.words;
  if (words.length < 2) return [segment];
  const span = words[words.length - 1].end - words[0].start;
  if (span <= maxSec) return [fromWords(segment, words)];

  const pieces: TimedSttSegment[] = [];
  let bucket: TimedWord[] = [];
  let bucketStart = words[0].start;
  const flush = () => {
    if (!bucket.length) return;
    const piece = fromWords(segment, bucket);
    if (piece.text) pieces.push(piece);
    bucket = [];
  };
  for (const word of words) {
    if (!bucket.length) bucketStart = word.start;
    if (bucket.length && word.end - bucketStart > maxSec) {
      flush();
      bucketStart = word.start;
    }
    bucket.push(word);
    const tail = word.word.trim();
    if (bucket.length && SENTENCE_END.test(tail) && word.end - bucketStart >= 4) {
      flush();
    }
  }
  flush();
  return pieces.length ? pieces : [segment];
}

/** 메아리·맞장구 루프·과압축을 버리고, 10초를 넘는 세그먼트는 단어 경계에서 나눈다. */
export function prepareLocalSegments(segments: TimedSttSegment[]): TimedSttSegment[] {
  const prepared: TimedSttSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    if (isPromptEcho(text) || isAffirmationLoop(text) || isHighCompression(segment.compressionRatio)) continue;
    prepared.push(...splitLongSegment({ ...segment, text }));
  }
  return prepared;
}

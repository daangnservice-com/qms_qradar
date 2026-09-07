import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import type { Silence, SilenceSummary } from "./types";

/** 말 겹침 구간 — Silence 와 동일 shape */
export type SpeechOverlap = Silence;

export function parseInputDuration(stderr: string): number {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

export function parseSilenceEvents(stderr: string): { start: number; end: number; durationSec: number }[] {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((m) => ({ end: Number(m[1]), durationSec: Number(m[2]) }));
  const events: { start: number; end: number; durationSec: number }[] = [];
  for (let i = 0; i < starts.length; i++) {
    const e = ends[i];
    if (!e) break; // 미완결(EOF) 이벤트는 무시
    events.push({ start: starts[i], end: e.end, durationSec: e.durationSec });
  }
  return events;
}

export function summarizeSilences(
  events: { start: number; end: number; durationSec: number }[],
  minSilenceSec: number,
  totalDurationSec: number,
): { silences: Silence[]; summary: SilenceSummary } {
  const silences: Silence[] = events
    .filter((e) => e.durationSec >= minSilenceSec)
    .map((e) => ({ startSec: e.start, endSec: e.end, durationSec: e.durationSec }));
  const totalSec = silences.reduce((a, s) => a + s.durationSec, 0);
  const longestSec = silences.reduce((a, s) => Math.max(a, s.durationSec), 0);
  const summary: SilenceSummary = {
    count: silences.length,
    totalSec,
    longestSec,
    silenceRatio: totalDurationSec > 0 ? totalSec / totalDurationSec : 0,
  };
  return { silences, summary };
}

// STT 발화 구간(양 채널 병합)의 사이 = 아무도 말하지 않은 공백. 보류음/배경 노이즈가 있어도 잡힌다.
// spans는 [atSec, endSec) 발화 구간(채널 섞여도 됨). 겹치는 구간을 합집합으로 병합한 뒤 그 사이를 공백으로.
export function computeSpeechGaps(
  spans: { atSec: number; endSec: number }[],
): { start: number; end: number; durationSec: number }[] {
  const valid = spans.filter((s) => s.endSec > s.atSec).sort((a, b) => a.atSec - b.atSec);
  if (!valid.length) return [];
  const gaps: { start: number; end: number; durationSec: number }[] = [];
  let coverEnd = valid[0].endSec;
  for (let i = 1; i < valid.length; i++) {
    const s = valid[i];
    if (s.atSec > coverEnd) {
      gaps.push({ start: coverEnd, end: s.atSec, durationSec: s.atSec - coverEnd });
      coverEnd = s.endSec;
    } else if (s.endSec > coverEnd) {
      coverEnd = s.endSec;
    }
  }
  return gaps;
}

type Interval = { start: number; end: number };

/** silence 이벤트 → [0, duration) 에서의 발화(비무음) 구간 */
export function speechFromSilenceEvents(silences: Interval[], durationSec: number): Interval[] {
  if (durationSec <= 0) return [];
  const sorted = [...silences]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const speech: Interval[] = [];
  let cursor = 0;
  for (const s of sorted) {
    const start = Math.max(0, s.start);
    const end = Math.min(durationSec, s.end);
    if (start > cursor) speech.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < durationSec) speech.push({ start: cursor, end: durationSec });
  return speech.filter((s) => s.end > s.start);
}

/** 겹치는 구간 병합 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** 두 구간 목록의 교집합 */
export function intersectIntervals(a: Interval[], b: Interval[]): { start: number; end: number; durationSec: number }[] {
  const raw: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) raw.push({ start, end });
    }
  }
  return mergeIntervals(raw).map((s) => ({
    start: s.start,
    end: s.end,
    durationSec: s.end - s.start,
  }));
}

/**
 * STT 서로 다른 speakerTag 세그먼트 시간 교집합 = 말 겹침.
 * (듀얼채널 분리 인식 결과에 적합)
 */
export function computeSpeechOverlaps(
  spans: { atSec: number; endSec: number; speakerTag: number }[],
  minOverlapSec = 0.15,
): { start: number; end: number; durationSec: number }[] {
  const byTag = new Map<number, Interval[]>();
  for (const s of spans) {
    if (!(s.endSec > s.atSec)) continue;
    const list = byTag.get(s.speakerTag) ?? [];
    list.push({ start: s.atSec, end: s.endSec });
    byTag.set(s.speakerTag, list);
  }
  const tags = [...byTag.keys()].sort((a, b) => a - b);
  if (tags.length < 2) return [];

  const raw: Interval[] = [];
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const left = mergeIntervals(byTag.get(tags[i])!);
      const right = mergeIntervals(byTag.get(tags[j])!);
      for (const hit of intersectIntervals(left, right)) {
        raw.push({ start: hit.start, end: hit.end });
      }
    }
  }
  return mergeIntervals(raw)
    .map((s) => ({ start: s.start, end: s.end, durationSec: s.end - s.start }))
    .filter((s) => s.durationSec >= minOverlapSec);
}

async function runFfmpegSilenceStderr(
  filePath: string,
  af: string,
): Promise<{ durationSec: number; events: { start: number; end: number; durationSec: number }[] }> {
  const args = ["-i", filePath, "-af", af, "-f", "null", "-"];
  const stderr = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const proc = spawn(ffmpegPath as string, args);
    proc.stderr.on("data", (d) => (buf += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(buf) : reject(new Error(`ffmpeg exited ${code}: ${buf.slice(-500)}`))));
  });
  return { durationSec: parseInputDuration(stderr), events: parseSilenceEvents(stderr) };
}

export async function runSilenceDetection(
  filePath: string,
  opts: { minSilenceSec: number; noiseDb: number },
): Promise<{ durationSec: number; silences: Silence[]; summary: SilenceSummary }> {
  const { durationSec, events } = await runFfmpegSilenceStderr(
    filePath,
    `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minSilenceSec}`,
  );
  const { silences, summary } = summarizeSilences(events, opts.minSilenceSec, durationSec);
  return { durationSec, silences, summary };
}

/**
 * 스테레오 소스에서 좌/우 채널 동시 발화(말 겹침) 구간.
 * 채널별 silencedetect → speech 여집합 → 교집합.
 */
export async function runOverlapDetection(
  filePath: string,
  opts: { noiseDb?: number; minOverlapSec?: number; silenceProbeSec?: number } = {},
): Promise<{ durationSec: number; overlaps: SpeechOverlap[] }> {
  const noiseDb = opts.noiseDb ?? -30;
  const minOverlapSec = opts.minOverlapSec ?? 0.15;
  // 짧은 silence probe 로 speech 경계를 세밀하게
  const d = opts.silenceProbeSec ?? 0.2;
  const [left, right] = await Promise.all([
    runFfmpegSilenceStderr(filePath, `pan=mono|c0=c0,silencedetect=noise=${noiseDb}dB:d=${d}`),
    runFfmpegSilenceStderr(filePath, `pan=mono|c0=c1,silencedetect=noise=${noiseDb}dB:d=${d}`),
  ]);
  const durationSec = Math.max(left.durationSec, right.durationSec);
  const leftSpeech = speechFromSilenceEvents(
    left.events.map((e) => ({ start: e.start, end: e.end })),
    durationSec,
  );
  const rightSpeech = speechFromSilenceEvents(
    right.events.map((e) => ({ start: e.start, end: e.end })),
    durationSec,
  );
  const overlaps = intersectIntervals(leftSpeech, rightSpeech)
    .filter((o) => o.durationSec >= minOverlapSec)
    .map((o) => ({ startSec: o.start, endSec: o.end, durationSec: o.durationSec }));
  return { durationSec, overlaps };
}

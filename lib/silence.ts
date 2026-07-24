import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import type { Silence, SilenceSummary } from "./types";

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

export async function runSilenceDetection(
  filePath: string,
  opts: { minSilenceSec: number; noiseDb: number },
): Promise<{ durationSec: number; silences: Silence[]; summary: SilenceSummary }> {
  const args = ["-i", filePath, "-af", `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minSilenceSec}`, "-f", "null", "-"];
  const stderr = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const proc = spawn(ffmpegPath as string, args);
    proc.stderr.on("data", (d) => (buf += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(buf) : reject(new Error(`ffmpeg exited ${code}: ${buf.slice(-500)}`))));
  });
  const durationSec = parseInputDuration(stderr);
  const events = parseSilenceEvents(stderr);
  const { silences, summary } = summarizeSilences(events, opts.minSilenceSec, durationSec);
  return { durationSec, silences, summary };
}

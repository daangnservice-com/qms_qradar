import { describe, it, expect } from "vitest";
import {
  downmixStereoToMonoWav,
  extractStereoPeaks,
  parseWav,
  wavDurationSec,
} from "./wavPeaks";

/** 16-bit PCM WAV 생성 (리틀엔디안). */
function makeWav(opts: {
  channels: 1 | 2;
  sampleRate?: number;
  samples: number[]; // interleaved int16 values
}): Uint8Array {
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels;
  const dataBytes = opts.samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  dv.setUint32(4, 36 + dataBytes, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * 2, true);
  dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36);
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < opts.samples.length; i++) {
    dv.setInt16(44 + i * 2, opts.samples[i], true);
  }
  return out;
}

describe("parseWav / wavDurationSec", () => {
  it("parses stereo header", () => {
    const wav = makeWav({ channels: 2, samples: [1000, -1000, 2000, -2000] });
    const info = parseWav(wav);
    expect(info.channels).toBe(2);
    expect(info.sampleRate).toBe(16000);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataOffset).toBe(44);
    expect(wavDurationSec(info)).toBeCloseTo(2 / 16000, 6);
  });
});

describe("downmixStereoToMonoWav", () => {
  it("averages L/R", () => {
    const stereo = makeWav({ channels: 2, samples: [1000, 3000, -2000, 2000] });
    const mono = downmixStereoToMonoWav(stereo);
    const info = parseWav(mono);
    expect(info.channels).toBe(1);
    const dv = new DataView(mono.buffer, mono.byteOffset, mono.byteLength);
    expect(dv.getInt16(info.dataOffset, true)).toBe(2000); // (1000+3000)/2
    expect(dv.getInt16(info.dataOffset + 2, true)).toBe(0);
  });

  it("passes through mono", () => {
    const mono = makeWav({ channels: 1, samples: [1, 2, 3] });
    expect(downmixStereoToMonoWav(mono)).toBe(mono);
  });
});

describe("extractStereoPeaks", () => {
  it("separates L/R energy", () => {
    // 8 frames: loud left, quiet right then reverse
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) samples.push(30000, 100);
    for (let i = 0; i < 4; i++) samples.push(100, 30000);
    const wav = makeWav({ channels: 2, samples });
    const { peaksLeft, peaksRight } = extractStereoPeaks(wav, 2);
    expect(peaksLeft).toHaveLength(2);
    expect(peaksRight).toHaveLength(2);
    expect(peaksLeft[0]).toBeGreaterThan(peaksRight[0]);
    expect(peaksRight[1]).toBeGreaterThan(peaksLeft[1]);
  });

  it("duplicates mono into both lanes", () => {
    const wav = makeWav({ channels: 1, samples: [20000, 0, 10000, 0] });
    const { peaksLeft, peaksRight } = extractStereoPeaks(wav, 2);
    expect(peaksLeft).toEqual(peaksRight);
  });
});

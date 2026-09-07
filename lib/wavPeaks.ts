/**
 * PCM WAV(16-bit LE) 파싱 · stereo→mono downmix · L/R peaks.
 * ffmpeg `-ac 2 -ar 16000` 출력을 전제로 하되, 헤더는 일반 RIFF 파싱.
 */

export type WavInfo = {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** PCM 샘플 시작 오프셋 */
  dataOffset: number;
  /** PCM 바이트 수 */
  dataBytes: number;
};

function readU16(view: DataView, o: number): number {
  return view.getUint16(o, true);
}
function readU32(view: DataView, o: number): number {
  return view.getUint32(o, true);
}

export function parseWav(bytes: Uint8Array): WavInfo {
  if (bytes.byteLength < 44) throw new Error("WAV too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF") {
    throw new Error("not RIFF");
  }
  if (String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WAVE") {
    throw new Error("not WAVE");
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataBytes = 0;

  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = readU32(view, offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      // audioFormat = 1 (PCM)
      channels = readU16(view, body + 2);
      sampleRate = readU32(view, body + 4);
      bitsPerSample = readU16(view, body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataBytes = size;
      break;
    }
    offset = body + size + (size % 2); // word-align
  }

  if (dataOffset < 0 || !channels || !sampleRate || bitsPerSample !== 16) {
    throw new Error(`unsupported WAV: ch=${channels} rate=${sampleRate} bits=${bitsPerSample}`);
  }
  return { channels, sampleRate, bitsPerSample, dataOffset, dataBytes };
}

export function wavDurationSec(info: WavInfo): number {
  const bytesPerSample = (info.bitsPerSample / 8) * info.channels;
  if (bytesPerSample <= 0) return 0;
  return info.dataBytes / bytesPerSample / info.sampleRate;
}

/** stereo 16-bit LE → mono WAV(동일 sample rate). mono 입력이면 복사. */
export function downmixStereoToMonoWav(stereo: Uint8Array): Uint8Array {
  const info = parseWav(stereo);
  if (info.channels === 1) return stereo;
  if (info.channels !== 2) throw new Error(`cannot downmix ${info.channels}ch`);

  const frameCount = Math.floor(info.dataBytes / 4); // 2ch × 2 bytes
  const dataBytes = frameCount * 2;
  const out = new Uint8Array(44 + dataBytes);
  const dv = new DataView(out.buffer);

  // Minimal PCM header
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  dv.setUint32(4, 36 + dataBytes, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  out.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, info.sampleRate, true);
  dv.setUint32(28, info.sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36); // data
  dv.setUint32(40, dataBytes, true);

  const src = new DataView(stereo.buffer, stereo.byteOffset, stereo.byteLength);
  for (let i = 0; i < frameCount; i++) {
    const o = info.dataOffset + i * 4;
    const l = src.getInt16(o, true);
    const r = src.getInt16(o + 2, true);
    const m = Math.max(-32768, Math.min(32767, Math.round((l + r) / 2)));
    dv.setInt16(44 + i * 2, m, true);
  }
  return out;
}

export type StereoPeaks = {
  durationSec: number;
  peaksLeft: number[];
  peaksRight: number[];
};

/** 버킷별 |sample| max를 0~1로 정규화. mono면 L=R. */
export function extractStereoPeaks(wav: Uint8Array, buckets = 400): StereoPeaks {
  const info = parseWav(wav);
  const n = Math.max(1, Math.min(2000, Math.floor(buckets) || 400));
  const durationSec = wavDurationSec(info);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const bytesPerFrame = (info.bitsPerSample / 8) * info.channels;
  const frameCount = Math.floor(info.dataBytes / bytesPerFrame);

  const peaksLeft = new Array<number>(n).fill(0);
  const peaksRight = new Array<number>(n).fill(0);
  if (frameCount <= 0) return { durationSec, peaksLeft, peaksRight };

  for (let i = 0; i < frameCount; i++) {
    const bi = Math.min(n - 1, Math.floor((i / frameCount) * n));
    const o = info.dataOffset + i * bytesPerFrame;
    const l = Math.abs(view.getInt16(o, true)) / 32768;
    const r = info.channels >= 2 ? Math.abs(view.getInt16(o + 2, true)) / 32768 : l;
    if (l > peaksLeft[bi]) peaksLeft[bi] = l;
    if (r > peaksRight[bi]) peaksRight[bi] = r;
  }

  // light peak normalization so quiet calls still show shape
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, peaksLeft[i], peaksRight[i]);
  if (max > 0 && max < 0.15) {
    const scale = 0.15 / max;
    for (let i = 0; i < n; i++) {
      peaksLeft[i] = Math.min(1, peaksLeft[i] * scale);
      peaksRight[i] = Math.min(1, peaksRight[i] * scale);
    }
  }

  return { durationSec, peaksLeft, peaksRight };
}

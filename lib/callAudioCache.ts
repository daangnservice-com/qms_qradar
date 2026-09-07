import { readFile } from "node:fs/promises";
import { getConversationAudioUrl, downloadAudio } from "@/lib/genesys";
import { saveTempFile, cleanupTempFile, transcodeToWav } from "@/lib/audio";
import { downmixStereoToMonoWav } from "@/lib/wavPeaks";

/** stereo(16 kHz) 마스터 WAV 메모리 캐시. 재생(모노)·peaks가 공유. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 30;

type CacheEntry = {
  stereo: Uint8Array;
  mono: Uint8Array | null;
  expiresAt: number;
};

const _cache = new Map<string, CacheEntry>();

function pruneCache(): void {
  const now = Date.now();
  for (const [k, v] of _cache) if (now >= v.expiresAt) _cache.delete(k);
  while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value as string);
}

/**
 * Genesys → ffmpeg stereo WAV(16 kHz, 2ch). 캐시 히트 시 재다운로드/재변환 없음.
 */
export async function loadStereoWav(conversationId: string): Promise<Uint8Array> {
  const hit = _cache.get(conversationId);
  if (hit && Date.now() < hit.expiresAt) return hit.stereo;

  const tempPaths: string[] = [];
  try {
    const url = await getConversationAudioUrl(conversationId);
    const { bytes } = await downloadAudio(url);
    const srcPath = await saveTempFile(bytes, ".audio");
    tempPaths.push(srcPath);
    const wavPath = await transcodeToWav(srcPath, 2);
    tempPaths.push(wavPath);
    const stereo = new Uint8Array(await readFile(wavPath));

    _cache.set(conversationId, { stereo, mono: null, expiresAt: Date.now() + CACHE_TTL_MS });
    pruneCache();
    return stereo;
  } finally {
    for (const p of tempPaths) await cleanupTempFile(p);
  }
}

/** 재생용: stereo 캐시에서 mono downmix (1회 계산 후 캐시). */
export async function loadMonoWav(conversationId: string): Promise<Uint8Array> {
  const stereo = await loadStereoWav(conversationId);
  const hit = _cache.get(conversationId);
  if (hit && hit.mono && Date.now() < hit.expiresAt) return hit.mono;
  const mono = downmixStereoToMonoWav(stereo);
  if (hit && Date.now() < hit.expiresAt) hit.mono = mono;
  return mono;
}

/** localStorage + TTL + SWR 헬퍼 (클라이언트 전용) */

type CacheEntry<T> = { ts: number; data: T };

const PREFIX = "hx:cache:";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function cacheGet<T>(key: string, ttlMs: number): T | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.ts !== "number") return null;
    if (Date.now() - entry.ts > ttlMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/** TTL 지나도 stale 데이터 반환 (SWR용) */
export function cacheGetStale<T>(key: string): T | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry?.data ?? null;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  if (!canUseStorage()) return;
  try {
    const entry: CacheEntry<T> = { ts: Date.now(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function cacheInvalidate(keyOrPrefix: string): void {
  if (!canUseStorage()) return;
  try {
    const full = PREFIX + keyOrPrefix;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === full || k.startsWith(full))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export const CACHE_TTL = {
  sourceCriteria: 60 * 60 * 1000,
  criterionPrompts: 15 * 60 * 1000,
  promptVersions: 5 * 60 * 1000,
  qaMatrix: 2 * 60 * 1000,
  llmStats: 2 * 60 * 1000,
} as const;

/** 프로세스 메모리 TTL 캐시 + 동시 요청 coalesce (서버 전용) */

type Entry<T> = {
  expires: number;
  value?: T;
  promise?: Promise<T>;
};

const store = new Map<string, Entry<unknown>>();

export const SERVER_CACHE_TTL = {
  filterOptions: 2 * 60 * 1000,
  highRiskRules: 2 * 60 * 1000,
  criteriaBundle: 60 * 1000,
  promptVersions: 60 * 1000,
  mismatchGroups: 2 * 60 * 1000,
} as const;

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit?.value !== undefined && now < hit.expires) return hit.value;
  if (hit?.promise) return hit.promise;

  const promise = fn()
    .then((value) => {
      store.set(key, { expires: Date.now() + ttlMs, value });
      return value;
    })
    .catch((e) => {
      store.delete(key);
      throw e;
    });
  store.set(key, { expires: 0, promise });
  return promise;
}

export function cacheInvalidate(prefix: string): void {
  for (const k of store.keys()) {
    if (k === prefix || k.startsWith(prefix)) store.delete(k);
  }
}

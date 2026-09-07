"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cacheGetStale, cacheSet } from "@/lib/clientCache";

/**
 * 마운트/키 변경 시 localStorage stale 즉시 페인트 → 백그라운드 재검증.
 * - loading: 현재 key에 보여줄 데이터가 없음 (오버레이용)
 * - validating: 요청 진행 중 (작은 스피너용). 캐시가 있으면 loading=false 유지
 * SSR hydration mismatch 방지: 초기 state 는 항상 null, 캐시는 클라이언트에서만 적용.
 *
 * key 변경 프레임에서도 이전 key 잔상이 보이지 않도록, 반환 data/loading 은
 * 현재 key 기준으로 동기 해석한다 (setState는 다음 페인트용).
 */
export function useCachedFetch<T>(opts: {
  key: string;
  fetcher: () => Promise<T>;
  enabled?: boolean;
}): {
  data: T | null;
  loading: boolean;
  validating: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setData: (v: T | null) => void;
} {
  const { key, fetcher, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [activeKey, setActiveKey] = useState(key);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const reqIdRef = useRef(0);
  /** 세션 내 메모리 캐시 — localStorage 실패/지연과 무관하게 재선택 즉시 표시 */
  const memoryRef = useRef(new Map<string, T>());

  let viewData = data;
  let viewLoading = loading;

  // key 변경 시 렌더 단계에서 캐시 동기 적용 (이전 key 잔상·빈 화면 깜빡임 방지)
  if (key !== activeKey) {
    const mem = memoryRef.current.get(key);
    const stale = mem ?? cacheGetStale<T>(key);
    viewData = stale ?? null;
    viewLoading = !stale;
    setActiveKey(key);
    if (stale) {
      memoryRef.current.set(key, stale);
      setData(stale);
      setLoading(false);
    } else {
      setData(null);
      setLoading(true);
    }
    setError(null);
  }

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const reqId = ++reqIdRef.current;
    const fetchKey = key;
    setValidating(true);
    setError(null);
    try {
      const next = await fetcherRef.current();
      if (reqId !== reqIdRef.current) return;
      memoryRef.current.set(fetchKey, next);
      setData(next);
      cacheSet(fetchKey, next);
      setLoading(false);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    } finally {
      if (reqId === reqIdRef.current) setValidating(false);
    }
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const mem = memoryRef.current.get(key);
    const stale = mem ?? cacheGetStale<T>(key);
    if (stale) {
      memoryRef.current.set(key, stale);
      setData(stale);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void refresh();
  }, [key, enabled, refresh]);

  return { data: viewData, loading: viewLoading, validating, error, refresh, setData };
}

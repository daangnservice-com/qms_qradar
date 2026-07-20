"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// 라우트 변경 시마다 현재 경로를 /api/track에 기록한다(사용량 트래킹).
// sendBeacon으로 비동기·비차단 전송(실패해도 UX 영향 없음). 세션 쿠키가 함께 전송돼 서버에서 사용자 식별.
export default function UsageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/api") || pathname === "/login") return;
    const body = JSON.stringify({ path: pathname });
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* 트래킹 실패는 무시 */
    }
  }, [pathname]);

  return null;
}

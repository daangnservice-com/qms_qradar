// 콜 평가 조직. 페이팀 콜 평가는 폐기돼 성장문화실(growth) 하나만 쓴다.
// "pay"는 BQ에 남은 과거 결과 행의 org 값으로만 존재 — 새로 만들거나 조회하지 않는다.
export type CallQualityOrg = "growth" | "pay";

/** 모든 콜 평가 API·저장이 쓰는 조직. */
export const CALL_EVAL_ORG = "growth" satisfies CallQualityOrg;

// 권한 판정은 여기 없다 — 세션 기준 동기 판정은 lib/sessionAccess.ts,
// Google Groups까지 확인하는 서버 게이트는 lib/sessionAccessServer.ts.

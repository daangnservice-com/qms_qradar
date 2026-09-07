import { canAccessCallQuality, canAccessPayCallQuality } from "./adminEmails";
import { isAllowedEmail } from "./auth";

const OBSERVE_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "daangnservice.com";

// 콜 분석 조직(탭). 샘플 소스는 공통이지만 접근 권한·결과 저장 테이블·(추후)채점 기준이 다르다.
export type CallQualityOrg = "growth" | "pay";

export const ORG_LABEL: Record<CallQualityOrg, string> = {
  growth: "성장문화실",
  pay: "페이팀",
};

export function orgFromParam(v: unknown): CallQualityOrg {
  return v === "pay" ? "pay" : "growth";
}

/** STT·녹취 observe 모드 — @daangnservice.com 로그인 계정 전원(평가 화이트리스트 불필요) */
export function canAccessCallQualityObserve(email: string | null | undefined): boolean {
  if (!email) return false;
  if (canAccessCallQuality(email) || canAccessPayCallQuality(email)) return true;
  return isAllowedEmail(email, OBSERVE_EMAIL_DOMAIN);
}

// 해당 조직 콜 분석에 접근 가능한지(조직별 화이트리스트).
export function canAccessOrg(org: CallQualityOrg, email: string | null | undefined): boolean {
  return org === "pay" ? canAccessPayCallQuality(email) : canAccessCallQuality(email);
}

/** 평가 UI 또는 observe 청취(녹취·STT API) */
export function canAccessCallQualityPlayback(
  org: CallQualityOrg,
  email: string | null | undefined,
): boolean {
  return canAccessOrg(org, email) || canAccessCallQualityObserve(email);
}

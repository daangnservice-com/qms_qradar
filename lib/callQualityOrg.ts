import { canAccessCallQuality, canAccessPayCallQuality } from "./adminEmails";

// 콜 분석 조직(탭). 샘플 소스는 공통이지만 접근 권한·결과 저장 테이블·(추후)채점 기준이 다르다.
export type CallQualityOrg = "growth" | "pay";

export const ORG_LABEL: Record<CallQualityOrg, string> = {
  growth: "성장문화실",
  pay: "페이팀",
};

export function orgFromParam(v: unknown): CallQualityOrg {
  return v === "pay" ? "pay" : "growth";
}

// 해당 조직 콜 분석에 접근 가능한지(조직별 화이트리스트).
export function canAccessOrg(org: CallQualityOrg, email: string | null | undefined): boolean {
  return org === "pay" ? canAccessPayCallQuality(email) : canAccessCallQuality(email);
}

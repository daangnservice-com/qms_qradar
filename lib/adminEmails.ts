// 사용량 대시보드·평가 스케줄 등 개인정보/운영 현황을 볼 수 있는 관리자 이메일.
// 이 목록에 있는 계정만 /usage, /admin/eval-schedule 및 관련 API 접근이 허용된다.
export const ADMIN_EMAILS = [
  "karla@daangnservice.com",
  "amir@daangnservice.com",
  "amber.jeon@daangnservice.com", // karla와 동일 권한(개인정보 대시보드 포함)
  "russell@daangn.com",
  "liana@daangn.com",
];

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// 콜 분석 접근 허용 계정 — 조직(탭)별로 다르다.
// 성장문화실 콜 분석(현재 /call-quality).
export const CALL_QUALITY_EMAILS = [
  "karla@daangnservice.com",
  "laika@daangnservice.com", // 성장문화실 전용
  "amir@daangnservice.com", // 성장문화실 전용
  "riley.lee@daangnservice.com", // 성장문화실 전용
  "haro@daangnservice.com",
  "ocean.go@daangnservice.com",
  "ellie.park@daangnservice.com",
  "amber.jeon@daangnservice.com", // karla와 동일 권한(성장문화실+페이팀)
  "sage@daangnservice.com", 
];
// 페이팀 콜 분석(품질평가).
export const PAY_CALL_QUALITY_EMAILS = [
  "karla@daangnservice.com",
  "taeo@daangnservice.com",
  "heather@daangnservice.com",
  "amir@daangnservice.com", // 성장문화실 전용
  "amber.jeon@daangnservice.com", // karla와 동일 권한
];

export function canAccessCallQuality(email: string | null | undefined): boolean {
  return !!email && CALL_QUALITY_EMAILS.includes(email.toLowerCase());
}
export function canAccessPayCallQuality(email: string | null | undefined): boolean {
  return !!email && PAY_CALL_QUALITY_EMAILS.includes(email.toLowerCase());
}
// 어느 조직이든 콜 분석에 접근 가능한지(사이드바 노출 판단 등).
export function canAccessAnyCallQuality(email: string | null | undefined): boolean {
  return canAccessCallQuality(email) || canAccessPayCallQuality(email);
}

/** 품질평가 배분 시뮬레이터 — 성장문화팀(전체 탭). GAS FULL_ACCESS + 관리자. */
export const DISTRIBUTION_FULL_EMAILS = [
  ...ADMIN_EMAILS,
  "riley.lee@daangnservice.com",
  "brent@daangnservice.com",
  "david.yun@daangnservice.com",
  "ellie.park@daangnservice.com",
  "haro@daangnservice.com",
  "ocean.go@daangnservice.com",
  "laika@daangnservice.com",
];

/** 대상자 명단만 — 팀 리더. 그룹 멤버십 flatten은 후속. */
export const DISTRIBUTION_ROSTER_EMAILS = [
  "leadergroup@daangnservice.com",
  "ds-sr-cx-professional-l4@daangnservice.com",
  "ds-staff-cx-professional-l5@daangnservice.com",
];

export type EvalOpsAccessLevel = "full" | "roster" | "none";

function emailIn(list: string[], email: string | null | undefined): boolean {
  return !!email && list.includes(email.toLowerCase());
}

export function canAccessEvalOpsFull(email: string | null | undefined): boolean {
  return emailIn(DISTRIBUTION_FULL_EMAILS, email);
}

export function canAccessEvalOps(email: string | null | undefined): boolean {
  return canAccessEvalOpsFull(email) || emailIn(DISTRIBUTION_ROSTER_EMAILS, email);
}

export function getEvalOpsAccessLevel(email: string | null | undefined): EvalOpsAccessLevel {
  if (canAccessEvalOpsFull(email)) return "full";
  if (canAccessEvalOps(email)) return "roster";
  return "none";
}

// 사용량 대시보드 등 개인정보(사용자별 접속기록)를 볼 수 있는 관리자 이메일.
// 이 목록에 있는 계정만 /usage 및 /api/stats/usage 접근이 허용된다.
export const ADMIN_EMAILS = [
  "karla@daangnservice.com",
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
  "laika@daangnservice.com",
  "amir@daangnservice.com",
  "riley.lee@daangnservice.com",
];
// 페이팀 콜 분석(품질평가).
export const PAY_CALL_QUALITY_EMAILS = [
  "karla@daangnservice.com",
  "taeo@daangnservice.com",
  "heather@daangnservice.com",
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

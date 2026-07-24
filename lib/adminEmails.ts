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

// 콜 품질 평가 접근 허용 계정(관리자 그룹 ADMIN_EMAILS와 별개의 화이트리스트).
export const CALL_QUALITY_EMAILS = [
  "karla@daangnservice.com",
  "laika@daangnservice.com",
  "amir@daangnservice.com",
  "riley.lee@daangnservice.com",
];

export function canAccessCallQuality(email: string | null | undefined): boolean {
  return !!email && CALL_QUALITY_EMAILS.includes(email.toLowerCase());
}

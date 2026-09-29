// 사용량 대시보드·평가 스케줄 등 개인정보/운영 현황을 볼 수 있는 관리자 이메일.
// 이 목록에 있는 계정만 /usage, /admin/eval-schedule 및 관련 API 접근이 허용된다.
export const ADMIN_EMAILS = [
  //"karla@daangnservice.com",
  "amir@daangnservice.com",
  //"amber.jeon@daangnservice.com", // karla와 동일 권한(개인정보 대시보드 포함)
  //"russell@daangn.com",
  //"liana@daangn.com",
];

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

function emailIn(list: readonly string[], email: string | null | undefined): boolean {
  return !!email && list.includes(email.toLowerCase());
}

// ──────────────────────────────────────────────────────────────
// 품질평가 권한 레이어 (사이드바 기준, 민감도 낮은 순)
//
//  평가 진행(콜·문의·채팅) ……… 당근서비스 도메인 전체 (+관리자)
//  품질평가 > 월간 리포트 ……… MONTHLY_REPORT_* (리더) + quality eval
//  평가 설계 · 품질평가 나머지 … QUALITY_EVAL_*
//  평가 운영 ………………………… DISTRIBUTION_* (기존)
//  시스템 ……………………………… ADMIN_EMAILS
//
// Google Groups 멤버십은 lib/googleGroups.ts → 로그인 JWT에 반영.
// ──────────────────────────────────────────────────────────────

/** 로그인 허용 도메인. lib/auth.ts signIn과 같은 기준. */
export function isDomainMember(email: string | null | undefined): boolean {
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "daangnservice.com").toLowerCase();
  return !!email && email.toLowerCase().endsWith(`@${domain}`);
}

/** 평가 설계·품질평가(리포트). */
export const QUALITY_EVAL_GROUP_EMAILS: string[] = [
  // 예: "qradar-quality-eval@daangnservice.com",
  "growth_@daangnservice.com",
];

/** 평가 설계·품질평가 개인 화이트리스트. */
export const QUALITY_EVAL_EMAILS: string[] = [
  // 평가 설계·리포트를 봐야 하는 계정을 여기 추가.
  ...ADMIN_EMAILS,
];

/** 품질평가 > 월간 리포트만 — 리더(L5). quality eval 권한이면 포함. */
export const MONTHLY_REPORT_GROUP_EMAILS: string[] = [
  "ds-staff-cx-professional-l5@daangnservice.com",
];

/** 월간 리포트 — 개인 화이트리스트. */
export const MONTHLY_REPORT_EMAILS: string[] = [];

/** 동기: 개인 화이트리스트만. 그룹 멤버는 session.access 또는 resolve* 사용. */
export function canAccessQualityEval(email: string | null | undefined): boolean {
  return emailIn(QUALITY_EVAL_EMAILS, email);
}

export function canAccessMonthlyReport(email: string | null | undefined): boolean {
  return canAccessQualityEval(email) || emailIn(MONTHLY_REPORT_EMAILS, email);
}

/** 평가 진행(콜·인앱문의·채팅상담) — 도메인 구성원 전체 + 관리자. */
export function canAccessEvalProgress(email: string | null | undefined): boolean {
  return isAdmin(email) || isDomainMember(email);
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

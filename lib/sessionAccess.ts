import type { Session } from "next-auth";
import { canAccessEvalProgress, canAccessMonthlyReport, canAccessQualityEval } from "./adminEmails";

export type AccessSession = {
  user?: { email?: string | null } | null;
  access?: {
    qualityEval?: boolean;
    monthlyReport?: boolean;
  } | null;
} | null;

function emailOf(session: AccessSession | Session | undefined): string | null {
  return session?.user?.email ?? null;
}

function flags(session: AccessSession | Session | undefined) {
  return session?.access ?? null;
}

/** 평가 설계·품질평가(리포트). */
export function sessionCanAccessQualityEval(
  session: AccessSession | Session | undefined,
): boolean {
  if (!emailOf(session)) return false;
  if (flags(session)?.qualityEval) return true;
  return canAccessQualityEval(emailOf(session));
}

/** 품질평가 > 월간 리포트. */
export function sessionCanAccessMonthlyReport(
  session: AccessSession | Session | undefined,
): boolean {
  if (!emailOf(session)) return false;
  if (flags(session)?.monthlyReport || flags(session)?.qualityEval) return true;
  return canAccessMonthlyReport(emailOf(session));
}

/** 평가 진행(콜·인앱문의·채팅상담) — 도메인 구성원 전체. */
export function sessionCanAccessEvalProgress(
  session: AccessSession | Session | undefined,
): boolean {
  return canAccessEvalProgress(emailOf(session));
}

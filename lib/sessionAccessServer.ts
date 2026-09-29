import type { Session } from "next-auth";
import { canAccessEvalOps } from "./adminEmails";
import { resolveCanAccessMonthlyReport, resolveCanAccessQualityEval } from "./resolveAccess";
import { type AccessSession, sessionCanAccessEvalProgress } from "./sessionAccess";

/**
 * 서버 게이트용 — JWT true면 통과, 아니면 Cloud Identity Groups(캐시)까지 확인.
 * 배포 직후·로그인 직후 그룹 반영 누락을 보완한다.
 * google-auth-library(fs) 의존 — 클라이언트에서 import 금지.
 */
function emailOf(session: AccessSession | Session | undefined): string | undefined {
  return session?.user?.email ?? undefined;
}

export async function ensureSessionCanAccessQualityEval(
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  if (!emailOf(session)) return false;
  if (session?.access?.qualityEval === true) return true;
  return resolveCanAccessQualityEval(emailOf(session));
}

export async function ensureSessionCanAccessMonthlyReport(
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  if (!emailOf(session)) return false;
  if (session?.access?.qualityEval === true || session?.access?.monthlyReport === true) return true;
  return resolveCanAccessMonthlyReport(emailOf(session));
}

/** 평가 진행(콜·인앱문의·채팅상담) — 도메인 구성원 전체. Groups 조회 없음. */
export async function ensureSessionCanAccessEvalProgress(
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  return sessionCanAccessEvalProgress(session);
}

/** 평가 운영 사이드 섹션(스케줄·검수 현황): 평가 운영 권한 또는 quality eval. */
export async function ensureSessionCanAccessEvalOpsNav(
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  if (canAccessEvalOps(emailOf(session))) return true;
  return ensureSessionCanAccessQualityEval(session);
}

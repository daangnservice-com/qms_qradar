import type { Session } from "next-auth";
import { canAccessPayCallQuality } from "./adminEmails";
import type { CallQualityOrg } from "./callQualityOrg";
import {
  resolveCanAccessAnyCallQuality,
  resolveCanAccessCallQuality,
} from "./resolveAccess";
import {
  type AccessSession,
  sessionCanAccessPayCallQuality,
} from "./sessionAccess";

/**
 * 서버 게이트용 — JWT true면 통과, 아니면 Directory API(캐시)까지 확인.
 * 배포 직후·로그인 직후 그룹 반영 누락을 보완한다.
 * google-auth-library(fs) 의존 — 클라이언트에서 import 금지.
 */
export async function ensureSessionCanAccessCallQuality(
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  if (!session?.user?.email) return false;
  if (session.access?.callQuality === true) return true;
  return resolveCanAccessCallQuality(session.user.email);
}

export async function ensureSessionCanAccessAnyCallQuality(
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  if (!session?.user?.email) return false;
  if (session.access?.callQuality === true || canAccessPayCallQuality(session.user.email)) return true;
  return resolveCanAccessAnyCallQuality(session.user.email);
}

export async function ensureSessionCanAccessCallQualityObserve(
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  return ensureSessionCanAccessAnyCallQuality(session);
}

export async function ensureSessionCanAccessOrg(
  org: CallQualityOrg,
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  if (org === "pay") return sessionCanAccessPayCallQuality(session);
  return ensureSessionCanAccessCallQuality(session);
}

export async function ensureSessionCanAccessCallQualityPlayback(
  org: CallQualityOrg,
  session: AccessSession | Session | undefined,
): Promise<boolean> {
  if (await ensureSessionCanAccessOrg(org, session)) return true;
  return ensureSessionCanAccessCallQualityObserve(session);
}

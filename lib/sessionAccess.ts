import type { Session } from "next-auth";
import { canAccessCallQuality, canAccessPayCallQuality } from "./adminEmails";
import type { CallQualityOrg } from "./callQualityOrg";

export type AccessSession = {
  user?: { email?: string | null } | null;
  access?: { callQuality?: boolean } | null;
} | null;

/** 클라이언트(Sidebar)용 — JWT 플래그 또는 개인 화이트리스트. */
export function sessionCanAccessCallQuality(session: AccessSession | Session | undefined): boolean {
  if (!session?.user?.email) return false;
  if (session.access?.callQuality) return true;
  return canAccessCallQuality(session.user.email);
}

export function sessionCanAccessPayCallQuality(session: AccessSession | Session | undefined): boolean {
  return canAccessPayCallQuality(session?.user?.email);
}

export function sessionCanAccessAnyCallQuality(session: AccessSession | Session | undefined): boolean {
  return sessionCanAccessCallQuality(session) || sessionCanAccessPayCallQuality(session);
}

export function sessionCanAccessCallQualityObserve(
  session: AccessSession | Session | undefined,
): boolean {
  return sessionCanAccessAnyCallQuality(session);
}

export function sessionCanAccessOrg(
  org: CallQualityOrg,
  session: AccessSession | Session | undefined,
): boolean {
  return org === "pay" ? sessionCanAccessPayCallQuality(session) : sessionCanAccessCallQuality(session);
}

export function sessionCanAccessCallQualityPlayback(
  org: CallQualityOrg,
  session: AccessSession | Session | undefined,
): boolean {
  return sessionCanAccessOrg(org, session) || sessionCanAccessCallQualityObserve(session);
}

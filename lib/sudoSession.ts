import { cookies } from "next/headers";
import { isAdmin } from "./adminEmails";

export const SUDO_COOKIE = "qradar_sudo_as";

export async function getSudoTarget(): Promise<string | null> {
  const raw = (await cookies()).get(SUDO_COOKIE)?.value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim().toLowerCase() || null;
  } catch {
    return raw.trim().toLowerCase() || null;
  }
}

/** 관리자 sudo 쿠키가 있으면 해당 이메일, 아니면 세션 이메일. */
export async function getEffectiveEmail(sessionEmail: string | null | undefined): Promise<{
  email: string;
  realEmail: string;
  sudoActive: boolean;
}> {
  const realEmail = (sessionEmail ?? "").trim().toLowerCase();
  const sudo = await getSudoTarget();
  if (sudo && isAdmin(realEmail)) {
    return { email: sudo, realEmail, sudoActive: true };
  }
  return { email: realEmail, realEmail, sudoActive: false };
}

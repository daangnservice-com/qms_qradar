import {
  CALL_QUALITY_GROUP_EMAILS,
  canAccessCallQuality,
  canAccessPayCallQuality,
} from "./adminEmails";
import { isMemberOfAnyGroup } from "./googleGroups";

/** 개인 화이트리스트 또는 CALL_QUALITY_GROUP_EMAILS 멤버십. */
export async function resolveCanAccessCallQuality(
  email: string | null | undefined,
): Promise<boolean> {
  if (canAccessCallQuality(email)) return true;
  return isMemberOfAnyGroup(email, CALL_QUALITY_GROUP_EMAILS);
}

export async function resolveCanAccessAnyCallQuality(
  email: string | null | undefined,
): Promise<boolean> {
  if (canAccessPayCallQuality(email)) return true;
  return resolveCanAccessCallQuality(email);
}

export async function resolveCanAccessCallQualityObserve(
  email: string | null | undefined,
): Promise<boolean> {
  return resolveCanAccessAnyCallQuality(email);
}

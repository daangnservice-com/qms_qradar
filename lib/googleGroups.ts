import { GoogleAuth, type AuthClient } from "google-auth-library";
import { gcpCredentials, peekAdcCredentials } from "./gcpCredentials";

const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member.readonly";
const DEFAULT_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { isMember: boolean; expiresAt: number };

const membershipCache = new Map<string, CacheEntry>();
let warnedMissingConfig = false;

function cacheKey(email: string, groups: string[]): string {
  return `${email.toLowerCase()}|${groups.map((g) => g.toLowerCase()).sort().join(",")}`;
}

function impersonateEmail(): string | undefined {
  return process.env.GOOGLE_WORKSPACE_IMPERSONATE_EMAIL?.trim() || undefined;
}

function ttlMs(): number {
  const raw = process.env.GOOGLE_GROUPS_CACHE_TTL_MS?.trim();
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function warnConfigOnce(msg: string) {
  if (warnedMissingConfig) return;
  warnedMissingConfig = true;
  console.warn(`[googleGroups] ${msg}`);
}

function isServiceAccountCred(creds: object | undefined): boolean {
  if (!creds || typeof creds !== "object") return false;
  const c = creds as { type?: string; client_email?: string; private_key?: string };
  return c.type === "service_account" || (!!c.client_email && !!c.private_key);
}

/**
 * Directory API 클라이언트.
 * - 사용자 ADC(`authorized_user`): impersonate 없이 그 계정으로 직접 호출
 * - SA(JSON env 또는 ADC SA): Domain-wide Delegation + impersonate 필수
 * 로컬에서 사용자 ADC와 SA JSON이 둘 다 있으면 Groups는 사용자 ADC를 우선한다.
 */
async function directoryClient(): Promise<AuthClient | null> {
  const adc = peekAdcCredentials();
  const saJson = gcpCredentials();
  const subject = impersonateEmail();
  const useUserAdc = adc?.type === "authorized_user";
  const useSa = !useUserAdc && (isServiceAccountCred(saJson) || adc?.type === "service_account");

  if (useSa && !subject) {
    warnConfigOnce(
      "SA로 Groups 조회 시 GOOGLE_WORKSPACE_IMPERSONATE_EMAIL 필요 — 그룹 멤버십 검사 생략(화이트리스트만).",
    );
    return null;
  }

  if (!useUserAdc && !useSa && !subject) {
    // ADC·SA 모두 없고 impersonate도 없음 — 메타데이터 등 최후 시도는 subject 없이 실패하기 쉬움
    warnConfigOnce(
      "사용자 ADC(authorized_user)도 SA+GOOGLE_WORKSPACE_IMPERSONATE_EMAIL도 없음 — 그룹 멤버십 검사 생략(화이트리스트만).",
    );
    return null;
  }

  try {
    const auth = new GoogleAuth({
      ...(!useUserAdc && isServiceAccountCred(saJson) ? { credentials: saJson } : {}),
      scopes: [DIRECTORY_SCOPE],
      ...(!useUserAdc && subject ? { clientOptions: { subject } } : {}),
    });
    return await auth.getClient();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warnConfigOnce(
      `Directory 클라이언트 생성 실패 — 그룹 멤버십 검사 생략(화이트리스트만). ${detail}`,
    );
    return null;
  }
}

/** Admin SDK members.hasMember — 직접·중첩 멤버십 포함. */
async function hasMember(client: AuthClient, groupEmail: string, memberEmail: string): Promise<boolean> {
  const groupKey = encodeURIComponent(groupEmail);
  const memberKey = encodeURIComponent(memberEmail);
  const url = `https://admin.googleapis.com/admin/directory/v1/groups/${groupKey}/hasMember/${memberKey}`;
  try {
    const res = await client.request<{ isMember?: boolean }>({ url });
    return res.data?.isMember === true;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // 404 = 그룹 없음 또는 멤버 아님으로 취급
    if (status === 404) return false;
    throw err;
  }
}

/**
 * 사용자가 주어진 Google Groups 중 하나라도 멤버인지.
 * 사용자 ADC 또는 SA+DWD impersonation.
 * 설정 부재·API 오류 시 false (fail-closed). 결과는 TTL 캐시.
 */
export async function isMemberOfAnyGroup(
  email: string | null | undefined,
  groupEmails: readonly string[],
): Promise<boolean> {
  if (!email || groupEmails.length === 0) return false;
  const member = email.trim().toLowerCase();
  const groups = groupEmails.map((g) => g.trim().toLowerCase()).filter(Boolean);
  if (!member || groups.length === 0) return false;

  const key = cacheKey(member, groups);
  const hit = membershipCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.isMember;

  const client = await directoryClient();
  if (!client) {
    membershipCache.set(key, { isMember: false, expiresAt: Date.now() + ttlMs() });
    return false;
  }

  try {
    const results = await Promise.all(groups.map((g) => hasMember(client, g, member)));
    const isMember = results.some(Boolean);
    membershipCache.set(key, { isMember, expiresAt: Date.now() + ttlMs() });
    return isMember;
  } catch (err) {
    console.error("[googleGroups] hasMember failed", err);
    // 짧게만 부정 캐시해 연타로 API를 때리지 않음
    membershipCache.set(key, { isMember: false, expiresAt: Date.now() + Math.min(ttlMs(), 60_000) });
    return false;
  }
}

/** 테스트용 */
export function clearGoogleGroupsCache() {
  membershipCache.clear();
  warnedMissingConfig = false;
}

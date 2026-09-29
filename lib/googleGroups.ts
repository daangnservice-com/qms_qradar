import { GoogleAuth, type AuthClient } from "google-auth-library";
import { gcpCredentials, peekAdcCredentials } from "./gcpCredentials";

/** Cloud Identity Groups — 중첩 멤버십 포함. */
const GROUPS_SCOPE = "https://www.googleapis.com/auth/cloud-identity.groups.readonly";
const DEFAULT_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { isMember: boolean; expiresAt: number };
type GroupNameEntry = { name: string | null; expiresAt: number };

const membershipCache = new Map<string, CacheEntry>();
const groupNameCache = new Map<string, GroupNameEntry>();
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

function responseStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number }; status?: number })?.response?.status
    ?? (err as { status?: number })?.status;
}

/**
 * Cloud Identity Groups 클라이언트.
 * - SA(키 파일·env)가 있으면 우선: Domain-wide Delegation + impersonate 필수
 * - SA 없고 사용자 ADC(`authorized_user`)만 있으면 impersonate 없이 직접 호출
 */
async function groupsClient(): Promise<AuthClient | null> {
  const saJson = gcpCredentials();
  const subject = impersonateEmail();
  const useSa = isServiceAccountCred(saJson);

  if (useSa) {
    if (!subject) {
      warnConfigOnce(
        "SA로 Groups 조회 시 GOOGLE_WORKSPACE_IMPERSONATE_EMAIL 필요 — 그룹 멤버십 검사 생략(화이트리스트만).",
      );
      return null;
    }
    try {
      const auth = new GoogleAuth({
        credentials: saJson,
        scopes: [GROUPS_SCOPE],
        clientOptions: { subject },
      });
      return await auth.getClient();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warnConfigOnce(
        `Cloud Identity 클라이언트 생성 실패(SA) — 그룹 멤버십 검사 생략(화이트리스트만). ${detail}`,
      );
      return null;
    }
  }

  const adc = peekAdcCredentials();
  if (adc?.type === "authorized_user") {
    try {
      const auth = new GoogleAuth({ scopes: [GROUPS_SCOPE] });
      return await auth.getClient();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warnConfigOnce(
        `Cloud Identity 클라이언트 생성 실패(사용자 ADC) — 그룹 멤버십 검사 생략(화이트리스트만). ${detail}`,
      );
      return null;
    }
  }

  warnConfigOnce(
    "SA 키(sa/*.json 또는 GOOGLE_SERVICE_ACCOUNT_*)도 사용자 ADC도 없음 — 그룹 멤버십 검사 생략(화이트리스트만).",
  );
  return null;
}

/** group email → `groups/{id}` (TTL 캐시). 없으면 null. */
async function resolveGroupName(client: AuthClient, groupEmail: string): Promise<string | null> {
  const key = groupEmail.toLowerCase();
  const hit = groupNameCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.name;

  const url =
    "https://cloudidentity.googleapis.com/v1/groups:lookup?" +
    new URLSearchParams({ "groupKey.id": groupEmail }).toString();
  try {
    const res = await client.request<{ name?: string }>({ url });
    const name = res.data?.name ?? null;
    groupNameCache.set(key, { name, expiresAt: Date.now() + ttlMs() });
    return name;
  } catch (err: unknown) {
    const status = responseStatus(err);
    // 404 / 일부 403(존재하지 않거나 조회 불가) → 멤버 아님으로 취급
    if (status === 404) {
      groupNameCache.set(key, { name: null, expiresAt: Date.now() + ttlMs() });
      return null;
    }
    throw err;
  }
}

/** Cloud Identity checkTransitiveMembership — 직접·중첩 멤버십 포함. */
async function hasMember(client: AuthClient, groupEmail: string, memberEmail: string): Promise<boolean> {
  const groupName = await resolveGroupName(client, groupEmail);
  if (!groupName) return false;

  const url =
    `https://cloudidentity.googleapis.com/v1/${groupName}/memberships:checkTransitiveMembership?` +
    new URLSearchParams({ query: `member_key_id == '${memberEmail}'` }).toString();
  try {
    const res = await client.request<{ hasMembership?: boolean }>({ url });
    return res.data?.hasMembership === true;
  } catch (err: unknown) {
    const status = responseStatus(err);
    if (status === 404) return false;
    throw err;
  }
}

/**
 * 사용자가 주어진 Google Groups 중 하나라도 멤버인지.
 * Cloud Identity Groups API (SA+DWD impersonation 또는 사용자 ADC).
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

  const client = await groupsClient();
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
    console.error("[googleGroups] Cloud Identity membership check failed", err);
    membershipCache.set(key, { isMember: false, expiresAt: Date.now() + Math.min(ttlMs(), 60_000) });
    return false;
  }
}

/** 테스트용 */
export function clearGoogleGroupsCache() {
  membershipCache.clear();
  groupNameCache.clear();
  warnedMissingConfig = false;
}

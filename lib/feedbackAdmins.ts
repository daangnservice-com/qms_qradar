/** 인앱 문의 봇 답변(당근이). 목록에서 사람 답변과 구분한다. */
export const DAANGNE_ADMIN_ID = "10588";
export const DAANGNE_ADMIN_NAME = "당근이";

function isDaangneAdmin(id: string | null | undefined): boolean {
  return (id ?? "").trim() === DAANGNE_ADMIN_ID;
}

function isHumanReplyAdmin(id: string): boolean {
  return Boolean(id) && !isDaangneAdmin(id);
}

/** 답변 말풍선·목록에 붙일 이름. 10588은 조회 실패여도 당근이다. */
export function replyAdminDisplayName(id?: string | null, name?: string | null): string | null {
  if (isDaangneAdmin(id)) return DAANGNE_ADMIN_NAME;
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed === "Unknown") return null;
  return trimmed;
}

/**
 * 목록에 붙일 답변 어드민 이름. 할당 어드민이 아니라 admin_agg(답변한 사람) 기준.
 * 마지막 사람 답변을 앞에 두고, 당근이만 답변한 건은 "당근이"로 둔다.
 */
export function replyAdminNamesForDisplay(opts: {
  participatingAdmins: { id: string; name: string }[];
  lastReplyAdminId?: string | null;
  lastReplyAdminName?: string | null;
}): string[] {
  const humans = opts.participatingAdmins.filter(
    (admin) => isHumanReplyAdmin(admin.id) && replyAdminDisplayName(admin.id, admin.name),
  );
  const lastId = (opts.lastReplyAdminId ?? "").trim();
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (name: string | null) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };
  if (isHumanReplyAdmin(lastId)) {
    push(
      replyAdminDisplayName(lastId, opts.lastReplyAdminName) ||
        replyAdminDisplayName(lastId, humans.find((admin) => admin.id === lastId)?.name),
    );
  }
  for (const admin of humans) push(replyAdminDisplayName(admin.id, admin.name));
  if (names.length) return names;
  const hasDaangne =
    isDaangneAdmin(lastId) || opts.participatingAdmins.some((admin) => isDaangneAdmin(admin.id));
  return hasDaangne ? [DAANGNE_ADMIN_NAME] : [];
}

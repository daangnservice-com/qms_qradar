// 슬랙 사용자 사본(평가자 이메일 매핑용). 원천은 서빙 Postgres(테이블 이름은 BQ 와 같다), BQ 는 야간 덤프 사본.
import { insertDistRows } from "./distDb";
import { servingRows, withServingTx } from "./servingDb";

export type SlackUserRow = {
  slackUserId: string;
  email: string;
  displayName: string;
  realName: string;
  isBot: boolean;
  deleted: boolean;
  syncedAt: string;
};

const TABLE = "qradar_slack_users";

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "value" in v) return String((v as { value: unknown }).value ?? "");
  return String(v);
}

function parseRow(r: Record<string, unknown>): SlackUserRow {
  return {
    slackUserId: cellStr(r.slack_user_id),
    email: cellStr(r.email).toLowerCase(),
    displayName: cellStr(r.display_name),
    realName: cellStr(r.real_name),
    isBot: cellStr(r.is_bot) === "true" || r.is_bot === true,
    deleted: cellStr(r.deleted) === "true" || r.deleted === true,
    syncedAt: cellStr(r.synced_at),
  };
}

type SlackApiMember = {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    email?: string;
    display_name?: string;
    real_name?: string;
  };
  name?: string;
};

type SlackListResponse = {
  ok?: boolean;
  error?: string;
  members?: SlackApiMember[];
  response_metadata?: { next_cursor?: string };
};

function slackToken(): string {
  const t = process.env.SLACK_BOT_TOKEN?.trim();
  if (!t) throw new Error("SLACK_BOT_TOKEN이 설정되지 않았습니다. .env.local에 토큰을 추가한 뒤 다시 시도하세요.");
  return t;
}

async function fetchSlackMembers(): Promise<SlackApiMember[]> {
  const token = slackToken();
  const all: SlackApiMember[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = (await res.json()) as SlackListResponse;
    if (!data.ok) throw new Error(data.error || "Slack users.list failed");
    all.push(...(data.members ?? []));
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return all;
}

export async function syncSlackUsers(): Promise<{ count: number; syncedAt: string }> {
  const members = await fetchSlackMembers();
  const syncedAt = new Date().toISOString();
  const rows = members
    .filter((m) => m.id)
    .map((m) => ({
      slack_user_id: m.id!,
      email: (m.profile?.email ?? "").toLowerCase(),
      display_name: m.profile?.display_name || m.name || "",
      real_name: m.profile?.real_name || m.name || "",
      is_bot: !!m.is_bot,
      deleted: !!m.deleted,
      synced_at: syncedAt,
    }));

  await withServingTx(async (client) => {
    await client.query(`DELETE FROM ${TABLE}`);
    await insertDistRows(TABLE, rows, client);
  });
  return { count: rows.filter((r) => r.email && !r.deleted && !r.is_bot).length, syncedAt };
}

export async function listSlackUsers(opts?: { includeBots?: boolean; includeDeleted?: boolean }): Promise<SlackUserRow[]> {
  const rows = await servingRows(
    `SELECT * FROM ${TABLE} ORDER BY display_name COLLATE "C" NULLS FIRST, email COLLATE "C" NULLS FIRST`,
  );
  let list = rows.map(parseRow);
  if (!opts?.includeBots) list = list.filter((u) => !u.isBot);
  if (!opts?.includeDeleted) list = list.filter((u) => !u.deleted);
  return list;
}

/** 평가자 이메일 매핑용 — 이메일 있는 활성 사용자만. */
export async function listSlackUsersForEvaluators(): Promise<SlackUserRow[]> {
  const all = await listSlackUsers();
  return all.filter((u) => u.email);
}

export function isSlackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN?.trim();
}

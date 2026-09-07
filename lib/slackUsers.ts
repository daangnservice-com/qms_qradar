import { getBQ } from "./bigquery";
import { distBq } from "./bqRefs";

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

const SCHEMA = [
  { name: "slack_user_id", type: "STRING", mode: "REQUIRED" },
  { name: "email", type: "STRING", mode: "NULLABLE" },
  { name: "display_name", type: "STRING", mode: "NULLABLE" },
  { name: "real_name", type: "STRING", mode: "NULLABLE" },
  { name: "is_bot", type: "BOOL", mode: "NULLABLE" },
  { name: "deleted", type: "BOOL", mode: "NULLABLE" },
  { name: "synced_at", type: "TIMESTAMP", mode: "NULLABLE" },
] as const;

const loc = () => (distBq.location ? { location: distBq.location } : {});

let ensured: Promise<void> | null = null;

async function ensureSlackUsersTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const bq = getBQ();
      const ds = bq.dataset(distBq.dataset, { projectId: distBq.projectId });
      const [dsOk] = await ds.exists();
      if (!dsOk) await ds.create({ location: distBq.location || undefined });
      const table = ds.table(TABLE);
      const [tOk] = await table.exists();
      if (!tOk) {
        await table.create({
          schema: SCHEMA as unknown as { name: string; type: string; mode: string }[],
        });
      }
    })().catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
}

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
  await ensureSlackUsersTable();
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

  const bq = getBQ();
  const fq = distBq.fq(TABLE);
  await bq.query({ query: `DELETE FROM ${fq} WHERE TRUE`, ...loc() });
  if (rows.length) {
    await bq.dataset(distBq.dataset, { projectId: distBq.projectId }).table(TABLE).insert(rows, {
      skipInvalidRows: true,
      ignoreUnknownValues: true,
    });
  }
  return { count: rows.filter((r) => r.email && !r.deleted && !r.is_bot).length, syncedAt };
}

export async function listSlackUsers(opts?: { includeBots?: boolean; includeDeleted?: boolean }): Promise<SlackUserRow[]> {
  await ensureSlackUsersTable();
  const [rows] = await getBQ().query({
    query: `SELECT * FROM ${distBq.fq(TABLE)} ORDER BY display_name, email`,
    ...loc(),
  });
  let list = (rows as Record<string, unknown>[]).map(parseRow);
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

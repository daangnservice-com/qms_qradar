import { getServingPool } from "./servingDb";

export type EvalReviewCompletion = {
  conversationId: string;
  completedAt: string;
  completedBy: string;
  analysisId: string | null;
  org: string | null;
};

type Row = {
  conversation_id: string;
  completed_at: Date | string;
  completed_by: string;
  analysis_id: string | null;
  org: string | null;
};

function toCompletion(r: Row): EvalReviewCompletion | null {
  const conversationId = String(r.conversation_id ?? "").trim();
  const completedBy = String(r.completed_by ?? "").trim();
  if (!conversationId || !completedBy) return null;
  const completedAt = r.completed_at instanceof Date ? r.completed_at.toISOString() : String(r.completed_at ?? "");
  return {
    conversationId,
    completedAt,
    completedBy,
    analysisId: r.analysis_id != null ? String(r.analysis_id) : null,
    org: r.org != null ? String(r.org) : null,
  };
}

export async function saveReviewCompletion(input: {
  conversationId: string;
  completedBy: string;
  analysisId?: string | null;
  org?: string | null;
}): Promise<EvalReviewCompletion> {
  const conversationId = input.conversationId.trim();
  const completedBy = input.completedBy.trim();
  if (!conversationId) throw new Error("conversationId 필요");
  if (!completedBy) throw new Error("completedBy 필요");
  const completedAt = new Date().toISOString();
  const row: EvalReviewCompletion = {
    conversationId,
    completedAt,
    completedBy,
    analysisId: input.analysisId?.trim() || null,
    org: input.org?.trim() || null,
  };
  const pool = getServingPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
      insert into serving_review_completions
        (conversation_id, completed_at, completed_by, analysis_id, org, exported_at)
      values ($1, $2::timestamptz, $3, $4, $5, null)
      `,
      [row.conversationId, row.completedAt, row.completedBy, row.analysisId, row.org],
    );
    await client.query(
      `
      insert into call_serving (conversation_id, review_completed, org)
      values ($1, true, $2)
      on conflict (conversation_id) do update set
        review_completed = true,
        org = coalesce(excluded.org, call_serving.org),
        review_claimed_by = null,
        review_claimed_at = null,
        updated_at = now()
      `,
      [conversationId, row.org],
    );
    await client.query(
      `update serving_review_claims set active = false, exported_at = null where conversation_id = $1`,
      [conversationId],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return row;
}

export async function getLatestReviewCompletion(conversationId: string): Promise<EvalReviewCompletion | null> {
  const id = conversationId.trim();
  if (!id) return null;
  const res = await getServingPool().query<Row>(
    `
    select conversation_id, completed_at, completed_by, analysis_id, org
    from serving_review_completions
    where conversation_id = $1
    order by completed_at desc
    limit 1
    `,
    [id],
  );
  return res.rows[0] ? toCompletion(res.rows[0]) : null;
}

export async function listLatestReviewCompletionsByConversationIds(
  conversationIds: string[],
): Promise<Map<string, EvalReviewCompletion>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<string, EvalReviewCompletion>();
  if (!ids.length) return out;
  const res = await getServingPool().query<Row>(
    `
    select distinct on (conversation_id)
      conversation_id, completed_at, completed_by, analysis_id, org
    from serving_review_completions
    where conversation_id = any($1::text[])
    order by conversation_id, completed_at desc
    `,
    [ids],
  );
  for (const raw of res.rows) {
    const c = toCompletion(raw);
    if (c) out.set(c.conversationId, c);
  }
  return out;
}

export async function listReviewCompletionsInPeriod(opts: {
  startIso: string;
  endIso: string;
  org?: string | null;
  limit?: number;
}): Promise<EvalReviewCompletion[]> {
  const lim = Math.min(Math.max(Math.floor(opts.limit ?? 2000) || 2000, 1), 5000);
  const org = opts.org?.trim() || null;
  const res = await getServingPool().query<Row>(
    `
    select distinct on (conversation_id)
      conversation_id, completed_at, completed_by, analysis_id, org
    from serving_review_completions
    where completed_at >= $1::timestamptz
      and completed_at < $2::timestamptz
      and ($3::text is null or org = $3)
    order by conversation_id, completed_at desc
    `,
    [opts.startIso, opts.endIso, org],
  );
  return res.rows
    .map(toCompletion)
    .filter((c): c is EvalReviewCompletion => Boolean(c))
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
    .slice(0, lim);
}

export async function listRecentCompletedConversationIds(opts?: {
  org?: string | null;
  limit?: number;
}): Promise<string[]> {
  const lim = Math.min(Math.max(Math.floor(opts?.limit ?? 100) || 100, 1), 500);
  const org = opts?.org?.trim() || null;
  const res = await getServingPool().query<{ conversation_id: string }>(
    `
    select conversation_id
    from (
      select distinct on (conversation_id) conversation_id, completed_at
      from serving_review_completions
      where conversation_id <> ''
        and ($2::text is null or org = $2)
      order by conversation_id, completed_at desc
    ) latest
    order by completed_at desc
    limit $1
    `,
    [lim, org],
  );
  return res.rows.map((r) => r.conversation_id);
}

export function ensureEvalReviewCompletionTable(): Promise<void> {
  return Promise.resolve();
}

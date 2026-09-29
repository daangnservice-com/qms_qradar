import { getServingPool } from "./servingDb";
import { handleOf, sameEmail, type EvalReviewClaim } from "./evalReviewClaim";

export { handleOf, sameEmail, type EvalReviewClaim } from "./evalReviewClaim";

export class ReviewClaimConflictError extends Error {
  claimedBy: string;
  constructor(claimedBy: string, message: string) {
    super(message);
    this.name = "ReviewClaimConflictError";
    this.claimedBy = claimedBy;
  }
}

type LatestClaimRow = EvalReviewClaim & { active: boolean };

function toClaim(r: { conversation_id: string; claimed_by: string; claimed_at: Date | string; active: boolean }): LatestClaimRow {
  const claimedAt = r.claimed_at instanceof Date ? r.claimed_at.toISOString() : String(r.claimed_at);
  return {
    conversationId: r.conversation_id,
    claimedBy: r.claimed_by,
    claimedAt,
    active: r.active === true,
  };
}

async function writeClaim(input: {
  conversationId: string;
  claimedBy: string;
  active: boolean;
}): Promise<EvalReviewClaim> {
  const claimedAt = new Date().toISOString();
  const pool = getServingPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
      insert into serving_review_claims (conversation_id, claimed_by, claimed_at, active, exported_at)
      values ($1, $2, $3::timestamptz, $4, null)
      on conflict (conversation_id) do update set
        claimed_by = excluded.claimed_by,
        claimed_at = excluded.claimed_at,
        active = excluded.active,
        exported_at = null
      `,
      [input.conversationId, input.claimedBy, claimedAt, input.active],
    );
    await client.query(
      `
      insert into call_serving (conversation_id, review_claimed_by, review_claimed_at)
      values ($1, case when $2::boolean then $3 else null end, case when $2::boolean then $4::timestamptz else null end)
      on conflict (conversation_id) do update set
        review_claimed_by = case when $2::boolean then excluded.review_claimed_by else null end,
        review_claimed_at = case when $2::boolean then excluded.review_claimed_at else null end,
        updated_at = now()
      `,
      [input.conversationId, input.active, input.claimedBy, claimedAt],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return { conversationId: input.conversationId, claimedBy: input.claimedBy, claimedAt };
}

async function latestClaimRow(conversationId: string): Promise<LatestClaimRow | null> {
  const id = conversationId.trim();
  if (!id) return null;
  const res = await getServingPool().query(
    `select conversation_id, claimed_by, claimed_at, active from serving_review_claims where conversation_id = $1`,
    [id],
  );
  const raw = res.rows[0];
  return raw ? toClaim(raw) : null;
}

export async function getActiveClaim(conversationId: string): Promise<EvalReviewClaim | null> {
  const latest = await latestClaimRow(conversationId);
  return latest?.active
    ? { conversationId: latest.conversationId, claimedBy: latest.claimedBy, claimedAt: latest.claimedAt }
    : null;
}

export async function listActiveClaimsByConversationIds(
  conversationIds: string[],
): Promise<Map<string, EvalReviewClaim>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<string, EvalReviewClaim>();
  if (!ids.length) return out;
  const res = await getServingPool().query(
    `
    select conversation_id, claimed_by, claimed_at, active
    from serving_review_claims
    where conversation_id = any($1::text[]) and active
    `,
    [ids],
  );
  for (const raw of res.rows) {
    const claim = toClaim(raw);
    out.set(claim.conversationId, {
      conversationId: claim.conversationId,
      claimedBy: claim.claimedBy,
      claimedAt: claim.claimedAt,
    });
  }
  return out;
}

export async function listActiveClaimConversationIdsBy(email: string, limit = 500): Promise<string[]> {
  const who = email.trim();
  if (!who) return [];
  const lim = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const res = await getServingPool().query(
    `
    select conversation_id
    from serving_review_claims
    where active and lower(claimed_by) = lower($1)
    order by claimed_at desc
    limit $2
    `,
    [who, lim],
  );
  return res.rows.map((r) => String(r.conversation_id));
}

export async function claimReview(input: {
  conversationId: string;
  claimedBy: string;
}): Promise<EvalReviewClaim> {
  const conversationId = input.conversationId.trim();
  const claimedBy = input.claimedBy.trim();
  if (!conversationId) throw new Error("conversationId 필요");
  if (!claimedBy) throw new Error("claimedBy 필요");

  const latest = await latestClaimRow(conversationId);
  if (latest?.active) {
    if (sameEmail(latest.claimedBy, claimedBy)) {
      return { conversationId: latest.conversationId, claimedBy: latest.claimedBy, claimedAt: latest.claimedAt };
    }
    throw new ReviewClaimConflictError(
      latest.claimedBy,
      `이미 ${handleOf(latest.claimedBy)}님이 검수 진행 중입니다`,
    );
  }
  return writeClaim({ conversationId, claimedBy, active: true });
}

export async function releaseReviewClaim(input: {
  conversationId: string;
  releasedBy: string;
  force?: boolean;
}): Promise<void> {
  const conversationId = input.conversationId.trim();
  const releasedBy = input.releasedBy.trim();
  if (!conversationId) throw new Error("conversationId 필요");

  const latest = await latestClaimRow(conversationId);
  if (!latest?.active) return;
  if (!input.force && !sameEmail(latest.claimedBy, releasedBy)) {
    throw new ReviewClaimConflictError(
      latest.claimedBy,
      `이미 ${handleOf(latest.claimedBy)}님이 검수 진행 중입니다`,
    );
  }
  await writeClaim({ conversationId, claimedBy: releasedBy || latest.claimedBy, active: false });
}

/** @deprecated 서빙 DB 스키마는 db/migrations 가 만든다. */
export function ensureEvalReviewClaimTable(): Promise<void> {
  return Promise.resolve();
}

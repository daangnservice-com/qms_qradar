import { getBQ } from "./bigquery";
import { growthBq, qradarTable } from "./bqRefs";
import { handleOf, sameEmail, type EvalReviewClaim } from "./evalReviewClaim";
import {
  applyClaimOverlayToActiveMap,
  hydrateClaim,
  mergeClaimLatest,
  mergeMyActiveClaimIds,
  rememberClaim,
} from "./evalReviewClaimCache";

export { handleOf, sameEmail, type EvalReviewClaim } from "./evalReviewClaim";

export class ReviewClaimConflictError extends Error {
  claimedBy: string;
  constructor(claimedBy: string, message: string) {
    super(message);
    this.name = "ReviewClaimConflictError";
    this.claimedBy = claimedBy;
  }
}

const TABLE = qradarTable("eval_review_claims");
const loc = () => (growthBq.location ? { location: growthBq.location } : {});
const claimTable = () =>
  getBQ().dataset(growthBq.dataset, { projectId: growthBq.projectId }).table(TABLE);

const SCHEMA = [
  { name: "conversation_id", type: "STRING", mode: "REQUIRED" },
  { name: "claimed_by", type: "STRING", mode: "REQUIRED" },
  { name: "claimed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "active", type: "BOOLEAN", mode: "REQUIRED" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureEvalReviewClaimTable(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const bq = getBQ();
      const ds = bq.dataset(growthBq.dataset, { projectId: growthBq.projectId });
      const [dsExists] = await ds.exists();
      if (!dsExists) {
        await ds.create({ location: growthBq.location ?? "US" }).catch((e) => {
          if (!isAlreadyExists(e)) throw e;
        });
      }
      const t = ds.table(TABLE);
      const [exists] = await t.exists();
      if (!exists) {
        await t
          .create({ schema: SCHEMA as unknown as { name: string; type: string; mode: string }[] })
          .catch((e) => {
            if (!isAlreadyExists(e)) throw e;
          });
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

function tsValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) {
    return String((v as { value: string }).value);
  }
  return String(v ?? "");
}

function rowToClaim(r: Record<string, unknown>): EvalReviewClaim | null {
  const conversationId = String(r.conversation_id ?? "").trim();
  const claimedBy = String(r.claimed_by ?? "").trim();
  if (!conversationId || !claimedBy) return null;
  return {
    conversationId,
    claimedBy,
    claimedAt: tsValue(r.claimed_at),
  };
}

async function insertClaimRow(input: {
  conversationId: string;
  claimedBy: string;
  active: boolean;
}): Promise<EvalReviewClaim> {
  await ensureEvalReviewClaimTable();
  const claimedAt = new Date().toISOString();
  await claimTable().insert(
    [
      {
        conversation_id: input.conversationId,
        claimed_by: input.claimedBy,
        claimed_at: claimedAt,
        active: input.active,
      },
    ],
    { skipInvalidRows: true, ignoreUnknownValues: true },
  );
  const row: EvalReviewClaim = {
    conversationId: input.conversationId,
    claimedBy: input.claimedBy,
    claimedAt,
  };
  rememberClaim({ ...row, active: input.active });
  return row;
}

type LatestClaimRow = EvalReviewClaim & { active: boolean };

async function latestClaimRow(conversationId: string): Promise<LatestClaimRow | null> {
  const id = conversationId.trim();
  if (!id) return null;
  await ensureEvalReviewClaimTable();
  const sql = growthBq.resultsSql(TABLE);
  let bq: LatestClaimRow | null = null;
  try {
    const [rows] = await getBQ().query({
      query: `
        select conversation_id, claimed_by, claimed_at, active
        from ${sql}
        where conversation_id = @conversation_id
        order by claimed_at desc
        limit 1
      `,
      params: { conversation_id: id },
      ...loc(),
    });
    const raw = (rows as Record<string, unknown>[])[0];
    if (raw) {
      const claim = rowToClaim(raw);
      if (claim) bq = { ...claim, active: raw.active === true };
    }
  } catch (e) {
    console.warn("[evalReviewClaimStore] latest fallback:", e instanceof Error ? e.message : e);
  }
  if (bq) hydrateClaim(bq);
  return mergeClaimLatest(bq, id);
}

export async function getActiveClaim(conversationId: string): Promise<EvalReviewClaim | null> {
  const latest = await latestClaimRow(conversationId);
  return latest?.active ? { conversationId: latest.conversationId, claimedBy: latest.claimedBy, claimedAt: latest.claimedAt } : null;
}

/** conversation별 최신 행이 active 인 찜 */
export async function listActiveClaimsByConversationIds(
  conversationIds: string[],
): Promise<Map<string, EvalReviewClaim>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  const out = new Map<string, EvalReviewClaim>();
  if (!ids.length) return out;
  await ensureEvalReviewClaimTable();
  const sql = growthBq.resultsSql(TABLE);
  try {
    const [rows] = await getBQ().query({
      query: `
        select conversation_id, claimed_by, claimed_at, active
        from ${sql}
        where conversation_id in unnest(@ids)
        qualify row_number() over (partition by conversation_id order by claimed_at desc) = 1
      `,
      params: { ids },
      ...loc(),
    });
    for (const raw of rows as Record<string, unknown>[]) {
      const claim = rowToClaim(raw);
      if (!claim) continue;
      const active = raw.active === true;
      hydrateClaim({ ...claim, active });
      if (active) out.set(claim.conversationId, claim);
    }
  } catch (e) {
    console.warn("[evalReviewClaimStore] listByIds fallback:", e instanceof Error ? e.message : e);
  }
  return applyClaimOverlayToActiveMap(out);
}

export async function listActiveClaimConversationIdsBy(email: string, limit = 500): Promise<string[]> {
  const who = email.trim();
  if (!who) return [];
  const lim = Math.min(Math.max(1, Math.floor(limit)), 1000);
  await ensureEvalReviewClaimTable();
  const sql = growthBq.resultsSql(TABLE);
  try {
    const [rows] = await getBQ().query({
      query: `
        select conversation_id, claimed_by, claimed_at, active
        from (
          select conversation_id, claimed_by, claimed_at, active,
            row_number() over (partition by conversation_id order by claimed_at desc) as rn
          from ${sql}
          where conversation_id in (
            select distinct conversation_id from ${sql} where claimed_by = @email
          )
        )
        where rn = 1
        limit @lim
      `,
      params: { email: who, lim },
      ...loc(),
    });
    const bqIds: string[] = [];
    for (const raw of rows as Record<string, unknown>[]) {
      const claim = rowToClaim(raw);
      if (!claim) continue;
      const active = raw.active === true;
      hydrateClaim({ ...claim, active });
      if (active && sameEmail(claim.claimedBy, who)) bqIds.push(claim.conversationId);
    }
    return mergeMyActiveClaimIds(who, bqIds).slice(0, lim);
  } catch (e) {
    console.warn("[evalReviewClaimStore] listMine fallback:", e instanceof Error ? e.message : e);
    return mergeMyActiveClaimIds(who, []);
  }
}

/** 검수 찜하기. 이미 내가 찜한 경우 그대로 반환. 다른 구성원이 찜한 경우 conflict. */
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
  return insertClaimRow({ conversationId, claimedBy, active: true });
}

/**
 * 검수 찜 해제.
 * force=true 이면 다른 구성원 찜도 해제(검수 완료 시).
 */
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
  await insertClaimRow({ conversationId, claimedBy: releasedBy || latest.claimedBy, active: false });
}

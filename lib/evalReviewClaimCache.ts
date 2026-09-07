import type { EvalReviewClaim } from "./evalReviewClaim";
import { sameEmail } from "./evalReviewClaim";
import type { EvaluationSample } from "./types";

export type ClaimOverlay = EvalReviewClaim & { active: boolean };

/** BQ 스트리밍 insert 가 조회에 반영되기 전까지 최신 찜 상태를 유지 */
const CLAIM_TTL_MS = 45 * 60 * 1000;
/** 녹취 카드 스냅샷 — 내 평가에서 찜한 케이스를 바로 붙일 때 */
const SAMPLE_TTL_MS = 2 * 60 * 60 * 1000;
const SAMPLE_MAX = 1500;

type Timed<T> = { at: number; value: T };

const claims = new Map<string, Timed<ClaimOverlay>>();
const samples = new Map<string, Timed<EvaluationSample>>();

function pruneClaims(now = Date.now()): void {
  for (const [id, row] of claims) {
    if (now - row.at > CLAIM_TTL_MS) claims.delete(id);
  }
}

function pruneSamples(now = Date.now()): void {
  if (samples.size <= SAMPLE_MAX) {
    for (const [id, row] of samples) {
      if (now - row.at > SAMPLE_TTL_MS) samples.delete(id);
    }
    return;
  }
  const ordered = [...samples.entries()].sort((a, b) => a[1].at - b[1].at);
  const drop = samples.size - SAMPLE_MAX + 50;
  for (let i = 0; i < drop && i < ordered.length; i++) samples.delete(ordered[i][0]);
}

function newerIso(a: string, b: string): boolean {
  return a >= b;
}

/** insert/해제 직후. 항상 최신으로 덮어씀 */
export function rememberClaim(row: ClaimOverlay): void {
  const conversationId = row.conversationId.trim();
  if (!conversationId) return;
  claims.set(conversationId, {
    at: Date.now(),
    value: {
      conversationId,
      claimedBy: row.claimedBy,
      claimedAt: row.claimedAt,
      active: row.active,
    },
  });
}

/** BQ 조회 결과를 캐시에 넣되, 이미 더 최신 쓰기가 있으면 유지 */
export function hydrateClaim(row: ClaimOverlay): void {
  const conversationId = row.conversationId.trim();
  if (!conversationId) return;
  const cur = claims.get(conversationId);
  if (cur && newerIso(cur.value.claimedAt, row.claimedAt) && cur.value.claimedAt !== row.claimedAt) {
    return;
  }
  if (cur && cur.value.claimedAt === row.claimedAt && cur.value.active === row.active) {
    cur.at = Date.now();
    return;
  }
  rememberClaim(row);
}

export function overlayClaim(conversationId: string): ClaimOverlay | null {
  pruneClaims();
  return claims.get(conversationId.trim())?.value ?? null;
}

export function mergeClaimLatest(bq: ClaimOverlay | null, conversationId: string): ClaimOverlay | null {
  const mem = overlayClaim(conversationId);
  if (!mem) return bq;
  if (!bq) return mem;
  return newerIso(mem.claimedAt, bq.claimedAt) ? mem : bq;
}

export function applyClaimOverlayToActiveMap(bq: Map<string, EvalReviewClaim>): Map<string, EvalReviewClaim> {
  pruneClaims();
  const out = new Map(bq);
  for (const { value } of claims.values()) {
    if (value.active) {
      out.set(value.conversationId, {
        conversationId: value.conversationId,
        claimedBy: value.claimedBy,
        claimedAt: value.claimedAt,
      });
    } else {
      out.delete(value.conversationId);
    }
  }
  return out;
}

export function mergeMyActiveClaimIds(email: string, bqIds: string[]): string[] {
  pruneClaims();
  const set = new Set(bqIds.filter(Boolean));
  for (const { value } of claims.values()) {
    if (sameEmail(value.claimedBy, email) && value.active) set.add(value.conversationId);
    else if (!value.active) set.delete(value.conversationId);
  }
  return [...set];
}

export function rememberEvalSamples(rows: EvaluationSample[]): void {
  const now = Date.now();
  for (const row of rows) {
    const id = row.conversationId?.trim();
    if (!id) continue;
    samples.set(id, { at: now, value: row });
  }
  pruneSamples(now);
}

export function cachedEvalSamplesFor(ids: string[]): EvaluationSample[] {
  pruneSamples();
  const out: EvaluationSample[] = [];
  for (const id of ids) {
    const hit = samples.get(id)?.value;
    if (hit) out.push(hit);
  }
  return out;
}

export function resetEvalReviewClaimCacheForTests(): void {
  claims.clear();
  samples.clear();
}

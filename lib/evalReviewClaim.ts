export function handleOf(email: string): string {
  const t = email.trim();
  const at = t.indexOf("@");
  return at > 0 ? t.slice(0, at) : t;
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

export type EvalReviewClaim = {
  conversationId: string;
  claimedBy: string;
  claimedAt: string;
};



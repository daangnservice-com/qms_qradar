const CHECKOUT_KEY = "hx:reviewStatus:checkout:v1";

export type ReviewStatusCheckout = {
  conversationId: string;
  adminName?: string;
  callDate?: string;
  /** 검수 현황으로 복귀할 URL (쿼리 포함) */
  returnHref: string;
  openedAt: string;
};

function canUse(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function saveReviewStatusCheckout(checkout: ReviewStatusCheckout): void {
  if (!canUse()) return;
  try {
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(checkout));
  } catch {
    /* quota */
  }
}

export function loadReviewStatusCheckout(): ReviewStatusCheckout | null {
  if (!canUse()) return null;
  try {
    const raw = sessionStorage.getItem(CHECKOUT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReviewStatusCheckout;
  } catch {
    return null;
  }
}

export function clearReviewStatusCheckout(): void {
  if (!canUse()) return;
  try {
    sessionStorage.removeItem(CHECKOUT_KEY);
  } catch {
    /* ignore */
  }
}

export function buildReviewStatusDeepLink(conversationId: string): string {
  const q = new URLSearchParams({
    conversationId,
    from: "review-status",
  });
  return `/call-quality?${q.toString()}`;
}

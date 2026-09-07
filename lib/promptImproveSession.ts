import type {
  PromptImproveExample,
  PromptImproveKind,
  PromptImproveSet,
} from "@/lib/promptImproveTypes";
import { buildCallQualityDeepLink as buildCallQualityDeepLinkBase } from "@/lib/callQualityDeepLink";

const DRAFT_KEY = "hx:promptImprove:draft:v1";
const CHECKOUT_KEY = "hx:promptImprove:checkout:v1";

export type PromptImproveDraft = {
  setTab: PromptImproveSet;
  selectedCriterionId: number | null;
  selectedPromptId: string | null;
  checkedIds: string[];
  kindFilter: "all" | PromptImproveKind;
  userNote: string;
  proposed: Record<string, string> | null;
  rationale: string | null;
};

export type PromptImproveCheckout = {
  example: PromptImproveExample;
  openedAt: string;
};

function canUse(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function savePromptImproveDraft(draft: PromptImproveDraft): void {
  if (!canUse()) return;
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota */
  }
}

export function loadPromptImproveDraft(): PromptImproveDraft | null {
  if (!canUse()) return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PromptImproveDraft;
  } catch {
    return null;
  }
}

export function savePromptImproveCheckout(checkout: PromptImproveCheckout): void {
  if (!canUse()) return;
  try {
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(checkout));
  } catch {
    /* quota */
  }
}

export function loadPromptImproveCheckout(): PromptImproveCheckout | null {
  if (!canUse()) return null;
  try {
    const raw = sessionStorage.getItem(CHECKOUT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PromptImproveCheckout;
  } catch {
    return null;
  }
}

export function clearPromptImproveCheckout(): void {
  if (!canUse()) return;
  try {
    sessionStorage.removeItem(CHECKOUT_KEY);
  } catch {
    /* ignore */
  }
}

/** 평가 진행 딥링크 (+ 프롬프트 개선 복귀 플래그) */
export function buildCallQualityDeepLink(conversationId: string): string {
  return buildCallQualityDeepLinkBase(conversationId, { from: "prompt-improve" });
}

export function isPromptImproveDeepLink(): boolean {
  if (typeof window === "undefined") return false;
  const sp = new URLSearchParams(window.location.search);
  return (sp.get("from") || "").trim() === "prompt-improve";
}

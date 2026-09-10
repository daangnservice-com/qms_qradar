/** 콜 품질 평가 진행(/call-quality) 딥링크 파라미터 */

export type CallQualityDeepLink = {
  conversationId: string | null;
  /** 상담이력 ID (phone_inquiry_id) — conversationId 없을 때 BQ에서 통화 조회 */
  inquiryId: string | null;
  /** true면 conversationId 로드 후 자동 AI 평가 시도 */
  autoEval: boolean;
  /** true면 STT·오디오만 보는 관찰 모드(평가 UI 숨김) */
  observe: boolean;
  /** observe 모드에서 STT가 없을 때 자동 전사 시도 */
  autoStt: boolean;
};

const TRUTHY = new Set(["1", "true", "yes"]);

export function isTruthyQueryParam(raw: string | null | undefined): boolean {
  return TRUTHY.has((raw ?? "").trim().toLowerCase());
}

function parseInquiryId(sp: URLSearchParams): string | null {
  const raw =
    sp.get("inquiry_id") ||
    sp.get("inquiryId") ||
    sp.get("phone_inquiry_id") ||
    sp.get("phoneInquiryId") ||
    "";
  return raw.trim() || null;
}

export function parseCallQualityDeepLink(
  input: URLSearchParams | string,
): CallQualityDeepLink {
  const sp = typeof input === "string" ? new URLSearchParams(input) : input;
  const conversationId =
    (sp.get("conversationId") || sp.get("conversation_id") || "").trim() || null;
  const inquiryId = parseInquiryId(sp);
  const autoEval = isTruthyQueryParam(sp.get("autoEval") || sp.get("auto_eval") || sp.get("eval"));
  const observe = isTruthyQueryParam(sp.get("observe"));
  const autoStt = isTruthyQueryParam(sp.get("autoStt") || sp.get("auto_stt"));
  return { conversationId, inquiryId, autoEval, observe, autoStt };
}

export function readCallQualityDeepLink(): CallQualityDeepLink {
  if (typeof window === "undefined") {
    return { conversationId: null, inquiryId: null, autoEval: false, observe: false, autoStt: false };
  }
  return parseCallQualityDeepLink(window.location.search);
}

export function isCallQualityObserveMode(input?: URLSearchParams | string): boolean {
  return parseCallQualityDeepLink(input ?? (typeof window !== "undefined" ? window.location.search : "")).observe;
}

export type CallQualityObserveLinkTarget = {
  conversationId?: string;
  inquiryId?: string;
};

/** 평가 진행 딥링크 (기본 — 기존 배포 링크와 동일 동작) */
export function buildCallQualityDeepLink(
  target: string | CallQualityObserveLinkTarget,
  opts?: { autoEval?: boolean; from?: string },
): string {
  const resolved = typeof target === "string" ? { conversationId: target } : { ...target };
  const q = new URLSearchParams();
  if (resolved.conversationId?.trim()) q.set("conversationId", resolved.conversationId.trim());
  if (resolved.inquiryId?.trim()) q.set("inquiry_id", resolved.inquiryId.trim());
  if (opts?.autoEval) q.set("autoEval", "1");
  if (opts?.from) q.set("from", opts.from);
  return `/call-quality?${q.toString()}`;
}

/** STT·오디오만 듣는 관찰 모드 딥링크 */
export function buildCallQualityObserveDeepLink(
  target: string | CallQualityObserveLinkTarget,
  opts?: { autoStt?: boolean },
): string {
  const resolved =
    typeof target === "string" ? { conversationId: target } : { ...target };
  const q = new URLSearchParams({ observe: "1" });
  if (resolved.conversationId?.trim()) q.set("conversationId", resolved.conversationId.trim());
  if (resolved.inquiryId?.trim()) q.set("inquiry_id", resolved.inquiryId.trim());
  if (opts?.autoStt) q.set("autoStt", "1");
  return `/call-quality?${q.toString()}`;
}

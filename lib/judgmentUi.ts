/** Hot/Cold · AI/수기 뱃지 톤 — 서로 겹치지 않게 고정 */
export type JudgmentBadgeTone = "informative" | "warning" | "neutral" | "brand";

/** Cold = 파랑, Hot = 주황 */
export function hotColdTone(coldOrHot: "cold" | "hot" | boolean): "informative" | "warning" {
  const cold = coldOrHot === true || coldOrHot === "cold";
  return cold ? "informative" : "warning";
}

export function hotColdLabel(coldOrHot: "cold" | "hot" | boolean): "Cold" | "Hot" {
  const cold = coldOrHot === true || coldOrHot === "cold";
  return cold ? "Cold" : "Hot";
}

/** 검토 필요 = 파랑(informative), 불필요 = 주황(warning). 기존 Cold/Hot 톤과 동일. */
export function reviewNeededTone(needed: boolean): "informative" | "warning" {
  return needed ? "informative" : "warning";
}

export function reviewNeededLabel(needed: boolean): "검토 필요" | "검토 불필요" {
  return needed ? "검토 필요" : "검토 불필요";
}

/** 저장 라벨(review_needed/cold 등) → 화면 문구 */
export function displayReviewNeededLabel(raw: string | null | undefined): string {
  const n = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (n === "review_needed" || n === "cold") return "검토 필요";
  if (n === "review_not_needed" || n === "hot") return "검토 불필요";
  return raw?.trim() || "—";
}

export function isReviewNeededRaw(raw: string | null | undefined): boolean | null {
  const n = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (n === "review_needed" || n === "cold") return true;
  if (n === "review_not_needed" || n === "hot") return false;
  return null;
}

/** AI 출처 — 회색(Hot/Cold·수기와 대비) */
export const SOURCE_AI_TONE: JudgmentBadgeTone = "neutral";

/** 수기 출처 — 브랜드 주황(AI·Cold 파랑과 대비) */
export const SOURCE_HUMAN_TONE: JudgmentBadgeTone = "brand";

/** 재생바 마커용 CSS 변수 */
export function hotColdTrackColor(tone: "cold" | "hot" | "best"): string {
  if (tone === "cold") return "bg-[var(--info)]";
  if (tone === "best") return "bg-[var(--warning)]";
  return "bg-[var(--c-carrot-500)]";
}

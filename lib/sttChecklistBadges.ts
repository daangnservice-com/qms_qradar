import { coerceAtSec, isCustomerContextQuote } from "./atSecNormalize";
import { buildCriterionMetaMap, type CriterionLabelSource } from "./criterionLabel";
import type { ChecklistResult, TranscriptSegment } from "./types";

export type SttChecklistBadge = {
  key: string;
  criterionId: number;
  label: string;
  category: string;
  violated: boolean;
  reason: string;
  evidenceAtSec: number;
  /** 뱃지 앵커용 상담원(평가 대상) quote */
  quote: string;
  /** 같은 항목의 고객 맥락 quote (뱃지는 달지 않고 상세에만 표시) */
  contextQuotes: string[];
  /** 배지가 붙은 STT 세그먼트 인덱스 */
  segmentIndex: number;
};

export function isAgentSpeaker(speaker: string): boolean {
  return /상담|agent/i.test(String(speaker ?? ""));
}

/** evidence.atSec → 가장 가까운(이전이거나 동일) STT 발화 인덱스 */
export function nearestSegmentIndex(atSec: number, segments: { atSec: number }[]): number {
  if (!segments.length) return -1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const d = Math.abs(segments[i].atSec - atSec);
    // 동거리면 이전·동일 시각 발화 선호 (발화 시작 ≤ evidence)
    const prefer =
      d < bestDist ||
      (d === bestDist && segments[i].atSec <= atSec && segments[best].atSec > atSec);
    if (prefer) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** 상담원 발화 중 atSec에 가장 가까운 세그먼트. 없으면 전체 중 최근접. */
export function nearestAgentSegmentIndex(atSec: number, segments: TranscriptSegment[]): number {
  if (!segments.length) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    if (!isAgentSpeaker(segments[i].speaker)) continue;
    const d = Math.abs(segments[i].atSec - atSec);
    const prefer =
      d < bestDist ||
      (d === bestDist &&
        segments[i].atSec <= atSec &&
        (best < 0 || segments[best].atSec > atSec));
    if (prefer) {
      bestDist = d;
      best = i;
    }
  }
  return best >= 0 ? best : nearestSegmentIndex(atSec, segments);
}

/**
 * 체크리스트 evidence를 STT 세그먼트에 붙일 뱃지로 변환.
 * - `고객:` 맥락 quote는 뱃지 미생성(상세 contextQuotes로만 전달)
 * - 뱃지는 상담원 발화 세그먼트에만 배치
 */
export function buildSttChecklistBadges(
  segments: TranscriptSegment[],
  checklist: ChecklistResult[] | null | undefined,
  /** 평가 당시 promptConfig.criteria. 없으면 CS_CHECKLIST 폴백. */
  criteria?: CriterionLabelSource[] | null,
): SttChecklistBadge[] {
  if (!segments.length || !checklist?.length) return [];

  const labelById = buildCriterionMetaMap(criteria);
  const sttHints = segments.map((s) => ({ atSec: s.atSec, text: s.text }));
  const out: SttChecklistBadge[] = [];

  for (const item of checklist) {
    const meta = labelById.get(item.id);
    const label = meta?.label ?? `항목 ${item.id}`;
    const category = meta?.category ?? "";
    const evidences = item.evidence?.length
      ? item.evidence
      : item.violated
        ? [] // 위반인데 evidence 없으면 배치 불가
        : [];

    const contextQuotes = evidences
      .map((e) => e.quote ?? "")
      .filter((q) => q && isCustomerContextQuote(q));
    const anchorEvs = evidences.filter((e) => !isCustomerContextQuote(e.quote ?? ""));

    // 상담원 quote가 없고 고객 맥락만 있으면 뱃지 스킵 (고객 발화에 달지 않음)
    if (!anchorEvs.length) continue;

    anchorEvs.forEach((ev, ei) => {
      const at = coerceAtSec(ev.atSec, { quote: ev.quote, stt: sttHints });
      const segIdx = nearestAgentSegmentIndex(at, segments);
      if (segIdx < 0) return;
      out.push({
        key: `${item.id}-${ei}-${at}`,
        criterionId: item.id,
        label,
        category,
        violated: item.violated,
        reason: item.reason ?? "",
        evidenceAtSec: at,
        quote: ev.quote ?? "",
        contextQuotes,
        segmentIndex: segIdx,
      });
    });
  }

  return out;
}

export function badgesBySegment(badges: SttChecklistBadge[]): Map<number, SttChecklistBadge[]> {
  const m = new Map<number, SttChecklistBadge[]>();
  for (const b of badges) {
    const list = m.get(b.segmentIndex) ?? [];
    list.push(b);
    m.set(b.segmentIndex, list);
  }
  return m;
}

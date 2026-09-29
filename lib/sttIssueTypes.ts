import type { LocalSttSegmentDetail } from "./localSttQuality";
import type { SttSource, TranscriptSegment } from "./types";

/** STT 이상현상 리포팅 이슈 타입. */
export const STT_ISSUE_TYPES = [
  { id: "missing_speech", label: "발화 누락이 많음", hint: "말했던 구간이 전사에 없거나 크게 비어 있어요." },
  { id: "silent_channel", label: "한쪽 채널이 비어 있음", hint: "상담원 또는 고객 쪽 전사가 거의 없어요." },
  { id: "speaker_swap", label: "화자가 뒤바뀜", hint: "상담원/고객 라벨이 반대로 붙어 있어요." },
  { id: "timing_skew", label: "타임스탬프가 어긋남", hint: "재생 시점과 전사가 맞지 않아요." },
  { id: "garbled", label: "인식 오류가 심함", hint: "텍스트가 알아보기 어렵거나 반복·깨짐이 심해요." },
  { id: "other", label: "기타", hint: "위에 없는 이상이에요. 코멘트를 남겨 주세요." },
] as const;

export type SttIssueTypeId = (typeof STT_ISSUE_TYPES)[number]["id"];

export function isSttIssueTypeId(v: unknown): v is SttIssueTypeId {
  return STT_ISSUE_TYPES.some((t) => t.id === v);
}

export function sttIssueTypeLabel(id: string | null | undefined): string {
  return STT_ISSUE_TYPES.find((t) => t.id === id)?.label ?? id ?? "이슈";
}

export type SttIssueReport = {
  reportId: string;
  conversationId: string;
  issueType: SttIssueTypeId;
  sttSource: SttSource | null;
  comment: string;
  transcript: TranscriptSegment[];
  transcriptText: string;
  reportedBy: string;
  reportedAt: string;
  agentName: string | null;
  callDate: string | null;
  org: string | null;
  /** 로컬 STT job id. 없으면 스냅샷을 못 남긴 전사다. */
  remoteJobId: string | null;
  sttOptions: Record<string, unknown> | null;
  segments: LocalSttSegmentDetail[];
};

export type SttIssueEnqueueTarget = {
  conversationId: string;
  agentName: string;
  team: string;
  callDate: string;
};

/**
 * 이슈 리포트에서 로컬 STT로 다시 넣을 콜.
 * 같은 콜은 한 번만. 리포트가 GCP뿐인 콜은 로컬 큐에 넣지 않는다.
 * reports는 최신 리포트가 앞이라고 가정한다.
 */
export function issueReportEnqueueTargets(
  reports: Pick<SttIssueReport, "conversationId" | "sttSource" | "agentName" | "callDate" | "org">[],
): SttIssueEnqueueTarget[] {
  const seen = new Set<string>();
  const out: SttIssueEnqueueTarget[] = [];
  for (const report of reports) {
    const conversationId = report.conversationId.trim();
    if (!conversationId || seen.has(conversationId)) continue;
    if (report.sttSource === "gcp") continue;
    seen.add(conversationId);
    out.push({
      conversationId,
      agentName: (report.agentName ?? "").trim(),
      team: (report.org ?? "").trim(),
      callDate: (report.callDate ?? "").trim(),
    });
  }
  return out;
}

export function formatSttIssueTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const speaker = (s.speaker ?? "").trim() || "화자";
      const text = (s.text ?? "").trim();
      if (!text) return "";
      const sec = Number(s.atSec ?? 0);
      const m = Math.floor(sec / 60);
      const r = Math.floor(sec % 60);
      return `[${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}] ${speaker}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

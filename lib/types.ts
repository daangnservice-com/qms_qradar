export interface Silence { startSec: number; endSec: number; durationSec: number; }
export interface SilenceSummary { count: number; totalSec: number; longestSec: number; silenceRatio: number; }
export interface Threshold { minSilenceSec: number; noiseDb: number; }
export interface ScoreDetail { score: number; comment: string; }
export interface TranscriptSegment { atSec: number; speaker: string; text: string; }
export interface Evaluation {
  scores: { attitude: ScoreDetail; resolution: ScoreDetail; flow: ScoreDetail };
  overallSummary: string;
  silenceComments: { atSec: number; note: string }[];
  transcript: TranscriptSegment[];
  error: string | null;
}
export interface EvaluationResult {
  durationSec: number;
  threshold: Threshold;
  silences: Silence[];
  silenceSummary: SilenceSummary;
  evaluation: Evaluation;
}

export type DamageVerdict = "파손됨" | "정상" | "불확실";
// 분쟁조정: claimant=신청인(파손 주장), respondent=피신청인(반박)
export type DamageParty = "claimant" | "respondent";
export const PARTY_LABEL: Record<DamageParty, string> = { claimant: "신청인", respondent: "피신청인" };
export interface BoundingBox { ymin: number; xmin: number; ymax: number; xmax: number; }
export interface DamageFinding {
  location: string;
  type: string;
  description: string;
  photoIndex: number; // 통합 인덱스(신청인 사진 먼저, 그 뒤 피신청인)
  party: DamageParty;
  box: BoundingBox | null;
}
export interface PerPhotoNote { index: number; note: string; }
export interface DamageChatMessage { role: "user" | "model"; text: string; }
export type FeedbackRating = "good" | "bad";
// 관리자 리뷰 뷰가 소비하는 피드백 1건(이미지는 signed URL로 지연 제공)
export interface DamageFeedbackRow {
  ts: string;
  feedbackId: string;
  userEmail: string;
  rating: FeedbackRating;
  comment: string;
  verdict: DamageVerdict;
  confidence: number;
  comparison: string;
  summary: string;
  promptVersion: string;
  model: string;
  claimantCount: number;
  respondentCount: number;
  imagePaths: string[]; // GCS object 경로들
}
export interface FeedbackStats {
  total: number;
  good: number;
  bad: number;
  byVersion: { promptVersion: string; good: number; bad: number }[];
  recent: DamageFeedbackRow[];
}
// 챗봇 트래킹(관리자 뷰용)
export interface ChatTurnRow {
  ts: string;
  messageId: string;
  userEmail: string;
  question: string;
  answer: string;
  verdict: string;
  promptVersion: string;
  rating: FeedbackRating | null; // 답변에 대한 최신 평가(없으면 null)
}
export interface ChatStats {
  totalTurns: number;
  good: number;
  bad: number;
  recent: ChatTurnRow[];
}
export interface DamageResult {
  verdict: DamageVerdict;
  confidence: number;
  summary: string;
  comparison: string; // 양측 사진 간 파손 표현의 차이/불일치 소견
  findings: DamageFinding[];
  perPhoto: PerPhotoNote[];
  claimantCount: number;
  respondentCount: number;
  promptVersion: string;
}

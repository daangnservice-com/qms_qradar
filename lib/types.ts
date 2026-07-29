export interface Silence { startSec: number; endSec: number; durationSec: number; }
export interface SilenceSummary { count: number; totalSec: number; longestSec: number; silenceRatio: number; }
export interface Threshold { minSilenceSec: number; noiseDb: number; }
export interface ScoreDetail { score: number; comment: string; }
export interface TranscriptSegment { atSec: number; speaker: string; text: string; }
// CS 영역 체크리스트 1개 항목의 AI 판정. id=evaluation_criterions_id(lib/csChecklist.ts).
export interface ChecklistEvidence { atSec: number; quote: string; }
export interface ChecklistResult { id: number; violated: boolean; evidence: ChecklistEvidence[]; reason: string; }
export interface Evaluation {
  scores: { attitude: ScoreDetail; resolution: ScoreDetail; flow: ScoreDetail };
  overallSummary: string;
  silenceComments: { atSec: number; note: string }[];
  transcript: TranscriptSegment[];
  csChecklist?: ChecklistResult[]; // CS 영역 감점 체크리스트(구버전 저장분엔 없음 → optional)
  error: string | null;
}
export interface EvaluationResult {
  durationSec: number;
  threshold: Threshold;
  silences: Silence[];
  silenceSummary: SilenceSummary;
  evaluation: Evaluation;
  conversationId?: string; // Genesys 대화 ID(샘플 평가 출처)
  analysisId?: string; // 저장된 분석 결과 id(공유 URL 키)
}

// /api/evaluate NDJSON 스트림 이벤트. 분석이 길어도(10분+ 통화) 앞단 LB가 연결을 끊지 않도록
// 처리 중 진행/하트비트를 계속 흘려보내고, 마지막에 result 또는 error로 끝난다.
export type EvaluateStep = "genesys" | "download" | "transcode" | "analyze" | "save";
export type EvaluateEvent =
  | { type: "progress"; step: EvaluateStep; elapsedMs: number }
  | { type: "heartbeat"; elapsedMs: number }
  | { type: "result"; result: EvaluationResult }
  | { type: "error"; message: string };

// 콜 분석 샘플 목록 필터. 배열은 다중선택(비면 미적용), 날짜는 YYYY-MM-DD, 통화시간은 분(minutes).
export interface SampleFilters {
  conversationIds?: string[]; // genesys_conversation_id
  phoneInquiryIds?: string[]; // 상담이력 ID
  adminUserIds?: string[]; // Admin ID (상담사 유저 ID)
  adminNames?: string[]; // Admin Name (상담사 닉네임)
  teams?: string[]; // operator_renewal_team_name (상담사 소속)
  categories?: string[]; // 카테고리
  callDateStart?: string | null; // 콜 날짜(KST) >= (YYYY-MM-DD)
  callDateEnd?: string | null; // 콜 날짜(KST) <= (YYYY-MM-DD)
  callLenMin?: number | null; // minutes_taken >= (분)
  callLenMax?: number | null; // minutes_taken <= (분)
}

// BigQuery 평가 테이블(qradar_evaluation_cases)에서 고른 콜 분석 대상 샘플 1건.
export interface EvaluationSample {
  conversationId: string; // Genesys conversation_id → 녹취 확보 키
  phoneInquiryId: string; // 상담이력 ID
  adminName: string; // 상담사 닉네임(Admin Name)
  team: string; // 상담사 소속(operator_renewal_team_name)
  category: string; // 카테고리
  callDate: string; // 콜 날짜(call_start를 KST로 변환, YYYY-MM-DD)
  contentSnippet: string; // 상담이력 미리보기(앞부분)
  callDurationSec: number | null; // 통화 길이(초). call_end-call_start 우선, minutes_taken 폴백
  analyzed: boolean; // 저장된 분석 결과 존재 여부(완료 표시·세션 넘어 유지)
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

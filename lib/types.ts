import type { OutputSchemaSnapshot, SchemaFieldSource, SchemaValueType } from "./promptTypes";
import type { EvaluationChannel, EvaluationTurn } from "./evaluationChannel";

export interface Silence { startSec: number; endSec: number; durationSec: number; }
export interface SilenceSummary { count: number; totalSec: number; longestSec: number; silenceRatio: number; }
export interface Threshold { minSilenceSec: number; noiseDb: number; }
export interface ScoreDetail { score: number; comment: string; }
/** percent/bool/label 등 typed 메트릭(점수 1~5와 분리). */
export interface MetricDetail {
  valueType: SchemaValueType;
  value: number | boolean | string | null;
  comment?: string;
  source: SchemaFieldSource;
}
/** 평가 결과에 붙은 고위험 플래그 히트. */
export interface HighRiskFlagHit {
  key: string;
  label: string;
  reason: string;
}
export interface TranscriptSegment { atSec: number; speaker: string; text: string; }
// CS 영역 체크리스트 1개 항목의 AI 판정. id=evaluation_criterions_id(lib/csChecklist.ts).
export interface ChecklistEvidence { atSec: number; quote: string; }
/** 항목 판정: 평가 항목 1개가 이 케이스에서 위반인지. id=evaluation_criterions_id. */
export interface ChecklistResult { id: number; violated: boolean; evidence: ChecklistEvidence[]; reason: string; }
export type OverallSummary = string | Record<string, string>;
export type SttSource = "local" | "gcp";

export function parseSttSource(v: unknown): SttSource | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "local" || s === "gcp" ? s : null;
}
export interface EvaluationPromptCriterionSnapshot {
  id: number;
  category: string;
  label: string;
  hint?: string;
  fields?: Record<string, string>;
}
export interface EvaluationPromptVersionSnapshot {
  versionId: string;
  versionLabel: string;
  status?: "draft" | "production" | "archived";
  templateKey?: string;
}
export interface EvaluationPromptConfigSnapshot {
  version: EvaluationPromptVersionSnapshot;
  criteria: EvaluationPromptCriterionSnapshot[];
}
export interface Evaluation {
  scores: Record<string, ScoreDetail>;
  /** typed 메트릭(percent/bool/label + signal). */
  metrics?: Record<string, MetricDetail>;
  overallSummary: OverallSummary;
  /** 평가 당시 점수·총평 필드 라벨. 없으면 레거시 3점수+문자열 총평. */
  outputSchemaSnapshot?: OutputSchemaSnapshot;
  silenceComments: { atSec: number; note: string }[];
  transcript: TranscriptSegment[];
  csChecklist?: ChecklistResult[]; // CS 영역 감점 체크리스트(구버전 저장분엔 없음 → optional)
  /** 저장 시점 고위험 규칙 매칭 결과(장콜 제외 — 장콜은 목록 조회 시 계산). */
  highRiskFlags?: HighRiskFlagHit[];
  /** 텍스트 채널 원문. 전화는 기존 transcript(STT)를 사용한다. */
  conversation?: EvaluationTurn[];
  error: string | null;
}
export interface EvaluationResult {
  durationSec: number;
  threshold: Threshold;
  silences: Silence[];
  silenceSummary: SilenceSummary;
  /** 말 겹침 구간(파형 오버레이·overlapRatio 근거). 구버전 저장분엔 없을 수 있음. */
  overlaps?: Silence[];
  evaluation: Evaluation;
  conversationId?: string; // Genesys 대화 ID(샘플 평가 출처)
  analysisId?: string; // 저장된 분석 결과 id(공유 URL 키)
  /** 평가 당시 사용한 평가셋/항목 스냅샷. 저장된 과거 결과 UI 재현용. */
  promptConfig?: EvaluationPromptConfigSnapshot;
  channel?: EvaluationChannel;
  sourceSystem?: string;
  sourceId?: string;
  /** 이 평가에 쓰인 STT 엔진. 구버전 저장분은 없음. */
  sttSource?: SttSource | null;
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
  analyzedOnly?: boolean; // AI 평가 완료된 통화만
  /** 수기 검수 완료 여부. 미지정이면 전체 */
  reviewStatus?: "completed" | "incomplete";
  /** 고위험군 플래그가 하나라도 있는 통화만 */
  highRiskOnly?: boolean;
  /** STT 전사 존재 여부. 미지정이면 전체 */
  sttStatus?: "present" | "absent";
  /**
   * 내 평가: 내가 남긴 수기 주석이 1개 이상이거나 검수 찜한 케이스.
   * 수기 검수 완료분은 제외.
   */
  mineOnly?: boolean;
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
  analyzed: boolean; // AI 평가 완료 여부
  reviewCompleted?: boolean; // 수기 검수 완료 여부
  /** AI 검토필요 라벨 (평가 완료 시) */
  aiLabel?: string | null;
  /** 수기 검토필요 라벨 (검수 완료 시) */
  humanResult?: string | null;
  /** 고위험 플래그 키 목록(장콜·발화비율·격앙 등) */
  highRiskFlagKeys?: string[];
  /** 검수 찜하기(진행 중) 구성원 이메일 */
  reviewClaimedBy?: string | null;
  reviewClaimedAt?: string | null;
  /** STT 전사 존재 여부(배치·평가 저장분) */
  hasStt?: boolean;
  /** STT 출처(있을 때만) */
  sttSource?: SttSource | null;
}

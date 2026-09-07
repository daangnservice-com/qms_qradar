import type { PromptTemplateKey } from "./promptDefaults";
import type { AudioPipelineConfig } from "./audioPipeline";
import { DEFAULT_AUDIO_PIPELINE_CONFIG, parseAudioPipelineConfig, TEXT_AUDIO_PIPELINE_CONFIG } from "./audioPipeline";

export type { AudioPipelineConfig };
export { DEFAULT_AUDIO_PIPELINE_CONFIG, parseAudioPipelineConfig, TEXT_AUDIO_PIPELINE_CONFIG };

export type PromptStatus = "draft" | "production" | "archived";

/** 수기 검수 적용 범위: 발화별 또는 한 상담 전체 */
export type CriterionReviewScope = "occurrence" | "conversation";
export const DEFAULT_CRITERION_REVIEW_SCOPE: CriterionReviewScope = "occurrence";

export function parseCriterionReviewScope(raw: unknown): CriterionReviewScope {
  return raw === "conversation" ? "conversation" : DEFAULT_CRITERION_REVIEW_SCOPE;
}

/** 항목별 프롬프트 구성 키(정의/사례 등). 설정으로 추가·삭제 가능. */
export interface PromptFieldKey {
  key: string;
  label: string;
  sortOrder: number;
  enabled: boolean;
}

/** 출력 스키마 값 형태. score=1~5, percent=0~100, bool, label=짧은 문자열. */
export type SchemaValueType = "score" | "percent" | "bool" | "label";
/** llm=모델 응답, signal=STT/overlap 등 파이프라인 계산(응답 스키마 제외). */
export type SchemaFieldSource = "llm" | "signal";

/** 점수·총평·메트릭 등 출력 스키마 필드. key는 Gemini JSON 키(또는 signal 메트릭 키). */
export interface SchemaField {
  key: string;
  label: string;
  sortOrder: number;
  /** 기본 score (레거시 1~5). */
  valueType?: SchemaValueType;
  /** 기본 llm. signal이면 평가 후 계산·저장만. */
  source?: SchemaFieldSource;
  /** 프롬프트에 넣을 정의·판정 기준(LLM 필드에 특히 중요). */
  definition?: string;
}

export const DEFAULT_SCORE_FIELDS: SchemaField[] = [
  { key: "attitude", label: "응대 태도", sortOrder: 1, valueType: "score", source: "llm" },
  { key: "resolution", label: "문제 해결력", sortOrder: 2, valueType: "score", source: "llm" },
  { key: "flow", label: "대화 흐름", sortOrder: 3, valueType: "score", source: "llm" },
];

/** 하이브리드 메트릭 권장 구성(발화비율·겹침=signal, 격앙=llm). 고위험 플래그·파형 오버레이용. */
export const RECOMMENDED_METRIC_FIELDS: SchemaField[] = [
  {
    key: "agentSpeakRatio",
    label: "상담사 발화 비율",
    sortOrder: 1,
    valueType: "percent",
    source: "signal",
    definition: "STT 발화 구간 기준 상담사 발화 시간 / 전체 발화 시간 × 100. LLM이 채우지 않음.",
  },
  {
    key: "overlapRatio",
    label: "말 겹침 비율",
    sortOrder: 2,
    valueType: "percent",
    source: "signal",
    definition: "동시 발화(말 겹침) 총 시간 / 통화 길이 × 100. LLM이 채우지 않음. 구간은 {{overlaps}}·파형으로 별도 표시.",
  },
  {
    key: "agitated",
    label: "격앙 감지",
    sortOrder: 3,
    valueType: "bool",
    source: "llm",
    definition:
      "녹음 톤·피치·말속도·언성 상승과 STT로 고객 또는 상담원 격앙·분노·고성이 명확하면 true. 단발 강조·가벼운 불편만이면 false. true면 comment에 격앙 구간을 `startSec~endSec 근거` 형식으로(예: `196.0~210.5 고객 고성·욕설`). 여러 구간은 `; `로 구분. false면 comment는 빈 문자열.",
  },
];

/** 평가셋 출력 스키마 UX 설정 → Gemini responseSchema로 변환. */
export interface OutputSchemaConfig {
  includeScores: boolean;
  includeOverallSummary: boolean;
  includeSilenceComments: boolean;
  includeAgentSpeakerTag: boolean;
  includeCsChecklist: boolean;
  checklistFields: {
    id: boolean;
    violated: boolean;
    reason: boolean;
    evidence: boolean;
  };
  /** 비면 기본 3항목(attitude/resolution/flow). */
  scoreFields: SchemaField[];
  /** 비면 overallSummary는 레거시 문자열. 1개 이상이면 object. */
  overallSummaryFields: SchemaField[];
}

/** 평가 당시 필드 라벨. 결과 화면에 스냅샷으로 저장. */
export interface OutputSchemaSnapshot {
  scoreFields: SchemaField[];
  overallSummaryFields: SchemaField[];
}

export const DEFAULT_OUTPUT_SCHEMA_CONFIG: OutputSchemaConfig = {
  includeScores: true,
  includeOverallSummary: true,
  includeSilenceComments: true,
  includeAgentSpeakerTag: true,
  includeCsChecklist: true,
  checklistFields: { id: true, violated: true, reason: true, evidence: true },
  scoreFields: DEFAULT_SCORE_FIELDS.map((f) => ({ ...f })),
  overallSummaryFields: [],
};

export const DEFAULT_FIELD_KEYS: PromptFieldKey[] = [
  { key: "definition", label: "정의", sortOrder: 1, enabled: true },
  { key: "good", label: "좋은 사례", sortOrder: 2, enabled: true },
  { key: "bad", label: "나쁜 사례", sortOrder: 3, enabled: true },
  { key: "exception", label: "예외", sortOrder: 4, enabled: true },
];

/** 콜 단위 AI/수기 검토필요 라벨. 체크리스트 violated=true 와 대응. */
export const REVIEW_NEEDED_LABEL = "review_needed";
export const REVIEW_NOT_NEEDED_LABEL = "review_not_needed";
/** 수기 최종 감안 판정. 매트릭스 양성 클래스가 아님. */
export const FINAL_COLD_LABEL = "cold";
export const FINAL_HOT_LABEL = "hot";

/**
 * LLM 평가 JSON → 검토필요 라벨 파싱 규칙.
 * csChecklist 중 violated=true 1개 이상이면 trueLabel(review_needed).
 */
export interface ResultParseConfig {
  kind: "any_checklist_violated";
  trueLabel: string;
  falseLabel: string;
  sourcePath: "csChecklist";
}

export const DEFAULT_RESULT_PARSE_CONFIG: ResultParseConfig = {
  kind: "any_checklist_violated",
  trueLabel: REVIEW_NEEDED_LABEL,
  falseLabel: REVIEW_NOT_NEEDED_LABEL,
  sourcePath: "csChecklist",
};

export function parseResultParseConfig(raw: unknown): ResultParseConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_RESULT_PARSE_CONFIG };
  const o = raw as Record<string, unknown>;
  return {
    kind: "any_checklist_violated",
    trueLabel: String(o.trueLabel ?? DEFAULT_RESULT_PARSE_CONFIG.trueLabel),
    falseLabel: String(o.falseLabel ?? DEFAULT_RESULT_PARSE_CONFIG.falseLabel),
    sourcePath: "csChecklist",
  };
}

/** 평가셋에서 기준 1개에 프롬프트 버전 1개 바인딩 */
export interface EvalCriterionBinding {
  criterionId: number;
  /** llm_criterion_prompts.prompt_id */
  promptId: string;
  /** 최종 프롬프트 포함 여부 */
  enabled: boolean;
}

export interface PromptVersion {
  versionId: string;
  templateKey: PromptTemplateKey;
  versionLabel: string;
  status: PromptStatus;
  basePrompt: string;
  checklistTemplate: string;
  responseSchemaJson: string;
  /** @deprecated criterionBindings 사용. 하위호환 */
  selectedCriterionIds: number[];
  /** 평가셋: 기준×프롬프트 버전 바인딩 */
  criterionBindings: EvalCriterionBinding[];
  outputSchemaConfig: OutputSchemaConfig;
  /** LLM 결과 → cold/hot 등 파싱 */
  resultParseConfig: ResultParseConfig;
  /** 오디오·신호 분석 파이프라인 */
  audioPipelineConfig: AudioPipelineConfig;
  criteriaJson: string;
  useChecklist: boolean;
  changeNote: string;
  createdAt: string;
  createdBy: string;
}

/** 뷰 원본 1행 */
export interface SourceCriterion {
  id: number;
  type: string;
  parentName: string;
  name: string;
  parentId: number | null;
  extra: string;
}

/** 항목별 프롬프트 버전 (기준 1 : 프롬프트 N) */
export interface CriterionPrompt {
  promptId: string;
  criterionId: number;
  versionLabel: string;
  category: string;
  label: string;
  fields: Record<string, string>;
  /** 수기 검수 적용 범위 */
  reviewScope?: CriterionReviewScope;
  updatedAt: string;
  updatedBy: string;
}

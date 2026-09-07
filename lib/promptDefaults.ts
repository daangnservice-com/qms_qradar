import { CS_CHECKLIST, type CsCriterion } from "./csChecklist";
import { DEFAULT_OUTPUT_SCHEMA_CONFIG, DEFAULT_RESULT_PARSE_CONFIG, type OutputSchemaConfig } from "./promptTypes";
import { buildResponseSchemaFromConfig } from "./outputSchema";

// 하드코딩 폴백·최초 시드용. BQ에 production 버전이 있으면 이쪽은 쓰이지 않는다.

export const PROMPT_TEMPLATE_KEYS = ["call_eval_growth", "call_eval_pay", "feedback_eval", "chatcs_eval"] as const;
export type PromptTemplateKey = (typeof PROMPT_TEMPLATE_KEYS)[number];
export type PromptChannel = "phone" | "feedback" | "chatcs";

export const PROMPT_CHANNEL_CONFIG: Record<
  PromptChannel,
  {
    label: string;
    templateKeys: PromptTemplateKey[];
    defaultTemplateKey: PromptTemplateKey;
    modality: "audio" | "text";
  }
> = {
  phone: {
    label: "콜",
    templateKeys: ["call_eval_growth", "call_eval_pay"],
    defaultTemplateKey: "call_eval_growth",
    modality: "audio",
  },
  feedback: {
    label: "인앱문의",
    templateKeys: ["feedback_eval"],
    defaultTemplateKey: "feedback_eval",
    modality: "text",
  },
  chatcs: {
    label: "채팅",
    templateKeys: ["chatcs_eval"],
    defaultTemplateKey: "chatcs_eval",
    modality: "text",
  },
};

export function promptChannelForTemplateKey(templateKey: PromptTemplateKey): PromptChannel {
  if (templateKey === "feedback_eval") return "feedback";
  if (templateKey === "chatcs_eval") return "chatcs";
  return "phone";
}

export function templateKeyForOrg(org: "growth" | "pay"): PromptTemplateKey {
  return org === "pay" ? "call_eval_pay" : "call_eval_growth";
}

export function templateKeyForChannel(
  channel: "phone" | "feedback" | "chatcs",
  org: "growth" | "pay" = "growth",
): PromptTemplateKey {
  if (channel === "feedback") return "feedback_eval";
  if (channel === "chatcs") return "chatcs_eval";
  return templateKeyForOrg(org);
}

/** 런타임에 치환되는 변수. 프롬프트 매니저 미리보기에도 안내. */
export const PROMPT_VARS = [
  { name: "silences", desc: "공백 구간 목록 텍스트" },
  { name: "silence_summary", desc: "공백 요약 한 줄" },
  { name: "stt_script", desc: "STT 전사 스크립트" },
  { name: "overlaps", desc: "말 겹침(동시 발화) 구간 목록" },
  { name: "conversation_text", desc: "인앱 문의·채팅의 시간순 대화 원문" },
  { name: "checklist_block", desc: "체크리스트 블록(없으면 빈 문자열)" },
  { name: "criteria_count", desc: "체크리스트 항목 수 (체크리스트 템플릿용)" },
  { name: "criteria_list", desc: "체크리스트 항목 목록 (체크리스트 템플릿용)" },
  { name: "score_items", desc: "출력 스키마 점수 항목 목록" },
  { name: "overall_fields", desc: "출력 스키마 총평 필드 목록" },
] as const;

export const DEFAULT_BASE_PROMPT = [
  "당신은 고객 상담(CS) 콜 품질 평가자입니다.",
  "첨부된 통화 녹음과 STT를 근거로, 아래 평가 항목만 지정된 형식(점수/퍼센트/bool/라벨)으로 채우세요.",
  "각 항목의 정의를 반드시 따르고, 근거가 없으면 추측하지 마세요.",
  "",
  "평가 항목:",
  "{{score_items}}",
  "",
  "총평은 overallSummary에 아래 구조로 작성하세요:",
  "{{overall_fields}}",
  "",
  "신호 분석으로 측정된 공백(무음) 구간 — 상담원이 어드민에서 검색하느라 비운 시간일 수 있음:",
  "{{silences}}",
  "{{silence_summary}}",
  "",
  "위 공백 구간을 근거로 관련 항목을 평가하고, 주요 공백에 대해 silenceComments에 코멘트를 남기세요.",
  "",
  "신호/전사 분석으로 측정된 말 겹침(동시 발화) 구간:",
  "{{overlaps}}",
  "",
  "아래는 STT(음성인식)로 화자를 분리해 전사한 스크립트입니다(화자는 번호로만 구분됨):",
  "{{stt_script}}",
  "",
  "이 스크립트에서 **상담원(고객센터 직원)에 해당하는 화자 번호**를 agentSpeakerTag로 알려주세요(판단 불가하면 null).",
  "{{checklist_block}}",
  "",
  "반드시 지정된 JSON 스키마로만 응답하세요. signal로 표시된 메트릭은 응답에 넣지 마세요.",
].join("\n");

export const DEFAULT_TEXT_BASE_PROMPT = [
  "당신은 고객 상담(CS) 텍스트 대화 품질 평가자입니다.",
  "아래 고객 문의와 상담사 답변 원문만 근거로 지정된 평가 항목을 채우세요.",
  "각 항목의 정의를 반드시 따르고, 원문에 근거가 없으면 추측하지 마세요.",
  "",
  "평가 항목:",
  "{{score_items}}",
  "",
  "총평은 overallSummary에 아래 구조로 작성하세요:",
  "{{overall_fields}}",
  "",
  "{{conversation_text}}",
  "",
  "{{checklist_block}}",
  "",
  "반드시 지정된 JSON 스키마로만 응답하세요. signal로 표시된 메트릭은 응답에 넣지 마세요.",
].join("\n");

export const DEFAULT_TEXT_CHECKLIST_TEMPLATE = [
  "── CS 영역 감점 체크리스트 ──",
  "아래 {{criteria_count}}개 항목 각각에 대해, 이 텍스트 대화에서 '위반'이 있었는지 판단해 csChecklist로 응답하세요.",
  "반드시 대화 원문에 실제로 존재하는 발화만 근거로 판단하고, 위반 시 고객과 상담사의 관련 발화를 evidence에 인용하세요.",
  "모든 항목을 배열에 포함하고, reason에는 판정 이유를 한 줄로 작성하세요.",
  "",
  "── 평가 항목 ──",
  "{{criteria_list}}",
].join("\n");

export const DEFAULT_CHECKLIST_TEMPLATE = [
  "── CS 영역 감점 체크리스트 ──",
  "아래 {{criteria_count}}개 항목 각각에 대해, 이 통화에서 '위반'이 있었는지 판단해 csChecklist로 응답하세요.",
  "각 항목에 대해 위반 여부를 판단하고, 위반 시 근거 발화를 반드시 인용하세요.",
  "",
  "규칙(반드시 지킬 것):",
  "1. 반드시 STT 원문에 실제로 존재하는 발화만을 근거로 판단하세요. 추측하지 마세요.",
  "2. STT 특성상 오인식이 있을 수 있으므로, 문맥상 명백한 오인식은 위반 근거로 삼지 마세요.",
  "3. 체크리스트 조건에 해당하면 violated=true로 두세요. 경미·단발·상담 맥락을 이유로 감안하여 violated=false로 내리지 마세요. 감안은 수기 검수 단계의 일입니다. 항목 예외의 '해당 없음'에만 violated=false.",
  "4. 위반(violated=true)일 때 evidence에는 **고객 발화와 상담원 발화를 함께** 넣으세요. quote는 STT 원문 앞에 `고객: ` 또는 `상담원: ` 접두사를 붙이세요. atSec는 **상담원 발화의 시작 초**만 넣으세요(고객 quote에도 같은 장면의 상담원 atSec). 예: STT `@03:16` → atSec `196`. `3.16`(분.초 소수) 금지. 상담원 발화를 인용할 수 없으면 violated=false.",
  "5. reason에는 판정 이유를 한 줄로. id는 아래 번호를 그대로 사용(임의 변경 금지).",
  "6. {{criteria_count}}개 항목을 모두 배열에 포함하세요(위반 아니어도 violated=false로).",
  "",
  "── 평가 항목 ──",
  "{{criteria_list}}",
].join("\n");

const CHECKLIST_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "integer" },
      violated: { type: "boolean" },
      evidence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            atSec: {
              type: "number",
              description: "Elapsed seconds from call start (e.g. 196 for 03:16). Not MM.SS like 3.16.",
            },
            quote: {
              type: "string",
              description:
                "Verbatim STT with speaker prefix. Customer context: '고객: …'. Agent behavior: '상담원: …'.",
            },
          },
          required: ["atSec", "quote"],
        },
      },
      reason: { type: "string" },
    },
    required: ["id", "violated", "reason"],
  },
};

export function defaultResponseSchema(withChecklist: boolean): object {
  return {
    type: "object",
    properties: {
      scores: {
        type: "object",
        properties: {
          attitude: {
            type: "object",
            properties: { score: { type: "integer" }, comment: { type: "string" } },
            required: ["score", "comment"],
          },
          resolution: {
            type: "object",
            properties: { score: { type: "integer" }, comment: { type: "string" } },
            required: ["score", "comment"],
          },
          flow: {
            type: "object",
            properties: { score: { type: "integer" }, comment: { type: "string" } },
            required: ["score", "comment"],
          },
        },
        required: ["attitude", "resolution", "flow"],
      },
      overallSummary: { type: "string" },
      silenceComments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            atSec: {
              type: "number",
              description: "Elapsed seconds from call start (e.g. 196 for 03:16). Not MM.SS like 3.16.",
            },
            note: { type: "string" },
          },
          required: ["atSec", "note"],
        },
      },
      ...(withChecklist ? { csChecklist: CHECKLIST_SCHEMA } : {}),
      agentSpeakerTag: { type: "integer", nullable: true },
    },
    required: ["scores", "overallSummary", "silenceComments", ...(withChecklist ? ["csChecklist"] : [])],
  };
}

export function defaultCriteria(withChecklist: boolean): CsCriterion[] {
  if (!withChecklist) return [];
  return CS_CHECKLIST.map((c) => ({
    ...c,
    fields: { definition: c.hint, good: "", bad: "", exception: "" },
  }));
}

export function defaultPromptSeed(templateKey: PromptTemplateKey) {
  const isText = templateKey === "feedback_eval" || templateKey === "chatcs_eval";
  // 텍스트 채널은 기존 전화 CS_CHECKLIST를 암묵적으로 상속하지 않는다.
  // 채널별 평가셋에서 항목을 명시적으로 선택하고 production 발행해야 활성화된다.
  const withChecklist = templateKey === "call_eval_growth";
  const criteria = defaultCriteria(withChecklist);
  const outputSchemaConfig: OutputSchemaConfig = {
    ...DEFAULT_OUTPUT_SCHEMA_CONFIG,
    includeCsChecklist: withChecklist,
    includeSilenceComments: !isText,
    includeAgentSpeakerTag: !isText,
  };
  return {
    templateKey,
    versionLabel: "v1",
    basePrompt: isText ? DEFAULT_TEXT_BASE_PROMPT : DEFAULT_BASE_PROMPT,
    checklistTemplate: isText
      ? DEFAULT_TEXT_CHECKLIST_TEMPLATE
      : withChecklist
        ? DEFAULT_CHECKLIST_TEMPLATE
        : "",
    responseSchemaJson: JSON.stringify(buildResponseSchemaFromConfig(outputSchemaConfig), null, 2),
    criteriaJson: JSON.stringify(criteria, null, 2),
    selectedCriterionIds: criteria.map((c) => c.id),
    outputSchemaConfig,
    resultParseConfig: { ...DEFAULT_RESULT_PARSE_CONFIG },
    useChecklist: withChecklist,
    changeNote: "초기 시드(기존 하드코딩 이식)",
  };
}

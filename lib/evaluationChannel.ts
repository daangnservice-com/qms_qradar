/** 평가 대상의 채널. 전화와 텍스트 채널은 source id의 의미가 다르다. */
export type EvaluationChannel = "phone" | "feedback" | "chatcs";

export const EVALUATION_CHANNELS: readonly EvaluationChannel[] = [
  "phone",
  "feedback",
  "chatcs",
];

export function isEvaluationChannel(value: unknown): value is EvaluationChannel {
  return typeof value === "string" && EVALUATION_CHANNELS.includes(value as EvaluationChannel);
}

/** 전화 원천. Genesys conversation id 를 source_id 로 쓴다. */
export const PHONE_SOURCE_SYSTEM = "genesys";

/** 음성 STT와 별개로, 인앱 문의·채팅 원문을 표시/평가할 때 쓰는 발화 모델. */
export interface EvaluationTurn {
  turnId: string;
  speaker: "customer" | "agent" | "system" | "unknown";
  speakerLabel: string;
  text: string;
  occurredAt?: string | null;
  atSec?: number | null;
  sourceId?: string | null;
}

export interface EvaluationItemRef {
  channel: EvaluationChannel;
  sourceSystem: string;
  sourceId: string;
}

export function evaluationItemKey(ref: EvaluationItemRef): string {
  return `${ref.channel}:${ref.sourceSystem}:${ref.sourceId}`;
}

export function phoneItemRef(conversationId: string): EvaluationItemRef {
  return {
    channel: "phone",
    sourceSystem: PHONE_SOURCE_SYSTEM,
    sourceId: conversationId.trim(),
  };
}

export function isPhoneItemRef(ref: Pick<EvaluationItemRef, "channel" | "sourceSystem">): boolean {
  return ref.channel === "phone" && ref.sourceSystem === PHONE_SOURCE_SYSTEM;
}

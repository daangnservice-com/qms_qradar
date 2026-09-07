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

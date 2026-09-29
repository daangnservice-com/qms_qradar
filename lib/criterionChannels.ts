import { EVALUATION_CHANNELS, isEvaluationChannel, type EvaluationChannel } from './evaluationChannel';
import type { CriterionPrompt, EvalCriterionBinding } from './promptTypes';

export const CHANNEL_LABELS: Record<EvaluationChannel, string> = { phone: '콜(전화)', feedback: '인앱 문의', chatcs: '채팅' };
export class ChannelBindingError extends Error {}

/** Only absent legacy metadata maps to phone. An explicit empty array never means all. */
export function readExposureChannels(raw: unknown): EvaluationChannel[] {
  if (raw == null) return ['phone'];
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return requireExposureChannels(value);
}

export function requireExposureChannels(raw: unknown): EvaluationChannel[] {
  if (!Array.isArray(raw) || !raw.length || !raw.every(isEvaluationChannel)) {
    throw new ChannelBindingError('노출 채널을 최소 하나 선택하세요. 허용 채널: phone, feedback, chatcs');
  }
  return EVALUATION_CHANNELS.filter((c) => raw.includes(c));
}

export function validateChannelBindings(
  bindings: EvalCriterionBinding[], prompts: CriterionPrompt[], channel: EvaluationChannel,
) {
  const seen = new Set<number>();
  for (const b of bindings) {
    if (seen.has(b.criterionId)) throw new ChannelBindingError(`중복 평가항목: ${b.criterionId}`);
    seen.add(b.criterionId);
    // An inactive item with no detail is a deliberate exclusion, not a normal result.
    if (!b.enabled && !b.promptId) continue;
    const p = prompts.find((p) => p.promptId === b.promptId && p.criterionId === b.criterionId);
    if (!p || !readExposureChannels(p.exposureChannels).includes(channel)) {
      throw new ChannelBindingError(`[${b.criterionId}] ${CHANNEL_LABELS[channel]}에 노출된 프롬프트 버전을 명시적으로 선택하세요`);
    }
  }
}

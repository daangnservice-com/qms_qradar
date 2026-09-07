/** Cloud Speech-to-Text 추정 요금 (USD).
 * @see https://cloud.google.com/speech-to-text/pricing
 *
 * 기본은 `@google-cloud/speech` V1 `SpeechClient` + `latest_long`(Standard) 사용.
 * 필요 시 env로 V2 batch/dynamic batching 프레임워크를 켤 수 있다.
 * - V1 with data logging: $0.016/min (월 60분 무료 후)
 * - V1 without data logging: $0.024/min (월 60분 무료 후)
 * - V2 Standard 첫 구간도 $0.016/min
 * 추정 기본값은 문서에서 흔히 쓰는 $0.016 (data logging on / V2 동가).
 */

import { USD_KRW } from "./llmPricing";

/** V1 Standard · with data logging (및 V2 Standard 첫 티어) $/분 */
export const STT_USD_PER_MINUTE = 0.016;

/** V1 without data logging — 프로젝트에서 data logging 미사용 시 */
export const STT_USD_PER_MINUTE_NO_LOGGING = 0.024;

/**
 * 듀얼채널 + enableSeparateRecognitionPerChannel 이면 채널별로 과금.
 * @see pricing "Multiple channels"
 */
export function estimateSttCost(input: {
  audioDurationSec: number;
  channelCount?: number;
  usdPerMinute?: number;
}): { billableSec: number; billableMin: number; usd: number; krw: number } {
  const channels = Math.max(1, input.channelCount ?? 1);
  const rate = input.usdPerMinute ?? STT_USD_PER_MINUTE;
  const billableSec = Math.ceil(Math.max(0, input.audioDurationSec)) * channels;
  const billableMin = billableSec / 60;
  const usd = billableMin * rate;
  return { billableSec, billableMin, usd, krw: usd * USD_KRW };
}

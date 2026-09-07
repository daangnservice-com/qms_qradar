/** Gemini Developer API Standard tier · USD per 1M tokens. Updated 2026-08. */
export interface ModelTokenRates {
  /** billable non-cached text/image/video input */
  inputPerMTok: number;
  /** audio input (often higher than text — e.g. Flash $1 vs $0.30) */
  audioInputPerMTok: number;
  /** output (incl. thinking) */
  outputPerMTok: number;
  /** cached text/image/video input */
  cachedInputPerMTok: number;
  /** cached audio input (if applicable) */
  cachedAudioInputPerMTok: number;
}

/** Approximate KRW per USD for display (manual FX; not live market). */
export const USD_KRW = 1380;

const RATES: Record<string, ModelTokenRates> = {
  "gemini-2.5-flash": {
    inputPerMTok: 0.3,
    audioInputPerMTok: 1.0,
    outputPerMTok: 2.5,
    cachedInputPerMTok: 0.03,
    cachedAudioInputPerMTok: 0.1,
  },
  "gemini-2.5-flash-lite": {
    inputPerMTok: 0.1,
    audioInputPerMTok: 0.3,
    outputPerMTok: 0.4,
    cachedInputPerMTok: 0.01,
    cachedAudioInputPerMTok: 0.03,
  },
  "gemini-2.5-pro": {
    inputPerMTok: 1.25,
    audioInputPerMTok: 1.25,
    outputPerMTok: 10.0,
    cachedInputPerMTok: 0.125,
    cachedAudioInputPerMTok: 0.125,
  },
  "gemini-2.0-flash": {
    inputPerMTok: 0.1,
    audioInputPerMTok: 0.7,
    outputPerMTok: 0.4,
    cachedInputPerMTok: 0.025,
    cachedAudioInputPerMTok: 0.175,
  },
  "gemini-1.5-flash": {
    inputPerMTok: 0.075,
    audioInputPerMTok: 0.075,
    outputPerMTok: 0.3,
    cachedInputPerMTok: 0.01875,
    cachedAudioInputPerMTok: 0.01875,
  },
  "gemini-1.5-pro": {
    inputPerMTok: 1.25,
    audioInputPerMTok: 1.25,
    outputPerMTok: 5.0,
    cachedInputPerMTok: 0.3125,
    cachedAudioInputPerMTok: 0.3125,
  },
};

const DEFAULT_RATES: ModelTokenRates = RATES["gemini-2.5-flash"];

export function resolveModelRates(model: string | null | undefined): {
  key: string;
  rates: ModelTokenRates;
  matched: boolean;
} {
  const raw = (model ?? "").trim().toLowerCase();
  if (!raw || raw === "(unknown)") {
    return { key: "gemini-2.5-flash", rates: DEFAULT_RATES, matched: false };
  }
  if (RATES[raw]) return { key: raw, rates: RATES[raw], matched: true };
  const keys = Object.keys(RATES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (raw.startsWith(k)) return { key: k, rates: RATES[k], matched: true };
  }
  return { key: raw, rates: DEFAULT_RATES, matched: false };
}

/** usageMetadata.promptTokensDetails 에서 modality별 토큰 합 */
export function tokensByModality(usage: Record<string, unknown> | null | undefined): {
  audio: number;
  text: number;
  other: number;
} {
  const details = usage?.promptTokensDetails ?? usage?.prompt_tokens_details;
  let audio = 0;
  let text = 0;
  let other = 0;
  if (!Array.isArray(details)) return { audio: 0, text: 0, other: 0 };
  for (const raw of details) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const n = Number(d.tokenCount ?? d.token_count ?? 0) || 0;
    const mod = String(d.modality ?? "").toUpperCase();
    if (mod === "AUDIO") audio += n;
    else if (mod === "TEXT" || mod === "" || mod === "MODALITY_UNSPECIFIED") text += n;
    else other += n;
  }
  return { audio, text, other };
}

export interface TokenCostBreakdown {
  textInputUsd: number;
  audioInputUsd: number;
  /** @deprecated alias text+audio billable input */
  inputUsd: number;
  outputUsd: number;
  cachedUsd: number;
  totalUsd: number;
  totalKrw: number;
  rates: ModelTokenRates;
  rateKey: string;
  rateMatched: boolean;
}

/**
 * Cost estimate.
 * promptTokenCount includes all modalities (+ cached subset).
 * audioPromptTokens (from promptTokensDetails AUDIO) billed at audioInputPerMTok.
 * Remaining non-cached prompt billed at text input rate.
 */
export function estimateTokenCost(input: {
  model?: string | null;
  promptTokens: number;
  candidatesTokens: number;
  cachedTokens?: number;
  /** subset of promptTokenCount — from promptTokensDetails AUDIO */
  audioPromptTokens?: number;
}): TokenCostBreakdown {
  const { key, rates, matched } = resolveModelRates(input.model);
  const prompt = Math.max(0, input.promptTokens);
  const audio = Math.max(0, Math.min(input.audioPromptTokens ?? 0, prompt));
  const nonAudio = Math.max(0, prompt - audio);
  const cached = Math.max(0, Math.min(input.cachedTokens ?? 0, nonAudio));
  // 캐시는 보통 텍스트 쪽에 적용된다고 가정
  const billableText = Math.max(0, nonAudio - cached);
  const billableAudio = audio;

  const textInputUsd = (billableText / 1_000_000) * rates.inputPerMTok;
  const audioInputUsd = (billableAudio / 1_000_000) * rates.audioInputPerMTok;
  const outputUsd = (Math.max(0, input.candidatesTokens) / 1_000_000) * rates.outputPerMTok;
  const cachedUsd = (cached / 1_000_000) * rates.cachedInputPerMTok;
  const totalUsd = textInputUsd + audioInputUsd + outputUsd + cachedUsd;
  return {
    textInputUsd,
    audioInputUsd,
    inputUsd: textInputUsd + audioInputUsd,
    outputUsd,
    cachedUsd,
    totalUsd,
    totalKrw: totalUsd * USD_KRW,
    rates,
    rateKey: key,
    rateMatched: matched,
  };
}

export function formatUsd(n: number): string {
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatKrw(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

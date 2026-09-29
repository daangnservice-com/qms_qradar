// LLM 호출 메타. 요청 경로는 서빙 Postgres(serving_llm_call_logs)에만 쓰고 BQ로는 야간 덤프가 내보낸다.
import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { servingQuery } from "./servingDb";
import { growthBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import { estimateTokenCost, USD_KRW } from "./llmPricing";

export type LlmCallPurpose =
  | "call_eval"
  | "qa_eval"
  | "feedback_eval"
  | "prompt_improve"
  | "reply_polish";

export interface LlmCallMeta {
  model?: string | null;
  promptVersionId?: string | null;
  templateKey?: string | null;
  latencyMs?: number | null;
  promptTokenCount?: number | null;
  candidatesTokenCount?: number | null;
  totalTokenCount?: number | null;
  /** Gemini usageMetadata.cachedContentTokenCount (subset of prompt) */
  cachedContentTokenCount?: number | null;
  /** promptTokensDetails AUDIO — included in promptTokenCount */
  audioPromptTokenCount?: number | null;
  finishReason?: string | null;
  seed?: string | number | null;
  responseId?: string | null;
  rawUsage?: unknown;
  rawResponseMeta?: unknown;
  error?: string | null;
}

const TABLE = growthBq.llmCallLogs;

const SCHEMA = [
  { name: "call_id", type: "STRING", mode: "REQUIRED" },
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "purpose", type: "STRING", mode: "NULLABLE" },
  { name: "conversation_id", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version_id", type: "STRING", mode: "NULLABLE" },
  { name: "template_key", type: "STRING", mode: "NULLABLE" },
  { name: "latency_ms", type: "INTEGER", mode: "NULLABLE" },
  { name: "prompt_token_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "candidates_token_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "total_token_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "audio_prompt_token_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "finish_reason", type: "STRING", mode: "NULLABLE" },
  { name: "seed", type: "STRING", mode: "NULLABLE" },
  { name: "response_id", type: "STRING", mode: "NULLABLE" },
  { name: "raw_usage_json", type: "STRING", mode: "NULLABLE" },
  { name: "raw_response_meta_json", type: "STRING", mode: "NULLABLE" },
  { name: "error", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureLlmCallLogTable(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const bq = getBQ();
      const ds = bq.dataset(growthBq.dataset, { projectId: growthBq.projectId });
      const t = ds.table(TABLE);
      const [exists] = await t.exists();
      if (!exists) {
        await t
          .create({ schema: SCHEMA as unknown as { name: string; type: string; mode: string }[] })
          .catch((e) => {
            if (!isAlreadyExists(e)) throw e;
          });
      } else {
        await addColumnsIfMissing(
          t,
          [{ name: "audio_prompt_token_count", type: "INTEGER", mode: "NULLABLE" }],
          { location: growthBq.location, logTag: "llmCallLog" },
        );
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

function safeJson(v: unknown): string | null {
  if (v == null) return null;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function objOf(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function intOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * 집계용 토큰 수. 캐시는 usageMetadata.cachedContentTokenCount,
 * 오디오는 컬럼 값이 있으면 그것, 없으면 promptTokensDetails 의 AUDIO 합.
 */
export function llmUsageTokens(rawUsage: unknown, audioColumn: number | null | undefined): {
  audioTokens: number;
  cachedTokens: number;
} {
  const u = objOf(rawUsage);
  const cachedTokens = intOf(u?.cachedContentTokenCount ?? u?.cached_content_token_count ?? 0);
  if (audioColumn != null && audioColumn !== 0) return { audioTokens: intOf(audioColumn), cachedTokens };
  const details = u?.promptTokensDetails ?? u?.prompt_tokens_details;
  let audioTokens = 0;
  if (Array.isArray(details)) {
    for (const d of details) {
      const o = objOf(d);
      if (String(o?.modality ?? "").toUpperCase() === "AUDIO") audioTokens += intOf(o?.tokenCount ?? o?.token_count ?? 0);
    }
  }
  return { audioTokens, cachedTokens };
}

export type LlmCallLogRow = {
  callId: string;
  ts: string;
  purpose: string | null;
  conversationId: string | null;
  model: string | null;
  promptVersionId: string | null;
  templateKey: string | null;
  latencyMs: number | null;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  audioPromptTokenCount: number | null;
  finishReason: string | null;
  seed: string | null;
  responseId: string | null;
  rawUsageJson: string | null;
  rawResponseMetaJson: string | null;
  error: string | null;
};

/** 로그 행 적재. 백필이면 exported 로 표시해 다시 덤프하지 않는다. */
export async function insertLlmCallLogs(rows: LlmCallLogRow[], opts?: { exported?: boolean }): Promise<void> {
  for (const r of rows) {
    const { audioTokens, cachedTokens } = llmUsageTokens(r.rawUsageJson, r.audioPromptTokenCount);
    await servingQuery(
      `
      insert into serving_llm_call_logs
        (call_id, ts, purpose, conversation_id, model, prompt_version_id, template_key,
         latency_ms, prompt_token_count, candidates_token_count, total_token_count,
         audio_prompt_token_count, finish_reason, seed, response_id, raw_usage_json,
         raw_response_meta_json, error, audio_tokens, cached_tokens, exported_at)
      values ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        case when $21::boolean then now() else null end)
      on conflict (call_id) do nothing
      `,
      [
        r.callId,
        r.ts,
        r.purpose,
        r.conversationId,
        r.model,
        r.promptVersionId,
        r.templateKey,
        r.latencyMs,
        r.promptTokenCount,
        r.candidatesTokenCount,
        r.totalTokenCount,
        r.audioPromptTokenCount,
        r.finishReason,
        r.seed,
        r.responseId,
        r.rawUsageJson,
        r.rawResponseMetaJson,
        r.error,
        audioTokens,
        cachedTokens,
        opts?.exported === true,
      ],
    );
  }
}

/** LLM 호출 메타 1행 적재. 실패해도 호출부 평가를 막지 않음. */
export async function logLlmCall(input: {
  purpose: LlmCallPurpose;
  conversationId?: string | null;
  meta: LlmCallMeta;
}): Promise<string | null> {
  try {
    const callId = randomUUID();
    await insertLlmCallLogs([
      {
        callId,
        ts: new Date().toISOString(),
        purpose: input.purpose,
        conversationId: input.conversationId ?? null,
        model: input.meta.model ?? null,
        promptVersionId: input.meta.promptVersionId ?? null,
        templateKey: input.meta.templateKey ?? null,
        latencyMs: input.meta.latencyMs ?? null,
        promptTokenCount: input.meta.promptTokenCount ?? null,
        candidatesTokenCount: input.meta.candidatesTokenCount ?? null,
        totalTokenCount: input.meta.totalTokenCount ?? null,
        audioPromptTokenCount: input.meta.audioPromptTokenCount ?? null,
        finishReason: input.meta.finishReason ?? null,
        seed: input.meta.seed != null ? String(input.meta.seed) : null,
        responseId: input.meta.responseId ?? null,
        rawUsageJson: safeJson(input.meta.rawUsage),
        rawResponseMetaJson: safeJson(input.meta.rawResponseMeta),
        error: input.meta.error ?? null,
      },
    ]);
    return callId;
  } catch (e) {
    console.error("[llmCallLog] insert failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface LlmUsageStats {
  days: number;
  totalCalls: number;
  errorCalls: number;
  totalPromptTokens: number;
  /** promptTokensDetails AUDIO (included in prompt) */
  totalAudioPromptTokens: number;
  /** prompt - audio */
  totalTextPromptTokens: number;
  totalCandidatesTokens: number;
  totalCachedTokens: number;
  totalBillableInputTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  cost: {
    textInputUsd: number;
    audioInputUsd: number;
    inputUsd: number;
    outputUsd: number;
    cachedUsd: number;
    totalUsd: number;
    totalKrw: number;
    usdKrw: number;
    note: string;
  };
  daily: Array<{
    date: string;
    calls: number;
    tokens: number;
    promptTokens: number;
    audioPromptTokens: number;
    candidatesTokens: number;
    cachedTokens: number;
    avgLatencyMs: number;
    errors: number;
    costUsd: number;
  }>;
  byPurpose: Array<{
    purpose: string;
    calls: number;
    tokens: number;
    promptTokens: number;
    audioPromptTokens: number;
    candidatesTokens: number;
    cachedTokens: number;
    avgLatencyMs: number;
    costUsd: number;
  }>;
  byModel: Array<{
    model: string;
    calls: number;
    tokens: number;
    promptTokens: number;
    audioPromptTokens: number;
    candidatesTokens: number;
    cachedTokens: number;
    costUsd: number;
    costKrw: number;
    textInputUsd: number;
    audioInputUsd: number;
    rateKey: string;
    rateMatched: boolean;
  }>;
}

export async function getLlmUsageStats(days = 30): Promise<LlmUsageStats> {
  const safeDays = Math.min(Math.max(1, days), 90);
  const since = `ts >= now() - make_interval(days => $1)`;
  const sums = `
    coalesce(sum(prompt_token_count), 0) as prompt_tokens,
    coalesce(sum(audio_tokens), 0) as audio_tokens,
    coalesce(sum(candidates_token_count), 0) as candidates_tokens,
    coalesce(sum(cached_tokens), 0) as cached_tokens
  `;
  const errors = `count(*) filter (where error is not null and error <> '')`;

  const [summary, dailyRows, purposeRows, modelRows] = await Promise.all([
    servingQuery(
      `
      select count(*) as total_calls, ${errors} as error_calls, ${sums},
        coalesce(sum(total_token_count), 0) as total_tokens,
        coalesce(avg(latency_ms), 0) as avg_latency
      from serving_llm_call_logs where ${since}
      `,
      [safeDays],
    ),
    servingQuery(
      `
      select to_char(ts at time zone 'Asia/Seoul', 'YYYY-MM-DD') as d, count(*) as calls,
        coalesce(sum(total_token_count), 0) as tokens, ${sums},
        coalesce(avg(latency_ms), 0) as avg_latency, ${errors} as errors
      from serving_llm_call_logs where ${since}
      group by d order by d
      `,
      [safeDays],
    ),
    servingQuery(
      `
      select coalesce(purpose, '(unknown)') as purpose, count(*) as calls,
        coalesce(sum(total_token_count), 0) as tokens, ${sums},
        coalesce(avg(latency_ms), 0) as avg_latency
      from serving_llm_call_logs where ${since}
      group by 1 order by calls desc
      `,
      [safeDays],
    ),
    servingQuery(
      `
      select coalesce(model, '(unknown)') as model, count(*) as calls,
        coalesce(sum(total_token_count), 0) as tokens, ${sums}
      from serving_llm_call_logs where ${since}
      group by 1 order by calls desc
      `,
      [safeDays],
    ),
  ]);
  const s = (summary as Record<string, unknown>[])[0] ?? {};
  const num = (v: unknown) => Number(v ?? 0);

  const byModel = (modelRows as Record<string, unknown>[]).map((r) => {
    const model = String(r.model);
    const promptTokens = num(r.prompt_tokens);
    const audioPromptTokens = num(r.audio_tokens);
    const candidatesTokens = num(r.candidates_tokens);
    const cachedTokens = num(r.cached_tokens);
    const cost = estimateTokenCost({
      model,
      promptTokens,
      candidatesTokens,
      cachedTokens,
      audioPromptTokens,
    });
    return {
      model,
      calls: num(r.calls),
      tokens: num(r.tokens),
      promptTokens,
      audioPromptTokens,
      candidatesTokens,
      cachedTokens,
      costUsd: cost.totalUsd,
      costKrw: cost.totalKrw,
      textInputUsd: cost.textInputUsd,
      audioInputUsd: cost.audioInputUsd,
      rateKey: cost.rateKey,
      rateMatched: cost.rateMatched,
    };
  });

  const totalPrompt = num(s.prompt_tokens);
  const totalAudio = Math.min(num(s.audio_tokens), totalPrompt);
  const totalCand = num(s.candidates_tokens);
  const totalCached = num(s.cached_tokens);
  const billableInput = Math.max(0, totalPrompt - Math.min(totalCached, totalPrompt));

  const costFromModels = byModel.reduce(
    (acc, m) => {
      const c = estimateTokenCost({
        model: m.model,
        promptTokens: m.promptTokens,
        candidatesTokens: m.candidatesTokens,
        cachedTokens: m.cachedTokens,
        audioPromptTokens: m.audioPromptTokens,
      });
      acc.textInputUsd += c.textInputUsd;
      acc.audioInputUsd += c.audioInputUsd;
      acc.inputUsd += c.inputUsd;
      acc.outputUsd += c.outputUsd;
      acc.cachedUsd += c.cachedUsd;
      acc.totalUsd += c.totalUsd;
      return acc;
    },
    { textInputUsd: 0, audioInputUsd: 0, inputUsd: 0, outputUsd: 0, cachedUsd: 0, totalUsd: 0 },
  );

  const daily = (dailyRows as Record<string, unknown>[]).map((r) => {
    const promptTokens = num(r.prompt_tokens);
    const audioPromptTokens = num(r.audio_tokens);
    const candidatesTokens = num(r.candidates_tokens);
    const cachedTokens = num(r.cached_tokens);
    const cost = estimateTokenCost({
      model: byModel[0]?.model,
      promptTokens,
      candidatesTokens,
      cachedTokens,
      audioPromptTokens,
    });
    return {
      date: String(r.d),
      calls: num(r.calls),
      tokens: num(r.tokens),
      promptTokens,
      audioPromptTokens,
      candidatesTokens,
      cachedTokens,
      avgLatencyMs: num(r.avg_latency),
      errors: num(r.errors),
      costUsd: cost.totalUsd,
    };
  });

  const byPurpose = (purposeRows as Record<string, unknown>[]).map((r) => {
    const promptTokens = num(r.prompt_tokens);
    const audioPromptTokens = num(r.audio_tokens);
    const candidatesTokens = num(r.candidates_tokens);
    const cachedTokens = num(r.cached_tokens);
    const cost = estimateTokenCost({
      model: byModel[0]?.model,
      promptTokens,
      candidatesTokens,
      cachedTokens,
      audioPromptTokens,
    });
    return {
      purpose: String(r.purpose),
      calls: num(r.calls),
      tokens: num(r.tokens),
      promptTokens,
      audioPromptTokens,
      candidatesTokens,
      cachedTokens,
      avgLatencyMs: num(r.avg_latency),
      costUsd: cost.totalUsd,
    };
  });

  return {
    days: safeDays,
    totalCalls: num(s.total_calls),
    errorCalls: num(s.error_calls),
    totalPromptTokens: totalPrompt,
    totalAudioPromptTokens: totalAudio,
    totalTextPromptTokens: Math.max(0, totalPrompt - totalAudio),
    totalCandidatesTokens: totalCand,
    totalCachedTokens: totalCached,
    totalBillableInputTokens: billableInput,
    totalTokens: num(s.total_tokens),
    avgLatencyMs: num(s.avg_latency),
    cost: {
      ...costFromModels,
      totalKrw: costFromModels.totalUsd * USD_KRW,
      usdKrw: USD_KRW,
      note: `Gemini Standard · 텍스트/오디오 인풋 분리(audio=$/M 상이) · 캐시=raw_usage · 1USD≈${USD_KRW}KRW`,
    },
    daily,
    byPurpose,
    byModel,
  };
}

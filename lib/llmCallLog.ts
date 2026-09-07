import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import { estimateTokenCost, USD_KRW } from "./llmPricing";

export type LlmCallPurpose = "call_eval" | "qa_eval" | "feedback_eval" | "prompt_improve";

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
const loc = () => (growthBq.location ? { location: growthBq.location } : {});

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

/** LLM 호출 메타 1행 적재. 실패해도 호출부 평가를 막지 않음. */
export async function logLlmCall(input: {
  purpose: LlmCallPurpose;
  conversationId?: string | null;
  meta: LlmCallMeta;
}): Promise<string | null> {
  try {
    await ensureLlmCallLogTable();
    const callId = randomUUID();
    const ts = new Date().toISOString();
    const sql = growthBq.resultsSql(TABLE);
    await getBQ().query({
      query: `
        insert into ${sql}
          (call_id, ts, purpose, conversation_id, model, prompt_version_id, template_key,
           latency_ms, prompt_token_count, candidates_token_count, total_token_count,
           audio_prompt_token_count,
           finish_reason, seed, response_id, raw_usage_json, raw_response_meta_json, error)
        values
          (@call_id, timestamp(@ts), @purpose, @conversation_id, @model, @prompt_version_id, @template_key,
           @latency_ms, @prompt_token_count, @candidates_token_count, @total_token_count,
           @audio_prompt_token_count,
           @finish_reason, @seed, @response_id, @raw_usage_json, @raw_response_meta_json, @error)
      `,
      params: {
        call_id: callId,
        ts,
        purpose: input.purpose,
        conversation_id: input.conversationId ?? null,
        model: input.meta.model ?? null,
        prompt_version_id: input.meta.promptVersionId ?? null,
        template_key: input.meta.templateKey ?? null,
        latency_ms: input.meta.latencyMs ?? null,
        prompt_token_count: input.meta.promptTokenCount ?? null,
        candidates_token_count: input.meta.candidatesTokenCount ?? null,
        total_token_count: input.meta.totalTokenCount ?? null,
        audio_prompt_token_count: input.meta.audioPromptTokenCount ?? null,
        finish_reason: input.meta.finishReason ?? null,
        seed: input.meta.seed != null ? String(input.meta.seed) : null,
        response_id: input.meta.responseId ?? null,
        raw_usage_json: safeJson(input.meta.rawUsage),
        raw_response_meta_json: safeJson(input.meta.rawResponseMeta),
        error: input.meta.error ?? null,
      },
      types: {
        call_id: "STRING",
        ts: "STRING",
        purpose: "STRING",
        conversation_id: "STRING",
        model: "STRING",
        prompt_version_id: "STRING",
        template_key: "STRING",
        latency_ms: "INT64",
        prompt_token_count: "INT64",
        candidates_token_count: "INT64",
        total_token_count: "INT64",
        audio_prompt_token_count: "INT64",
        finish_reason: "STRING",
        seed: "STRING",
        response_id: "STRING",
        raw_usage_json: "STRING",
        raw_response_meta_json: "STRING",
        error: "STRING",
      },
      ...loc(),
    });
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

const CACHED_EXPR = `ifnull(safe_cast(coalesce(
  json_value(raw_usage_json, '$.cachedContentTokenCount'),
  json_value(raw_usage_json, '$.cached_content_token_count')
) as int64), 0)`;

/** 컬럼 우선, 없으면 raw_usage_json.promptTokensDetails AUDIO 합 */
const AUDIO_EXPR = `ifnull(nullif(audio_prompt_token_count, 0), (
  select ifnull(sum(ifnull(safe_cast(coalesce(
    json_value(d, '$.tokenCount'),
    json_value(d, '$.token_count')
  ) as int64), 0)), 0)
  from unnest(coalesce(
    json_query_array(raw_usage_json, '$.promptTokensDetails'),
    json_query_array(raw_usage_json, '$.prompt_tokens_details'),
    []
  )) as d
  where upper(ifnull(json_value(d, '$.modality'), '')) = 'AUDIO'
))`;

export async function getLlmUsageStats(days = 30): Promise<LlmUsageStats> {
  await ensureLlmCallLogTable();
  const sql = growthBq.resultsSql(TABLE);
  const safeDays = Math.min(Math.max(1, days), 90);

  const [summaryRows, dailyRows, purposeRows, modelRows] = await Promise.all([
    getBQ().query({
      query: `
        select
          count(*) as total_calls,
          countif(error is not null and error != '') as error_calls,
          ifnull(sum(prompt_token_count), 0) as prompt_tokens,
          ifnull(sum(${AUDIO_EXPR}), 0) as audio_tokens,
          ifnull(sum(candidates_token_count), 0) as candidates_tokens,
          ifnull(sum(${CACHED_EXPR}), 0) as cached_tokens,
          ifnull(sum(total_token_count), 0) as total_tokens,
          ifnull(avg(latency_ms), 0) as avg_latency
        from ${sql}
        where ts >= timestamp_sub(current_timestamp(), interval @days day)
      `,
      params: { days: safeDays },
      types: { days: "INT64" },
      ...loc(),
    }),
    getBQ().query({
      query: `
        select
          format_date('%Y-%m-%d', date(ts, 'Asia/Seoul')) as d,
          count(*) as calls,
          ifnull(sum(total_token_count), 0) as tokens,
          ifnull(sum(prompt_token_count), 0) as prompt_tokens,
          ifnull(sum(${AUDIO_EXPR}), 0) as audio_tokens,
          ifnull(sum(candidates_token_count), 0) as candidates_tokens,
          ifnull(sum(${CACHED_EXPR}), 0) as cached_tokens,
          ifnull(avg(latency_ms), 0) as avg_latency,
          countif(error is not null and error != '') as errors
        from ${sql}
        where ts >= timestamp_sub(current_timestamp(), interval @days day)
        group by d
        order by d
      `,
      params: { days: safeDays },
      types: { days: "INT64" },
      ...loc(),
    }),
    getBQ().query({
      query: `
        select
          ifnull(purpose, '(unknown)') as purpose,
          count(*) as calls,
          ifnull(sum(total_token_count), 0) as tokens,
          ifnull(sum(prompt_token_count), 0) as prompt_tokens,
          ifnull(sum(${AUDIO_EXPR}), 0) as audio_tokens,
          ifnull(sum(candidates_token_count), 0) as candidates_tokens,
          ifnull(sum(${CACHED_EXPR}), 0) as cached_tokens,
          ifnull(avg(latency_ms), 0) as avg_latency
        from ${sql}
        where ts >= timestamp_sub(current_timestamp(), interval @days day)
        group by purpose
        order by calls desc
      `,
      params: { days: safeDays },
      types: { days: "INT64" },
      ...loc(),
    }),
    getBQ().query({
      query: `
        select
          ifnull(model, '(unknown)') as model,
          count(*) as calls,
          ifnull(sum(total_token_count), 0) as tokens,
          ifnull(sum(prompt_token_count), 0) as prompt_tokens,
          ifnull(sum(${AUDIO_EXPR}), 0) as audio_tokens,
          ifnull(sum(candidates_token_count), 0) as candidates_tokens,
          ifnull(sum(${CACHED_EXPR}), 0) as cached_tokens
        from ${sql}
        where ts >= timestamp_sub(current_timestamp(), interval @days day)
        group by model
        order by calls desc
      `,
      params: { days: safeDays },
      types: { days: "INT64" },
      ...loc(),
    }),
  ]);

  const s = (summaryRows[0] as Record<string, unknown>[])[0] ?? {};
  const num = (v: unknown) => Number(v ?? 0);

  const byModel = (modelRows[0] as Record<string, unknown>[]).map((r) => {
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

  const daily = (dailyRows[0] as Record<string, unknown>[]).map((r) => {
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

  const byPurpose = (purposeRows[0] as Record<string, unknown>[]).map((r) => {
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

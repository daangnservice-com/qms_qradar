import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import { estimateSttCost, STT_USD_PER_MINUTE } from "./sttPricing";
import { USD_KRW } from "./llmPricing";

const TABLE = growthBq.sttCallLogs;
const loc = () => (growthBq.location ? { location: growthBq.location } : {});

const SCHEMA = [
  { name: "call_id", type: "STRING", mode: "REQUIRED" },
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "purpose", type: "STRING", mode: "NULLABLE" },
  { name: "conversation_id", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  { name: "language", type: "STRING", mode: "NULLABLE" },
  { name: "channel_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "audio_duration_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "billable_duration_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "segment_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "latency_ms", type: "INTEGER", mode: "NULLABLE" },
  { name: "error", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureSttCallLogTable(): Promise<void> {
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
          SCHEMA.filter((c) => c.name !== "call_id" && c.name !== "ts").map((c) => ({
            name: c.name,
            type: c.type,
            mode: c.mode,
          })),
          { location: growthBq.location, logTag: "sttCallLog" },
        );
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

/** STT 호출 1행. 실패해도 평가 흐름을 막지 않음. */
export async function logSttCall(input: {
  purpose?: string | null;
  conversationId?: string | null;
  model: string;
  language: string;
  channelCount: number;
  audioDurationSec: number;
  segmentCount: number;
  latencyMs?: number | null;
  error?: string | null;
}): Promise<string | null> {
  try {
    await ensureSttCallLogTable();
    const est = estimateSttCost({
      audioDurationSec: input.audioDurationSec,
      channelCount: input.channelCount,
    });
    const callId = randomUUID();
    const ts = new Date().toISOString();
    const sql = growthBq.resultsSql(TABLE);
    await getBQ().query({
      query: `
        insert into ${sql}
          (call_id, ts, purpose, conversation_id, model, language, channel_count,
           audio_duration_sec, billable_duration_sec, segment_count, latency_ms, error)
        values
          (@call_id, timestamp(@ts), @purpose, @conversation_id, @model, @language, @channel_count,
           @audio_duration_sec, @billable_duration_sec, @segment_count, @latency_ms, @error)
      `,
      params: {
        call_id: callId,
        ts,
        purpose: input.purpose ?? null,
        conversation_id: input.conversationId ?? null,
        model: input.model,
        language: input.language,
        channel_count: input.channelCount,
        audio_duration_sec: input.audioDurationSec,
        billable_duration_sec: est.billableSec,
        segment_count: input.segmentCount,
        latency_ms: input.latencyMs ?? null,
        error: input.error ?? null,
      },
      types: {
        call_id: "STRING",
        ts: "STRING",
        purpose: "STRING",
        conversation_id: "STRING",
        model: "STRING",
        language: "STRING",
        channel_count: "INT64",
        audio_duration_sec: "FLOAT64",
        billable_duration_sec: "FLOAT64",
        segment_count: "INT64",
        latency_ms: "INT64",
        error: "STRING",
      },
      ...loc(),
    });
    return callId;
  } catch (e) {
    console.warn("[sttCallLog] insert failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type SttUsageStats = {
  days: number;
  totalCalls: number;
  errorCalls: number;
  totalAudioSec: number;
  totalBillableSec: number;
  totalBillableMin: number;
  avgLatencyMs: number;
  cost: { usd: number; krw: number; usdPerMin: number; note: string };
  daily: Array<{
    date: string;
    calls: number;
    audioSec: number;
    billableSec: number;
    costUsd: number;
    errors: number;
  }>;
};

export async function getSttUsageStats(days = 30): Promise<SttUsageStats> {
  await ensureSttCallLogTable();
  const sql = growthBq.resultsSql(TABLE);
  const safeDays = Math.min(Math.max(1, days), 90);

  const [summaryRows, dailyRows] = await Promise.all([
    getBQ().query({
      query: `
        select
          count(*) as total_calls,
          countif(error is not null and error != '') as error_calls,
          ifnull(sum(audio_duration_sec), 0) as audio_sec,
          ifnull(sum(billable_duration_sec), 0) as billable_sec,
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
          ifnull(sum(audio_duration_sec), 0) as audio_sec,
          ifnull(sum(billable_duration_sec), 0) as billable_sec,
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
  ]);

  const s = (summaryRows[0] as Record<string, unknown>[])[0] ?? {};
  const num = (v: unknown) => Number(v ?? 0);
  const billableSec = num(s.billable_sec);
  const billableMin = billableSec / 60;
  const usd = billableMin * STT_USD_PER_MINUTE;

  return {
    days: safeDays,
    totalCalls: num(s.total_calls),
    errorCalls: num(s.error_calls),
    totalAudioSec: num(s.audio_sec),
    totalBillableSec: billableSec,
    totalBillableMin: billableMin,
    avgLatencyMs: num(s.avg_latency),
    cost: {
      usd,
      krw: usd * USD_KRW,
      usdPerMin: STT_USD_PER_MINUTE,
      note: `STT V1 Standard · $${STT_USD_PER_MINUTE}/min (data logging on). logging 미사용 시 $${0.024}/min · 채널×초 · 월 60분 무료 미반영`,
    },
    daily: (dailyRows[0] as Record<string, unknown>[]).map((r) => {
      const bSec = num(r.billable_sec);
      return {
        date: String(r.d),
        calls: num(r.calls),
        audioSec: num(r.audio_sec),
        billableSec: bSec,
        costUsd: (bSec / 60) * STT_USD_PER_MINUTE,
        errors: num(r.errors),
      };
    }),
  };
}

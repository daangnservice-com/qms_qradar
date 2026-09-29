// STT 호출 로그. 요청 경로는 서빙 Postgres(serving_stt_call_logs)에만 쓰고 BQ로는 야간 덤프가 내보낸다.
import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { servingQuery } from "./servingDb";
import { growthBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import { estimateSttCost, STT_USD_PER_MINUTE } from "./sttPricing";
import { USD_KRW } from "./llmPricing";

const TABLE = growthBq.sttCallLogs;

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

export type SttCallLogRow = {
  callId: string;
  ts: string;
  purpose: string | null;
  conversationId: string | null;
  model: string | null;
  language: string | null;
  channelCount: number | null;
  audioDurationSec: number | null;
  billableDurationSec: number | null;
  segmentCount: number | null;
  latencyMs: number | null;
  error: string | null;
};

/** 로그 행 적재. 백필이면 exported 로 표시해 다시 덤프하지 않는다. */
export async function insertSttCallLogs(rows: SttCallLogRow[], opts?: { exported?: boolean }): Promise<void> {
  for (const r of rows) {
    await servingQuery(
      `
      insert into serving_stt_call_logs
        (call_id, ts, purpose, conversation_id, model, language, channel_count,
         audio_duration_sec, billable_duration_sec, segment_count, latency_ms, error, exported_at)
      values ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        case when $13::boolean then now() else null end)
      on conflict (call_id) do nothing
      `,
      [
        r.callId,
        r.ts,
        r.purpose,
        r.conversationId,
        r.model,
        r.language,
        r.channelCount,
        r.audioDurationSec,
        r.billableDurationSec,
        r.segmentCount,
        r.latencyMs,
        r.error,
        opts?.exported === true,
      ],
    );
  }
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
    const est = estimateSttCost({
      audioDurationSec: input.audioDurationSec,
      channelCount: input.channelCount,
    });
    const callId = randomUUID();
    await insertSttCallLogs([
      {
        callId,
        ts: new Date().toISOString(),
        purpose: input.purpose ?? null,
        conversationId: input.conversationId ?? null,
        model: input.model,
        language: input.language,
        channelCount: input.channelCount,
        audioDurationSec: input.audioDurationSec,
        billableDurationSec: est.billableSec,
        segmentCount: input.segmentCount,
        latencyMs: input.latencyMs == null ? null : Math.round(input.latencyMs),
        error: input.error ?? null,
      },
    ]);
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
  const safeDays = Math.min(Math.max(1, days), 90);
  const since = `ts >= now() - make_interval(days => $1)`;
  const errors = `count(*) filter (where error is not null and error <> '')`;

  const [summary, dailyRows] = await Promise.all([
    servingQuery(
      `
      select count(*) as total_calls, ${errors} as error_calls,
        coalesce(sum(audio_duration_sec), 0) as audio_sec,
        coalesce(sum(billable_duration_sec), 0) as billable_sec,
        coalesce(avg(latency_ms), 0) as avg_latency
      from serving_stt_call_logs where ${since}
      `,
      [safeDays],
    ),
    servingQuery(
      `
      select to_char(ts at time zone 'Asia/Seoul', 'YYYY-MM-DD') as d, count(*) as calls,
        coalesce(sum(audio_duration_sec), 0) as audio_sec,
        coalesce(sum(billable_duration_sec), 0) as billable_sec,
        ${errors} as errors
      from serving_stt_call_logs where ${since}
      group by d order by d
      `,
      [safeDays],
    ),
  ]);

  const s = (summary as Record<string, unknown>[])[0] ?? {};
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
    daily: (dailyRows as Record<string, unknown>[]).map((r) => {
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

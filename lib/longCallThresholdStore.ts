import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq, promptBq } from "./bqRefs";
import { addColumnsIfMissing } from "./bqSchema";
import { addDaysYmd, currentDateKst } from "./sttBatchKst";
import { cached, cacheInvalidate, SERVER_CACHE_TTL } from "./serverCache";
import {
  LONG_CALL_THRESHOLD_WINDOW_DAYS,
  clampLongCallPercentile,
  meanDailyThresholdMinutes,
  topPercentileQuantileOffset,
  type LongCallThresholdSnapshot,
} from "./longCallThreshold";

const TABLE = promptBq.tables.longCallThresholds;
const loc = () => (promptBq.location ? { location: promptBq.location } : {});
const sql = () => promptBq.sql(TABLE);
const tableRef = () =>
  getBQ().dataset(promptBq.dataset, { projectId: promptBq.projectId }).table(TABLE);

const SCHEMA = [
  { name: "snapshot_id", type: "STRING", mode: "REQUIRED" },
  { name: "rule_key", type: "STRING", mode: "REQUIRED" },
  { name: "percentile", type: "FLOAT", mode: "REQUIRED" },
  { name: "window_days", type: "INTEGER", mode: "REQUIRED" },
  { name: "window_start", type: "DATE", mode: "REQUIRED" },
  { name: "window_end", type: "DATE", mode: "REQUIRED" },
  { name: "threshold_minutes", type: "FLOAT", mode: "REQUIRED" },
  { name: "daily_json", type: "STRING", mode: "NULLABLE" },
  { name: "as_of_date", type: "DATE", mode: "REQUIRED" },
  { name: "computed_at", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

let _ensured: Promise<void> | null = null;

export function ensureLongCallThresholdTable(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      const bq = getBQ();
      const ds = bq.dataset(promptBq.dataset, { projectId: promptBq.projectId });
      const [dsExists] = await ds.exists();
      if (!dsExists) {
        await ds.create({ location: promptBq.location ?? "US" }).catch((e) => {
          if (!isAlreadyExists(e)) throw e;
        });
      }
      const t = tableRef();
      const [exists] = await t.exists();
      if (!exists) {
        await t
          .create({ schema: SCHEMA as unknown as { name: string; type: string; mode: string }[] })
          .catch((e) => {
            if (!isAlreadyExists(e)) throw e;
          });
      } else {
        await addColumnsIfMissing(t, [...SCHEMA], { location: promptBq.location, logTag: "longCallThresholdStore" });
      }
    })().catch((e) => {
      _ensured = null;
      throw e;
    });
  }
  return _ensured;
}

const CASES_SQL = growthBq.casesSql();
const CID = "json_value(case_content, '$.genesys_conversation_id')";
const CALL_START_TS = "safe_cast(json_value(case_content, '$.call_start') as timestamp)";
const CALL_DATE_KST = `format_date('%F', date(${CALL_START_TS}, 'Asia/Seoul'))`;
const CALL_END_TS = "safe_cast(json_value(case_content, '$.call_end') as timestamp)";
const MINUTES = "safe_cast(json_value(case_content, '$.minutes_taken') as float64)";
const DURATION_SEC = `coalesce(
  if(timestamp_diff(${CALL_END_TS}, ${CALL_START_TS}, second) > 0,
     timestamp_diff(${CALL_END_TS}, ${CALL_START_TS}, second), null),
  if(${MINUTES} > 0, cast(round(${MINUTES} * 60) as int64), null)
)`;

function cacheKey(percentile: number, windowDays: number, ruleKey: string): string {
  return `long-call-threshold:${ruleKey}:${percentile}:${windowDays}`;
}

function tsValue(updated: unknown): string {
  if (updated && typeof updated === "object" && "value" in (updated as object)) {
    return String((updated as { value: string }).value);
  }
  return String(updated ?? "");
}

function dateValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) {
    return String((v as { value: string }).value).slice(0, 10);
  }
  return String(v ?? "").slice(0, 10);
}

function rowToSnapshot(r: Record<string, unknown>): LongCallThresholdSnapshot | null {
  const thresholdMinutes = Number(r.threshold_minutes);
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) return null;
  let daily: LongCallThresholdSnapshot["daily"] = [];
  try {
    const parsed = JSON.parse(String(r.daily_json ?? "[]")) as LongCallThresholdSnapshot["daily"];
    if (Array.isArray(parsed)) daily = parsed;
  } catch {
    daily = [];
  }
  return {
    snapshotId: String(r.snapshot_id ?? ""),
    ruleKey: String(r.rule_key ?? "long_call"),
    percentile: Number(r.percentile) || 10,
    windowDays: Number(r.window_days) || LONG_CALL_THRESHOLD_WINDOW_DAYS,
    windowStart: dateValue(r.window_start),
    windowEnd: dateValue(r.window_end),
    thresholdMinutes,
    daily,
    asOfDate: dateValue(r.as_of_date),
    computedAt: tsValue(r.computed_at),
  };
}

/** DB에서 해당 퍼센타일·윈도우의 최신 스냅샷. */
export async function loadLatestLongCallThreshold(opts: {
  percentile: number;
  windowDays?: number;
  ruleKey?: string;
}): Promise<LongCallThresholdSnapshot | null> {
  await ensureLongCallThresholdTable();
  const percentile = clampLongCallPercentile(opts.percentile);
  const windowDays = opts.windowDays ?? LONG_CALL_THRESHOLD_WINDOW_DAYS;
  const ruleKey = (opts.ruleKey ?? "long_call").trim() || "long_call";
  try {
    const [rows] = await getBQ().query({
      query: `
        select snapshot_id, rule_key, percentile, window_days, window_start, window_end,
               threshold_minutes, daily_json, as_of_date, computed_at
        from ${sql()}
        where rule_key = @rule_key
          and percentile = @percentile
          and window_days = @window_days
        order by computed_at desc
        limit 1
      `,
      params: { rule_key: ruleKey, percentile, window_days: windowDays },
      types: { rule_key: "STRING", percentile: "FLOAT64", window_days: "INT64" },
      ...loc(),
    });
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToSnapshot(row) : null;
  } catch (e) {
    console.error("[longCallThresholdStore] loadLatest:", e);
    return null;
  }
}

/**
 * 당일 제외 직전 windowDays일, 일별 상위 percentile 통화시간(분)의 MA를 cases에서 계산.
 */
export async function computeLongCallThresholdFromCases(opts: {
  percentile: number;
  windowDays?: number;
  ruleKey?: string;
  asOfDate?: string;
}): Promise<LongCallThresholdSnapshot | null> {
  const percentile = clampLongCallPercentile(opts.percentile);
  const windowDays = opts.windowDays ?? LONG_CALL_THRESHOLD_WINDOW_DAYS;
  const ruleKey = (opts.ruleKey ?? "long_call").trim() || "long_call";
  const asOfDate = opts.asOfDate ?? currentDateKst();
  const windowEnd = addDaysYmd(asOfDate, -1);
  const windowStart = addDaysYmd(asOfDate, -windowDays);
  const qOffset = topPercentileQuantileOffset(percentile);

  const query = `
    with base as (
      select
        ${CALL_DATE_KST} as call_date,
        ${DURATION_SEC} as duration_sec
      from ${CASES_SQL}
      where year_month >= '2026-04-01'
        and ${CID} is not null
        and ${DURATION_SEC} is not null
        and ${CALL_DATE_KST} between @window_start and @window_end
      qualify row_number() over (partition by ${CID} order by inquiry_created_at_kst desc) = 1
    ),
    daily as (
      select
        call_date,
        count(*) as sample_count,
        approx_quantiles(duration_sec, 100)[offset(@q_offset)] as threshold_sec
      from base
      where duration_sec > 0
      group by call_date
    )
    select
      format_date('%F', call_date) as call_date,
      sample_count,
      threshold_sec
    from daily
    order by call_date
  `;

  try {
    const [rows] = await getBQ().query({
      query,
      params: {
        window_start: windowStart,
        window_end: windowEnd,
        q_offset: qOffset,
      },
      types: {
        window_start: "STRING",
        window_end: "STRING",
        q_offset: "INT64",
      },
      ...(growthBq.location ? { location: growthBq.location } : {}),
    });

    const daily = (rows as Record<string, unknown>[]).map((r) => {
      const sec = Number(r.threshold_sec);
      return {
        date: String(r.call_date ?? "").slice(0, 10),
        thresholdMinutes: Number.isFinite(sec) && sec > 0 ? sec / 60 : 0,
        sampleCount: Number(r.sample_count) || 0,
      };
    });
    const thresholdMinutes = meanDailyThresholdMinutes(daily);
    if (thresholdMinutes == null) return null;

    return {
      snapshotId: randomUUID(),
      ruleKey,
      percentile,
      windowDays,
      windowStart,
      windowEnd,
      thresholdMinutes,
      daily,
      asOfDate,
      computedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error("[longCallThresholdStore] compute:", e);
    return null;
  }
}

async function insertSnapshot(snap: LongCallThresholdSnapshot): Promise<void> {
  await ensureLongCallThresholdTable();
  await getBQ().query({
    query: `
      insert into ${sql()} (
        snapshot_id, rule_key, percentile, window_days, window_start, window_end,
        threshold_minutes, daily_json, as_of_date, computed_at
      ) values (
        @snapshot_id, @rule_key, @percentile, @window_days, date(@window_start), date(@window_end),
        @threshold_minutes, @daily_json, date(@as_of_date), timestamp(@computed_at)
      )
    `,
    params: {
      snapshot_id: snap.snapshotId,
      rule_key: snap.ruleKey,
      percentile: snap.percentile,
      window_days: snap.windowDays,
      window_start: snap.windowStart,
      window_end: snap.windowEnd,
      threshold_minutes: snap.thresholdMinutes,
      daily_json: JSON.stringify(snap.daily),
      as_of_date: snap.asOfDate,
      computed_at: snap.computedAt,
    },
    types: {
      snapshot_id: "STRING",
      rule_key: "STRING",
      percentile: "FLOAT64",
      window_days: "INT64",
      window_start: "STRING",
      window_end: "STRING",
      threshold_minutes: "FLOAT64",
      daily_json: "STRING",
      as_of_date: "STRING",
      computed_at: "STRING",
    },
    ...loc(),
  });
}

/**
 * 오늘(KST) 기준 스냅샷을 가져온다. 없거나 날짜가 다르면 cases에서 재계산해 DB에 저장.
 * 프로세스 메모리에도 짧게 캐시한다.
 */
export async function getOrRefreshLongCallThreshold(opts: {
  percentile: number;
  windowDays?: number;
  ruleKey?: string;
  force?: boolean;
}): Promise<LongCallThresholdSnapshot | null> {
  const percentile = clampLongCallPercentile(opts.percentile);
  const windowDays = opts.windowDays ?? LONG_CALL_THRESHOLD_WINDOW_DAYS;
  const ruleKey = (opts.ruleKey ?? "long_call").trim() || "long_call";
  const asOfDate = currentDateKst();
  const key = cacheKey(percentile, windowDays, ruleKey);

  if (!opts.force) {
    return cached(key, SERVER_CACHE_TTL.longCallThreshold, async () => {
      const existing = await loadLatestLongCallThreshold({ percentile, windowDays, ruleKey });
      if (existing && existing.asOfDate === asOfDate) return existing;

      const computed = await computeLongCallThresholdFromCases({
        percentile,
        windowDays,
        ruleKey,
        asOfDate,
      });
      if (!computed) {
        // 재계산 실패 시 어제 스냅샷이라도 있으면 폴백
        return existing;
      }
      try {
        await insertSnapshot(computed);
      } catch (e) {
        console.error("[longCallThresholdStore] insert:", e);
      }
      return computed;
    });
  }

  cacheInvalidate(key);
  const computed = await computeLongCallThresholdFromCases({
    percentile,
    windowDays,
    ruleKey,
    asOfDate,
  });
  if (!computed) return loadLatestLongCallThreshold({ percentile, windowDays, ruleKey });
  try {
    await insertSnapshot(computed);
  } catch (e) {
    console.error("[longCallThresholdStore] insert:", e);
  }
  cacheInvalidate(key);
  return cached(key, SERVER_CACHE_TTL.longCallThreshold, async () => computed);
}

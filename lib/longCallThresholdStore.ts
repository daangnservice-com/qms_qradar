import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import { growthBq, promptBq } from "./bqRefs";
import {
  CASES_CALL_DATE_KST,
  CASES_CID,
  CASES_DURATION_SEC,
  CASES_SINCE,
} from "./evaluationCasesSql";
import { servingRows } from "./servingDb";
import { addDaysYmd, currentDateKst } from "./sttBatchKst";
import { cached, cacheInvalidate, SERVER_CACHE_TTL } from "./serverCache";
import {
  LONG_CALL_THRESHOLD_WINDOW_DAYS,
  clampLongCallPercentile,
  meanDailyThresholdMinutes,
  topPercentileQuantileOffset,
  type LongCallThresholdSnapshot,
} from "./longCallThreshold";

// 장콜 임계값 스냅샷. 계산은 하루 한 번 BQ 콜 원천에서, 저장·조회는 서빙 Postgres
// (테이블 이름은 BQ 와 같다, BQ 는 야간 덤프 사본).
const TABLE = promptBq.tables.longCallThresholds;

const CASES_SQL = growthBq.casesSql();

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
  const percentile = clampLongCallPercentile(opts.percentile);
  const windowDays = opts.windowDays ?? LONG_CALL_THRESHOLD_WINDOW_DAYS;
  const ruleKey = (opts.ruleKey ?? "long_call").trim() || "long_call";
  try {
    const rows = await servingRows(
      `
        select snapshot_id, rule_key, percentile, window_days, window_start, window_end,
               threshold_minutes, daily_json, as_of_date, computed_at
        from ${TABLE}
        where rule_key = @rule_key
          and percentile = @percentile::float8
          and window_days = @window_days::bigint
        order by computed_at desc
        limit 1
      `,
      { rule_key: ruleKey, percentile, window_days: windowDays },
    );
    const row = rows[0];
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
        ${CASES_CALL_DATE_KST} as call_date,
        ${CASES_DURATION_SEC} as duration_sec
      from ${CASES_SQL}
      where ${CASES_SINCE}
        and ${CASES_CID} is not null
        and ${CASES_DURATION_SEC} is not null
        and ${CASES_CALL_DATE_KST} between DATE(@window_start) and DATE(@window_end)
      qualify row_number() over (partition by ${CASES_CID} order by inquiry_created_at_kst desc) = 1
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
  await servingRows(
    `
      insert into ${TABLE} (
        snapshot_id, rule_key, percentile, window_days, window_start, window_end,
        threshold_minutes, daily_json, as_of_date, computed_at
      ) values (
        @snapshot_id, @rule_key, @percentile, @window_days, @window_start::date, @window_end::date,
        @threshold_minutes, @daily_json, @as_of_date::date, @computed_at::timestamptz
      )
    `,
    {
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
  );
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

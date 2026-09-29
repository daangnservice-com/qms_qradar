import { parseFeedbackContents } from "./feedbackSamples";
import { servingQuery } from "./servingDb";
import { extractReplyPolishTexts, pickRoundRobinByCategory } from "./replyPolishSample";
import {
  REPLY_POLISH_DEFAULT_TARGET,
  REPLY_POLISH_DEFAULT_TEAM,
  REPLY_POLISH_FETCH_CAP,
  REPLY_POLISH_FETCH_MULTIPLIER,
  REPLY_POLISH_MAX_TARGET,
  type ReplyPolishSample,
} from "./replyPolishTypes";

type FeedbackRow = Record<string, unknown>;

function valueOf(v: unknown): unknown {
  if (v && typeof v === "object" && "value" in v) {
    return (v as { value: unknown }).value;
  }
  return v;
}

function stringValue(v: unknown): string {
  return String(valueOf(v) ?? "").trim();
}

function nullableNumber(v: unknown): number | null {
  const raw = valueOf(v);
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function clampReplyPolishTarget(n: number | null | undefined): number {
  const raw = Number.isFinite(n) ? Math.floor(n as number) : REPLY_POLISH_DEFAULT_TARGET;
  return Math.min(REPLY_POLISH_MAX_TARGET, Math.max(1, raw));
}

export function replyPolishFetchLimit(target: number): number {
  return Math.min(REPLY_POLISH_FETCH_CAP, Math.max(target, target * REPLY_POLISH_FETCH_MULTIPLIER));
}

export function normalizeReplyPolishCsatFilter(input: {
  csatRates?: unknown;
  csatIncludeNone?: unknown;
}): { csatRates: number[]; csatIncludeNone: boolean } {
  const csatRates = [
    ...new Set(
      (Array.isArray(input.csatRates) ? input.csatRates : [])
        .map((value) => Number(value))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
    ),
  ].sort((a, b) => a - b);
  return { csatRates, csatIncludeNone: input.csatIncludeNone === true };
}

export function snapshotReplyPolishRow(row: FeedbackRow): ReplyPolishSample | null {
  const threadId = stringValue(row.feedback_thread_id);
  if (!threadId) return null;
  const turns = parseFeedbackContents(stringValue(row.contents_concat));
  const texts = extractReplyPolishTexts(turns);
  if (!texts) return null;
  const createdAt = stringValue(row.first_feedback_at_kst) || stringValue(row.feedback_date_kst);
  return {
    id: threadId,
    threadId,
    category: stringValue(row.display_full_category_name),
    team: stringValue(row.work_group_team),
    createdAt,
    inquiry: texts.inquiry,
    answer: texts.answer,
    csatRate: nullableNumber(row.csat_rate),
  };
}

export async function sampleReplyPolishThreads(input: {
  dateStart: string;
  dateEnd: string;
  team?: string;
  target?: number;
  seed: string;
  csatRates?: unknown;
  csatIncludeNone?: unknown;
}): Promise<{
  samples: ReplyPolishSample[];
  candidateCount: number;
  fetchLimit: number;
  target: number;
  csatRates: number[];
  csatIncludeNone: boolean;
}> {
  const dateStart = input.dateStart.trim();
  const dateEnd = input.dateEnd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
    throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다");
  }
  if (dateStart > dateEnd) throw new Error("시작일이 종료일보다 늦습니다");

  const team = (input.team ?? REPLY_POLISH_DEFAULT_TEAM).trim() || REPLY_POLISH_DEFAULT_TEAM;
  const target = clampReplyPolishTarget(input.target);
  const fetchLimit = replyPolishFetchLimit(target);
  const seed = input.seed.trim() || "default";
  const { csatRates, csatIncludeNone } = normalizeReplyPolishCsatFilter(input);

  const values: unknown[] = [team, dateStart, dateEnd];
  let csatSql = "";
  if (csatRates.length || csatIncludeNone) {
    const clauses: string[] = [];
    if (csatRates.length) {
      values.push(csatRates);
      clauses.push(`cast(csat_rate as int) = any($${values.length}::int[])`);
    }
    if (csatIncludeNone) clauses.push("csat_rate is null");
    csatSql = `and (${clauses.join(" or ")})`;
  }
  values.push(seed, fetchLimit);
  const seedParam = values.length - 1;
  const limitParam = values.length;
  const rows = await servingQuery<FeedbackRow>(
    `
    select
      thread_id as feedback_thread_id,
      contents_concat,
      category as display_full_category_name,
      work_group_team,
      first_feedback_at as first_feedback_at_kst,
      to_char(feedback_date_kst, 'YYYY-MM-DD') as feedback_date_kst,
      csat_rate
    from feedback_serving
    where work_group_team = $1
      and human_cnt = 0
      and daangne_cnt >= 1
      and n_reply_rows >= 1
      and feedback_date_kst >= $2::date
      and feedback_date_kst <= $3::date
      ${csatSql}
    order by md5(thread_id || $${seedParam})
    limit $${limitParam}
    `,
    values,
  );

  const snapshots: ReplyPolishSample[] = [];
  for (const row of (rows ?? []) as FeedbackRow[]) {
    const sample = snapshotReplyPolishRow(row);
    if (sample) snapshots.push(sample);
  }

  return {
    samples: pickRoundRobinByCategory(snapshots, target),
    candidateCount: snapshots.length,
    fetchLimit,
    target,
    csatRates,
    csatIncludeNone,
  };
}

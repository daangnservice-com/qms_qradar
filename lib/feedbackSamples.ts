import { feedbackBq } from "./bqRefs";
import { getBQ } from "./bigquery";
import { cached } from "./serverCache";
import type { EvaluationTurn } from "./evaluationChannel";

export const FEEDBACK_SOURCE_SYSTEM = `${feedbackBq.projectId}.${feedbackBq.sourceView}`;

export interface FeedbackSample {
  channel: "feedback";
  sourceSystem: string;
  sourceId: string;
  threadId: string;
  adminId: string | null;
  adminName: string;
  participatingAdmins: { id: string; name: string }[];
  team: string;
  category: string;
  internalCategory: string | null;
  feedbackDate: string;
  firstFeedbackAt: string;
  lastEventAt: string;
  firstReplyAt: string | null;
  feedbackCount: number;
  replyCount: number;
  responseTimeSec: number | null;
  threadDurationSec: number | null;
  contentSnippet: string;
  turns: EvaluationTurn[];
  csat: {
    id: string | null;
    rate: number | null;
    comment: string | null;
  };
  hasHtmlReply: boolean;
}

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

function nullableString(v: unknown): string | null {
  const out = stringValue(v);
  return out || null;
}

function nullableNumber(v: unknown): number | null {
  const n = Number(valueOf(v));
  return Number.isFinite(n) ? n : null;
}

export function parseParticipatingAdmins(raw: string): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const part of raw.split(",")) {
    const match = part.trim().match(/^(.*?)\s*\(([^()]*)\)$/);
    if (!match) continue;
    const name = match[1].trim();
    const id = match[2].trim();
    const key = `${name}:${id}`;
    if (!name || !id || seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name });
  }
  return out;
}

function parseKstMillis(value: string): number | null {
  const normalized = value
    .trim()
    .replace(" ", "T")
    .replace(/\.(\d{3})\d+/, ".$1");
  const millis = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}+09:00`);
  return Number.isFinite(millis) ? millis : null;
}

function parseHeader(line: string): {
  kind: "feedback" | "reply";
  occurredAt: string;
  metadata: Record<string, string>;
} | null {
  const match = line.match(/^\[(FEEDBACK|REPLY)\]\s+([^|]+?)\s*\|\s*(.*)$/);
  if (!match) return null;
  const metadata: Record<string, string> = {};
  for (const part of match[3].split("|")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key) metadata[key] = part.slice(idx + 1).trim();
  }
  return {
    kind: match[1] === "REPLY" ? "reply" : "feedback",
    occurredAt: match[2].trim(),
    metadata,
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

/** 상담 답변 HTML을 텍스트 채널 화면/LLM 입력용 평문으로 정규화한다. */
export function stripFeedbackHtml(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseFeedbackContents(contents: string): EvaluationTurn[] {
  const normalized = contents.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n(?=\[(?:FEEDBACK|REPLY)\]\s)/g);
  const parsed: Array<{
    kind: "feedback" | "reply";
    occurredAt: string;
    metadata: Record<string, string>;
    text: string;
  }> = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const header = parseHeader(lines.shift() ?? "");
    if (!header) continue;
    const text = stripFeedbackHtml(lines.join("\n").replace(/\n-{5,}\s*$/g, ""));
    if (!text) continue;
    parsed.push({ ...header, text });
  }

  const firstMillis = parseKstMillis(parsed[0]?.occurredAt ?? "");
  return parsed.map((turn, index) => {
    const millis = parseKstMillis(turn.occurredAt);
    return {
      turnId:
        turn.metadata.feedback_id ??
        turn.metadata.reply_id ??
        `${turn.kind}-${index + 1}`,
      speaker: turn.kind === "feedback" ? "customer" : "agent",
      speakerLabel: turn.kind === "feedback" ? "문의자" : "상담사",
      text: turn.text,
      occurredAt: turn.occurredAt,
      atSec:
        firstMillis != null && millis != null
          ? Math.max(0, Math.round(((millis - firstMillis) / 1000) * 10) / 10)
          : null,
      sourceId: turn.metadata.feedback_id ?? turn.metadata.reply_id ?? null,
    };
  });
}

function rowToFeedbackSample(row: FeedbackRow): FeedbackSample | null {
  const sourceId = stringValue(row.feedback_thread_id);
  if (!sourceId) return null;
  const turns = parseFeedbackContents(stringValue(row.contents_concat));
  const participatingAdmins = parseParticipatingAdmins(stringValue(row.admin_agg));
  const firstFeedbackAt = stringValue(row.first_feedback_at_kst);
  const lastEventAt = stringValue(row.thread_last_event_at_kst || row.last_feedback_at_kst);
  const firstReplyAt = nullableString(row.first_reply_at_kst);
  const firstMillis = parseKstMillis(firstFeedbackAt);
  const firstReplyMillis = parseKstMillis(firstReplyAt ?? "");
  const lastMillis = parseKstMillis(lastEventAt);

  return {
    channel: "feedback",
    sourceSystem: FEEDBACK_SOURCE_SYSTEM,
    sourceId,
    threadId: sourceId,
    adminId: nullableString(row.any_admin_id),
    adminName: stringValue(row.any_admin_name),
    participatingAdmins,
    team: stringValue(row.work_group_team || row.work_group_name_ko || row.feedback_renewal_team),
    category: stringValue(row.display_full_category_name),
    internalCategory: nullableString(row.internal_feedback_category_path_name),
    feedbackDate: firstFeedbackAt.slice(0, 10),
    firstFeedbackAt,
    lastEventAt,
    firstReplyAt,
    feedbackCount: Number(row.n_feedback_rows) || 0,
    replyCount: Number(row.n_reply_rows) || 0,
    responseTimeSec:
      firstMillis != null && firstReplyMillis != null
        ? Math.max(0, Math.round((firstReplyMillis - firstMillis) / 1000))
        : null,
    threadDurationSec:
      firstMillis != null && lastMillis != null
        ? Math.max(0, Math.round((lastMillis - firstMillis) / 1000))
        : null,
    contentSnippet: turns.find((turn) => turn.speaker === "customer")?.text.slice(0, 240) ?? "",
    turns,
    csat: {
      id: nullableString(row.csat_id),
      rate: nullableNumber(row.csat_rate),
      comment: nullableString(row.csat_comment),
    },
    hasHtmlReply: /<[a-z][^>]*>/i.test(stringValue(row.contents_concat)),
  };
}

export interface FeedbackSampleFilters {
  sourceIds?: string[];
  dateStart?: string | null;
  dateEnd?: string | null;
  teams?: string[];
  categories?: string[];
  adminNames?: string[];
  feedbackCountMin?: number | null;
  feedbackCountMax?: number | null;
  replyCountMin?: number | null;
  replyCountMax?: number | null;
}

function cleanArray(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

/** 집계 뷰는 무거울 수 있으므로 짧은 TTL 캐시와 명시적 limit을 함께 적용한다. */
export async function listFeedbackSamples(
  filters: FeedbackSampleFilters = {},
  limit = 100,
): Promise<FeedbackSample[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
  const key = `feedback-samples:${JSON.stringify({ filters, safeLimit })}`;
  return cached(key, 10 * 60 * 1000, async () => {
    const where = ["feedback_start_timestamp is not null"];
    const params: Record<string, unknown> = { limit: safeLimit };
    const types: Record<string, string> = {};

    const addIn = (values: string[] | undefined, expression: string, name: string) => {
      const cleaned = cleanArray(values);
      if (!cleaned.length) return;
      where.push(`${expression} in unnest(@${name})`);
      params[name] = cleaned;
    };

    addIn(filters.sourceIds, "cast(feedback_thread_id as string)", "sourceIds");
    addIn(filters.teams, "coalesce(work_group_team, work_group_name_ko, feedback_renewal_team)", "teams");
    addIn(filters.categories, "display_full_category_name", "categories");
    const adminNames = cleanArray(filters.adminNames);
    if (adminNames.length) {
      where.push(`
        exists (
          select 1
          from unnest(split(ifnull(admin_agg, ''), ',')) as participant
          where coalesce(regexp_extract(trim(participant), r'^(.*?)\\s*\\('), trim(participant))
            in unnest(@adminNames)
        )
      `);
      params.adminNames = adminNames;
    }
    if (filters.feedbackCountMin != null && Number.isFinite(filters.feedbackCountMin)) {
      where.push("n_feedback_rows >= @feedbackCountMin");
      params.feedbackCountMin = Math.max(0, Math.floor(filters.feedbackCountMin));
      types.feedbackCountMin = "INT64";
    }
    if (filters.feedbackCountMax != null && Number.isFinite(filters.feedbackCountMax)) {
      where.push("n_feedback_rows <= @feedbackCountMax");
      params.feedbackCountMax = Math.max(0, Math.floor(filters.feedbackCountMax));
      types.feedbackCountMax = "INT64";
    }
    if (filters.replyCountMin != null && Number.isFinite(filters.replyCountMin)) {
      where.push("n_reply_rows >= @replyCountMin");
      params.replyCountMin = Math.max(0, Math.floor(filters.replyCountMin));
      types.replyCountMin = "INT64";
    }
    if (filters.replyCountMax != null && Number.isFinite(filters.replyCountMax)) {
      where.push("n_reply_rows <= @replyCountMax");
      params.replyCountMax = Math.max(0, Math.floor(filters.replyCountMax));
      types.replyCountMax = "INT64";
    }
    if (filters.dateStart) {
      where.push("date(feedback_start_timestamp, 'Asia/Seoul') >= @dateStart");
      params.dateStart = filters.dateStart;
    }
    if (filters.dateEnd) {
      where.push("date(feedback_start_timestamp, 'Asia/Seoul') <= @dateEnd");
      params.dateEnd = filters.dateEnd;
    }

    const [rows] = await getBQ().query({
      query: `
        select
          feedback_thread_id,
          any_admin_id,
          any_admin_name,
          admin_agg,
          contents_concat,
          display_full_category_name,
          feedback_category_path_id,
          feedback_renewal_team,
          feedback_start_timestamp,
          first_feedback_at_kst,
          first_reply_at_kst,
          last_feedback_at_kst,
          last_reply_at_kst,
          thread_first_event_at_kst,
          thread_last_event_at_kst,
          n_feedback_rows,
          n_reply_rows,
          work_group_name,
          work_group_name_ko,
          work_group_team,
          internal_feedback_category_path_name,
          csat_id,
          csat_rate,
          csat_comment
        from ${feedbackBq.sourceSql()}
        where status = 20
          and ${where.join("\n          and ")}
        order by feedback_start_timestamp desc
        limit @limit
      `,
      params,
      ...(Object.keys(types).length ? { types } : {}),
      location: feedbackBq.location,
    });
    return (rows as FeedbackRow[]).map(rowToFeedbackSample).filter((row): row is FeedbackSample => Boolean(row));
  });
}

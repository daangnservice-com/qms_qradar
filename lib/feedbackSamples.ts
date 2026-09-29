import { FEEDBACK_SOURCE_SYSTEM } from "./bqRefs";
import type { EvaluationTurn } from "./evaluationChannel";
import { replyAdminDisplayName } from "./feedbackAdmins";
import type { FeedbackCountTarget } from "./highRiskFlags";

export { DAANGNE_ADMIN_ID, DAANGNE_ADMIN_NAME, replyAdminDisplayName, replyAdminNamesForDisplay } from "./feedbackAdmins";

export { FEEDBACK_SOURCE_SYSTEM } from "./bqRefs";

export interface FeedbackSample {
  channel: "feedback";
  sourceSystem: string;
  sourceId: string;
  threadId: string;
  adminId: string | null;
  adminName: string;
  participatingAdmins: { id: string; name: string }[];
  /** 스레드에서 마지막으로 답변한 어드민. 당근이(10588)일 수 있다. */
  lastReplyAdminId: string | null;
  lastReplyAdminName: string | null;
  team: string;
  category: string;
  internalCategory: string | null;
  feedbackDate: string;
  firstFeedbackAt: string;
  /** 스레드 마지막 이벤트(=해결 시각에 가장 가까운 값) */
  lastEventAt: string;
  firstReplyAt: string | null;
  lastReplyAt: string | null;
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
  const raw = valueOf(v);
  // Number(null) === 0 이라, CSAT 미참여를 0점으로 오해하지 않게 먼저 걸러낸다.
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
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

/**
 * REPLY 헤더의 `reply_admin_id=10588(Jane)` 에서 답변 어드민을 뽑는다.
 * 원천 뷰가 admin 이름 조회에 실패하면 괄호가 비어 있어(`10588()`) 이름은 null로 둔다.
 */
export function parseReplyAdmin(raw: string): { id: string | null; name: string | null } {
  const match = raw.trim().match(/^([^()]*?)\s*(?:\(([^()]*)\))?$/);
  if (!match) return { id: null, name: null };
  return { id: match[1].trim() || null, name: (match[2] ?? "").trim() || null };
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

/**
 * @param agentFallbackLabel REPLY 헤더에 사람 어드민 이름이 없을 때 쓸 라벨(스레드 담당 어드민).
 *   당근이(10588)는 할당 어드민으로 대체하지 않는다. 이름도 없으면 "상담사"로 떨어진다.
 */
export function parseFeedbackContents(contents: string, agentFallbackLabel?: string | null): EvaluationTurn[] {
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

  const agentFallback = (agentFallbackLabel ?? "").trim() || "상담사";
  const firstMillis = parseKstMillis(parsed[0]?.occurredAt ?? "");
  return parsed.map((turn, index) => {
    const millis = parseKstMillis(turn.occurredAt);
    const replyAdmin = parseReplyAdmin(turn.metadata.reply_admin_id ?? "");
    return {
      turnId:
        turn.metadata.feedback_id ??
        turn.metadata.reply_id ??
        `${turn.kind}-${index + 1}`,
      speaker: turn.kind === "feedback" ? "customer" : "agent",
      speakerLabel:
        turn.kind === "feedback"
          ? "문의자"
          : replyAdminDisplayName(replyAdmin.id, replyAdmin.name) ?? agentFallback,
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

export function rowToFeedbackSample(row: FeedbackRow): FeedbackSample | null {
  const sourceId = stringValue(row.feedback_thread_id);
  if (!sourceId) return null;
  const adminName = stringValue(row.any_admin_name);
  const turns = parseFeedbackContents(stringValue(row.contents_concat), adminName);
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
    adminName,
    participatingAdmins,
    lastReplyAdminId: nullableString(row.last_reply_admin_id),
    lastReplyAdminName: nullableString(row.last_reply_admin_name),
    // 콜 품질과 같은 「소속(renewal team)」 기준으로 맞춘다. 뷰의 work_group_* 는 문의가 배정된 조직이라 값이 다르다.
    team: stringValue(row.feedback_renewal_team || row.work_group_team || row.work_group_name_ko),
    category: stringValue(row.display_full_category_name),
    internalCategory: nullableString(row.internal_feedback_category_path_name),
    feedbackDate: firstFeedbackAt.slice(0, 10),
    firstFeedbackAt,
    lastEventAt,
    firstReplyAt,
    lastReplyAt: nullableString(row.last_reply_at_kst),
    feedbackCount: nullableNumber(row.n_feedback_rows) ?? 0,
    replyCount: nullableNumber(row.n_reply_rows) ?? 0,
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
  adminIds?: string[];
  csatRates?: number[];
  /** CSAT 미참여(설문 없음) 스레드도 포함 */
  csatIncludeNone?: boolean;
  feedbackCountMin?: number | null;
  feedbackCountMax?: number | null;
  replyCountMin?: number | null;
  replyCountMax?: number | null;
  /** 사람 답변 어드민 수(뷰 human_cnt). 당근이만 답변한 스레드는 0. */
  humanCountMin?: number | null;
  humanCountMax?: number | null;
  /**
   * 고위험군 건수 규칙(OR). 목록 API가 평가 설계 규칙에서 채운다.
   * 최근 N건을 가져온 뒤 메모리에서 걸르면 고위험 스레드가 창 밖에 있어 빈 목록이 된다.
   */
  highRiskCountAny?: { countTarget: FeedbackCountTarget; minCount: number }[];
}

/** SQL로 내려가지 않는 필터까지 포함한 목록 API 입력. */
export type FeedbackListFilters = FeedbackSampleFilters & {
  /** AI 평가 결과가 있는 스레드만 — 평가 결과 병합 후 걸러진다. */
  analyzedOnly?: boolean;
  /** 고위험군 플래그가 하나라도 붙은 스레드만 */
  highRiskOnly?: boolean;
  /** 특정 플래그 키만(선택한 것 중 하나라도 = OR). 비면 전체 고위험군. */
  highRiskFlagKeys?: string[];
};

function cleanArray(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

/** 스레드 ID가 있으면 그 ID만 찾고 나머지 필터는 무시한다. */
export function isFeedbackThreadLookup(filters: FeedbackSampleFilters): boolean {
  return cleanArray(filters.sourceIds).length > 0;
}

export interface FeedbackFilterOptions {
  /** 팀-어드민 쌍. 콜 품질 필터 옵션과 같은 모양이라 패널 코드를 공유한다. */
  teamAgents: { team: string; name: string }[];
  categories: string[];
}

/** 종결 스레드 목록. Postgres `feedback_serving` 을 본다. */
export async function listFeedbackSamples(
  filters: FeedbackSampleFilters = {},
  limit = 100,
): Promise<FeedbackSample[]> {
  const { listServingFeedbackSamples } = await import("./feedbackServingStore");
  return listServingFeedbackSamples(filters, limit);
}

/** 팀·어드민·카테고리 고유값. 최근 90일 서빙 행에서 뽑는다. */
export async function listFeedbackFilterOptions(): Promise<FeedbackFilterOptions> {
  const { listServingFeedbackFilterOptions } = await import("./feedbackServingStore");
  return listServingFeedbackFilterOptions();
}

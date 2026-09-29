// CSAT BigQuery 조회 (서버 전용).
// 클라이언트가 import하는 lib/csat.ts 에 BigQuery를 넣지 않기 위해 분리.
import { getBQ } from "./bigquery";
import { csatBq } from "./bqRefs";
import { cached, SERVER_CACHE_TTL } from "./serverCache";
import {
  CHOICE_FALLBACK,
  CSAT_CHOICE_KEYS,
  type CsatChoice,
  type CsatChoiceMeta,
  type CsatRecord,
} from "./csat";

export type { CsatChoice, CsatChoiceMeta, CsatRecord, CsatSentiment } from "./csat";
export {
  CSAT_CHOICE_KEYS,
  DSAT_DEFAULT_MAX_RATE,
  DSAT_TOOL_MAX_RATE,
  DSAT_TOOL_ORIGIN,
  buildDsatToolUrl,
  isDsatRate,
} from "./csat";

// 고객 설문(CSAT) 원본 조회.
// ⚠️ 원천은 karrotmarket 프로젝트의 뷰 — 앱 기본 프로젝트와 다르다(참조는 lib/bqRefs.ts, csatBq).
//
//  · 중복 응답이 섞여 있어 항상 `dup_no = 1`만 쓴다.
//  · 전화: inquiry_type = 'PhoneInquiry' AND inquiry_id = 상담이력 ID.
//  · 인앱 문의: 집계 뷰의 csat_id 로 원천 rawlog를 읽는다.
//  · 설문에 참여하지 않은 건은 아예 행이 없다 → CSAT 없음은 정상 상태(에러 아님).
//
// CSAT는 부가 정보라 조회 실패가 목록·평가 흐름을 막지 않는다(모두 빈 결과로 폴백).

const RAWLOG_SQL = csatBq.rawlogSql();
const CHOICES_SQL = csatBq.choicesSql();
const LOC = csatBq.location ? { location: csatBq.location } : {};

/** dup_no=1 + 전화 문의만. 목록·상세 CSAT 조회의 공통 조건. */
const BASE_WHERE = "dup_no = 1 and inquiry_type = 'PhoneInquiry'";

/** BQ DATETIME/TIMESTAMP → 문자열. 클라이언트가 {value} 래퍼로 주는 경우를 흡수. */
function dtValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) return String((v as { value: string }).value);
  return v == null ? "" : String(v);
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 원천의 inquiry_id는 INT64, 앱의 상담이력 ID는 문자열이다.
 * 비교는 SQL에서 문자열로 맞추고(cast), 여기서는 숫자로 떨어지는 값만 남겨 잡값을 거른다.
 */
function toInquiryIds(ids: string[]): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    const s = String(raw ?? "").trim();
    const n = Number(s);
    if (s && Number.isSafeInteger(n) && n > 0) out.add(String(n));
  }
  return [...out];
}

/** 선택된 choice_* 컬럼만 key 배열로 펼치는 SQL 조각. */
const CHOICE_KEYS_SQL = `array(
      select k from unnest([
        ${CSAT_CHOICE_KEYS.map((k) => `struct('${k}' as k, choice_${k} as v)`).join(",\n        ")}
      ]) where v is not null and v != 0
    )`;

/** enum_string → 한글 라벨·감정·이슈유형. 사전 테이블은 11행 남짓이라 통째로 캐시한다. */
export async function listCsatChoiceMeta(): Promise<Record<string, CsatChoiceMeta>> {
  return cached("csat-choices", SERVER_CACHE_TTL.csatChoices, async () => {
    try {
      const [rows] = await getBQ().query({
        query: `select enum_string, display_enum, sentiment, issue_type from ${CHOICES_SQL}`,
        ...LOC,
      });
      const map: Record<string, CsatChoiceMeta> = { ...CHOICE_FALLBACK };
      for (const r of rows as Record<string, unknown>[]) {
        const key = String(r.enum_string ?? "").trim();
        if (!key) continue;
        const s = String(r.sentiment ?? "").trim().toLowerCase();
        map[key] = {
          label: r.display_enum ? String(r.display_enum) : (CHOICE_FALLBACK[key]?.label ?? key),
          sentiment: s === "positive" || s === "negative" ? s : "",
          issueType: r.issue_type ? String(r.issue_type) : "",
        };
      }
      return map;
    } catch (e) {
      console.warn("[csat] listCsatChoiceMeta:", e instanceof Error ? e.message : e);
      return { ...CHOICE_FALLBACK };
    }
  });
}

function mapCsatRow(r: Record<string, unknown>, meta: Record<string, CsatChoiceMeta>): CsatRecord {
  return {
    csatId: String(r.csat_id ?? "").trim(),
    adminUserId: r.admin_user_id == null || r.admin_user_id === "" ? "" : String(r.admin_user_id).trim(),
    phoneInquiryId: String(r.inquiry_id ?? "").trim(),
    createdAt: dtValue(r.created_at_kst),
    rate: numOrNull(r.rate),
    comment: r.comment ? String(r.comment) : "",
    choices: buildChoices(r.choice_keys, meta),
    issueType: r.issue_type ? String(r.issue_type) : "",
    resolved: typeof r.resolved === "boolean" ? r.resolved : null,
    isProfane: r.is_profane === true,
  };
}

async function getCsatRow(whereSql: string, id: string): Promise<CsatRecord | null> {
  const query = `
    select
      csat_id,
      admin_user_id,
      cast(inquiry_id as string) as inquiry_id,
      created_at_kst,
      rate,
      comment,
      issue_type,
      resolved,
      is_profane,
      ${CHOICE_KEYS_SQL} as choice_keys
    from ${RAWLOG_SQL}
    where ${whereSql}
    order by created_at_kst desc
    limit 1
  `;
  try {
    const [[rows], meta] = await Promise.all([
      getBQ().query({ query, params: { id }, ...LOC }),
      listCsatChoiceMeta(),
    ]);
    const r = (rows as Record<string, unknown>[])[0];
    return r ? mapCsatRow(r, meta) : null;
  } catch (e) {
    console.warn("[csat] getCsat:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type CsatInquiryType = "PhoneInquiry" | "FeedbackThread";

/**
 * 전화·인앱 CSAT 을 한 번에 읽는다(문의별 최신). 서빙 pull 용.
 * 원천 뷰는 날짜로 잘라도 파티션이 안 걸려 매번 약 600MB를 읽는다. 그래서 유형을 나눠 여러 번 치지 않는다.
 * `sinceDays`가 없으면 `sinceDate` 이후 전부.
 */
export async function listCsatRecordsSince(opts: {
  sinceDays?: number;
  sinceDate?: string;
}): Promise<Array<{ inquiryType: CsatInquiryType; record: CsatRecord }>> {
  const since = opts.sinceDays
    ? `created_at_kst >= datetime_sub(current_datetime('Asia/Seoul'), interval ${Math.min(Math.max(Math.floor(opts.sinceDays), 1), 400)} day)`
    : "created_at_kst >= datetime(@since_date)";
  const query = `
    select
      inquiry_type,
      csat_id,
      admin_user_id,
      cast(inquiry_id as string) as inquiry_id,
      created_at_kst,
      rate,
      comment,
      issue_type,
      resolved,
      is_profane,
      ${CHOICE_KEYS_SQL} as choice_keys
    from ${RAWLOG_SQL}
    where dup_no = 1
      and inquiry_type in ('PhoneInquiry', 'FeedbackThread')
      and ${since}
    qualify row_number() over (partition by inquiry_type, cast(inquiry_id as string) order by created_at_kst desc) = 1
  `;
  const [[rows], meta] = await Promise.all([
    getBQ().query({
      query,
      ...(opts.sinceDays ? {} : { params: { since_date: opts.sinceDate ?? "2025-02-01" } }),
      ...LOC,
    }),
    listCsatChoiceMeta(),
  ]);
  return (rows as Record<string, unknown>[])
    .map((r) => ({ inquiryType: String(r.inquiry_type) as CsatInquiryType, record: mapCsatRow(r, meta) }))
    .filter((r) => r.record.phoneInquiryId);
}

/** CSAT 응답 ID → 전체(코멘트·선택지 포함). 서빙에 아직 없는 인앱 CSAT 폴백용. */
export async function getCsatByCsatId(csatId: string): Promise<CsatRecord | null> {
  const [id] = toInquiryIds([csatId]);
  if (!id) return null;
  return getCsatRow("dup_no = 1 and cast(csat_id as string) = @id", id);
}

function buildChoices(raw: unknown, meta: Record<string, CsatChoiceMeta>): CsatChoice[] {
  if (!Array.isArray(raw)) return [];
  const order = new Map<string, number>(CSAT_CHOICE_KEYS.map((k, i) => [k, i]));
  return raw
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
    .map((key) => {
      const m = meta[key] ?? CHOICE_FALLBACK[key];
      return {
        key,
        label: m?.label ?? key,
        sentiment: m?.sentiment ?? "",
        issueType: m?.issueType ?? "",
      } satisfies CsatChoice;
    });
}

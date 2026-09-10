import { getBQ } from "./bigquery";
import { csatBq } from "./bqRefs";
import { DSAT_DEFAULT_MAX_RATE } from "./highRiskFlags";
import { cached, SERVER_CACHE_TTL } from "./serverCache";

// 고객 설문(CSAT) 원본 조회.
// ⚠️ 원천은 karrotmarket 프로젝트의 뷰 — 앱 기본 프로젝트와 다르다(참조는 lib/bqRefs.ts, csatBq).
//
//  · 중복 응답이 섞여 있어 항상 `dup_no = 1`만 쓴다.
//  · 전화 컨버세이션 매핑: inquiry_type = 'PhoneInquiry' AND inquiry_id = 상담이력 ID(phoneInquiryId).
//  · 설문에 참여하지 않은 통화는 아예 행이 없다 → CSAT 없음은 정상 상태(에러 아님).
//
// CSAT는 부가 정보라 조회 실패가 목록·평가 흐름을 막지 않는다(모두 빈 결과로 폴백).

const RAWLOG_SQL = csatBq.rawlogSql();
const CHOICES_SQL = csatBq.choicesSql();
const LOC = csatBq.location ? { location: csatBq.location } : {};

/** dup_no=1 + 전화 문의만. 모든 CSAT 조회의 공통 조건. */
const BASE_WHERE = "dup_no = 1 and inquiry_type = 'PhoneInquiry'";

export type CsatSentiment = "positive" | "negative" | "";

interface CsatChoiceMeta {
  label: string;
  sentiment: CsatSentiment;
  issueType: string;
}

/**
 * 선택지 컬럼(choice_*)의 접미 = 사전(utility_inquiry_ratings_choices)의 enum_string.
 * 한글 라벨은 사전에서 읽지만, 사전 조회가 실패해도 화면이 비지 않도록 여기에 폴백을 둔다.
 * (사전은 거의 바뀌지 않는다 — 바뀌면 사전 쪽이 이긴다.)
 * 정렬 순서 = 설문 UI 순서(긍정 → 부정).
 */
const CHOICE_FALLBACK: Record<string, CsatChoiceMeta> = {
  correct_answer: { label: "답변이 정확해요", sentiment: "positive", issueType: "" },
  quick_answer: { label: "답변이 빨라요", sentiment: "positive", issueType: "" },
  kindly: { label: "친절해요", sentiment: "positive", issueType: "" },
  positive_etc: { label: "기타", sentiment: "positive", issueType: "" },
  different_answer: { label: "질문 내용과 달라요", sentiment: "negative", issueType: "상담사" },
  cant_understand: { label: "답변이 이해가 안됐어요", sentiment: "negative", issueType: "상담사" },
  unfriendly: { label: "상담 직원이 불친절했어요", sentiment: "negative", issueType: "상담사" },
  late_reply: { label: "상담 연결 또는 답변이 오래 걸렸어요", sentiment: "negative", issueType: "시스템" },
  app_inconvenient: { label: "당근 앱 사용이 불편해요", sentiment: "negative", issueType: "시스템" },
  policy_dissatisfied: { label: "당근 정책이 마음에 들지 않아요", sentiment: "negative", issueType: "정책" },
  negative_etc: { label: "기타", sentiment: "negative", issueType: "기타" },
};

export const CSAT_CHOICE_KEYS = Object.keys(CHOICE_FALLBACK);

export interface CsatChoice {
  /** enum_string (예: unfriendly) */
  key: string;
  /** display_enum — 한글 라벨 */
  label: string;
  sentiment: CsatSentiment;
  /** 사전의 issue_type (상담사 / 시스템 / 정책 / 기타) */
  issueType: string;
}

/** 통화 1건에 매칭된 CSAT 응답. */
export interface CsatRecord {
  csatId: string;
  /** 상담이력 ID = inquiry_id */
  phoneInquiryId: string;
  /** 설문 응답 시각(KST) */
  createdAt: string;
  /** 1~5. 설문은 있는데 점수가 비는 경우를 대비해 nullable. */
  rate: number | null;
  comment: string;
  choices: CsatChoice[];
  /** 뷰가 계산해 둔 이슈 유형(쉼표 구분) */
  issueType: string;
  resolved: boolean | null;
  isProfane: boolean;
}

export { DSAT_DEFAULT_MAX_RATE };

export function isDsatRate(rate: number | null | undefined, maxRate: number): boolean {
  return typeof rate === "number" && Number.isFinite(rate) && rate <= maxRate;
}

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

/**
 * 상담이력 ID → CSAT 점수(1~5). 목록에서 뱃지·DSAT 판정용이라 점수만 가볍게 읽는다.
 * 설문 미참여 건은 맵에 없다.
 */
export async function listCsatRatesByPhoneInquiryIds(
  phoneInquiryIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = toInquiryIds(phoneInquiryIds);
  if (!ids.length) return out;

  const query = `
    select cast(inquiry_id as string) as inquiry_id, rate
    from ${RAWLOG_SQL}
    where ${BASE_WHERE}
      and cast(inquiry_id as string) in unnest(@ids)
      and rate is not null
  `;
  try {
    const [rows] = await getBQ().query({
      query,
      params: { ids },
      ...LOC,
    });
    for (const r of rows as Record<string, unknown>[]) {
      const id = String(r.inquiry_id ?? "").trim();
      const rate = numOrNull(r.rate);
      if (id && rate != null) out.set(id, rate);
    }
  } catch (e) {
    console.warn("[csat] listCsatRates:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** 상담이력 ID → CSAT 전체(코멘트·선택지 포함). 녹취 화면의 CSAT 패널용. */
export async function getCsatByPhoneInquiryId(phoneInquiryId: string): Promise<CsatRecord | null> {
  const [id] = toInquiryIds([phoneInquiryId]);
  if (!id) return null;

  const query = `
    select
      csat_id,
      cast(inquiry_id as string) as inquiry_id,
      created_at_kst,
      rate,
      comment,
      issue_type,
      resolved,
      is_profane,
      ${CHOICE_KEYS_SQL} as choice_keys
    from ${RAWLOG_SQL}
    where ${BASE_WHERE}
      and cast(inquiry_id as string) = @id
    order by created_at_kst desc
    limit 1
  `;
  try {
    const [[rows], meta] = await Promise.all([
      getBQ().query({ query, params: { id }, ...LOC }),
      listCsatChoiceMeta(),
    ]);
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;
    return {
      csatId: String(r.csat_id ?? ""),
      phoneInquiryId: String(r.inquiry_id ?? "").trim(),
      createdAt: dtValue(r.created_at_kst),
      rate: numOrNull(r.rate),
      comment: r.comment ? String(r.comment) : "",
      choices: buildChoices(r.choice_keys, meta),
      issueType: r.issue_type ? String(r.issue_type) : "",
      resolved: typeof r.resolved === "boolean" ? r.resolved : null,
      isProfane: r.is_profane === true,
    };
  } catch (e) {
    console.warn("[csat] getCsat:", e instanceof Error ? e.message : e);
    return null;
  }
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

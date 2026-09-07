import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { cached, SERVER_CACHE_TTL } from "./serverCache";
import type { EvaluationSample, SampleFilters } from "./types";

// 전화문의 콜 분석용 샘플을 BigQuery에서 조회한다.
// ⚠️ 앱 기본 프로젝트와 다른 프로젝트/리전(US) — 참조는 lib/bqRefs.ts(growthBq).
//    - 서비스계정에 대상 데이터셋 read 권한 필요(roles/bigquery.dataViewer).
// case_content의 문의 생성시간을 꺼낸 inquiry_created_at_kst(DATETIME, 파티션) 컬럼이 있다.
const CASES_SQL = growthBq.casesSql();
const LOCATION = growthBq.location;

const SNIPPET_MAX = 200;
const CID = "json_value(case_content, '$.genesys_conversation_id')";

// call_start는 UTC다(원문 예: 2026-07-24T01:29:07.706467Z).
// 앞 10자를 그대로 날짜로 쓰면 KST 09시 이전 통화가 전날로 밀리므로, Asia/Seoul 기준 날짜로 변환한다.
// safe_cast: 포맷이 어긋난 행은 에러 대신 null(그 행은 날짜 필터에서 제외).
const CALL_START_TS = "safe_cast(json_value(case_content, '$.call_start') as timestamp)";
const CALL_DATE_KST = `format_date('%F', date(${CALL_START_TS}, 'Asia/Seoul'))`;

// 통화 길이(초). call_end-call_start를 우선 쓰고, 안 되면 minutes_taken(분)으로 폴백.
function callDurationSec(callStart: unknown, callEnd: unknown, minutesTaken: unknown): number | null {
  const s = Date.parse(String(callStart ?? ""));
  const e = Date.parse(String(callEnd ?? ""));
  if (Number.isFinite(s) && Number.isFinite(e) && e > s) return Math.round((e - s) / 1000);
  const m = Number(minutesTaken);
  if (Number.isFinite(m) && m > 0) return Math.round(m * 60);
  return null;
}

const cleanArr = (a?: string[]): string[] => (a ?? []).map((s) => s.trim()).filter(Boolean);

// 필터 드롭다운용 옵션. 팀↔상담사(닉네임) 페어(연동 드롭다운용) + 카테고리 고유값.
export async function listFilterOptions(): Promise<{ teamAgents: { team: string; name: string }[]; categories: string[] }> {
  return cached("filter-options", SERVER_CACHE_TTL.filterOptions, async () => {
  const base = `from ${CASES_SQL} where year_month >= '2026-04-01'`;
  const pairsQ = `
    select distinct
      json_value(case_content, '$.operator_renewal_team_name') as team,
      json_value(case_content, '$.Admin Name')                 as name
    ${base} and json_value(case_content, '$.Admin Name') is not null
  `;
  const catsQ = `
    select distinct json_value(case_content, '$.카테고리') as category
    ${base} and json_value(case_content, '$.카테고리') is not null
  `;
  const opts = LOCATION ? { location: LOCATION } : {};
  const [[pairRows], [catRows]] = await Promise.all([
    getBQ().query({ query: pairsQ, ...opts }),
    getBQ().query({ query: catsQ, ...opts }),
  ]);
  const teamAgents = (pairRows as Record<string, unknown>[]).map((r) => ({
    team: r.team ? String(r.team) : "",
    name: String(r.name),
  }));
  const categories = (catRows as Record<string, unknown>[])
    .map((r) => String(r.category))
    .sort((a, b) => a.localeCompare(b, "ko"));
  return { teamAgents, categories };
  });
}

export async function listEvaluationSamples(filters: SampleFilters = {}, limit = 100): Promise<EvaluationSample[]> {
  // 값이 있는 필터만 동적으로 절/파라미터를 추가한다(빈 필터=기본 쿼리, 빈배열/null 파라미터 회피).
  const where: string[] = ["year_month >= '2026-04-01'", `${CID} is not null`];
  const params: Record<string, unknown> = { limit };
  const types: Record<string, string> = {};

  const addIn = (vals: string[], expr: string, name: string) => {
    if (vals.length) {
      where.push(`${expr} in unnest(@${name})`);
      params[name] = vals;
    }
  };
  addIn(cleanArr(filters.conversationIds), CID, "conversationIds");
  addIn(cleanArr(filters.phoneInquiryIds), "json_value(case_content, '$.상담이력 ID')", "phoneInquiryIds");
  addIn(cleanArr(filters.adminUserIds), "json_value(case_content, '$.Admin ID')", "adminUserIds");
  addIn(cleanArr(filters.adminNames), "json_value(case_content, '$.Admin Name')", "adminNames");
  addIn(cleanArr(filters.teams), "json_value(case_content, '$.operator_renewal_team_name')", "teams");
  addIn(cleanArr(filters.categories), "json_value(case_content, '$.카테고리')", "categories");

  // 콜 날짜(KST 기준 YYYY-MM-DD 문자열 비교). 사용자가 고른 날짜는 당연히 KST 기준이다.
  if (filters.callDateStart) {
    where.push(`${CALL_DATE_KST} >= @callDateStart`);
    params.callDateStart = filters.callDateStart;
  }
  if (filters.callDateEnd) {
    where.push(`${CALL_DATE_KST} <= @callDateEnd`);
    params.callDateEnd = filters.callDateEnd;
  }
  const minutesExpr = "safe_cast(json_value(case_content, '$.minutes_taken') as float64)";
  if (filters.callLenMin != null) {
    where.push(`${minutesExpr} >= @callLenMin`);
    params.callLenMin = filters.callLenMin;
    types.callLenMin = "FLOAT64";
  }
  if (filters.callLenMax != null) {
    where.push(`${minutesExpr} <= @callLenMax`);
    params.callLenMax = filters.callLenMax;
    types.callLenMax = "FLOAT64";
  }

  const query = `
    select
      ${CID}                                                as conversation_id,
      json_value(case_content, '$.상담이력 ID')             as phone_inquiry_id,
      json_value(case_content, '$.Admin Name')              as admin_name,
      json_value(case_content, '$.operator_renewal_team_name') as team,
      json_value(case_content, '$.카테고리')                as category,
      json_value(case_content, '$.call_start')              as call_start,
      ${CALL_DATE_KST}                                      as call_date_kst,
      json_value(case_content, '$.call_end')                as call_end,
      json_value(case_content, '$.minutes_taken')           as minutes_taken,
      json_value(case_content, '$.상담이력')                as phone_inquiry_content
    from ${CASES_SQL}
    where ${where.join("\n      and ")}
    -- 한 통화(conversation_id)가 여러 상담이력 케이스에 묶여 중복될 수 있어 통화당 최신 1건만.
    qualify row_number() over (partition by ${CID} order by inquiry_created_at_kst desc) = 1
    order by inquiry_created_at_kst desc
    limit @limit
  `;

  const [rows] = await getBQ().query({
    query,
    params,
    ...(Object.keys(types).length ? { types } : {}),
    ...(LOCATION ? { location: LOCATION } : {}),
  });

  return (rows as Record<string, unknown>[]).map((r) => ({
    conversationId: String(r.conversation_id ?? ""),
    phoneInquiryId: r.phone_inquiry_id ? String(r.phone_inquiry_id) : "",
    adminName: r.admin_name ? String(r.admin_name) : "",
    team: r.team ? String(r.team) : "",
    category: r.category ? String(r.category) : "",
    // 표시도 KST 기준. UTC 앞 10자를 쓰면 필터 결과와 화면 날짜가 어긋난다.
    callDate: r.call_date_kst ? String(r.call_date_kst) : "",
    contentSnippet: r.phone_inquiry_content ? String(r.phone_inquiry_content).slice(0, SNIPPET_MAX) : "",
    callDurationSec: callDurationSec(r.call_start, r.call_end, r.minutes_taken),
    analyzed: false, // 라우트에서 저장 결과 조회 후 채운다
  }));
}

/** conversation id → 상담사 닉네임 · 콜 날짜(KST) 배치 조회 */
export async function listCaseMetaByConversationIds(
  conversationIds: string[],
): Promise<Map<string, { adminName: string; callDate: string }>> {
  const ids = [...new Set(conversationIds.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, { adminName: string; callDate: string }>();
  if (!ids.length) return out;
  const query = `
    select
      ${CID}                                   as conversation_id,
      json_value(case_content, '$.Admin Name') as admin_name,
      ${CALL_DATE_KST}                         as call_date_kst
    from ${CASES_SQL}
    where ${CID} in unnest(@ids)
    qualify row_number() over (partition by ${CID} order by inquiry_created_at_kst desc) = 1
  `;
  try {
    const [rows] = await getBQ().query({
      query,
      params: { ids },
      ...(LOCATION ? { location: LOCATION } : {}),
    });
    for (const r of rows as Record<string, unknown>[]) {
      const id = String(r.conversation_id ?? "");
      if (!id) continue;
      out.set(id, {
        adminName: r.admin_name ? String(r.admin_name) : "",
        callDate: r.call_date_kst ? String(r.call_date_kst) : "",
      });
    }
  } catch (e) {
    console.warn("[evaluationSamples] listCaseMeta:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** 상담이력 ID(phone_inquiry_id) → Genesys conversation_id */
export async function resolveConversationIdByPhoneInquiryId(
  phoneInquiryId: string,
): Promise<{ conversationId: string; phoneInquiryId: string } | null> {
  const inquiryId = phoneInquiryId.trim();
  if (!inquiryId) return null;
  const query = `
    select
      ${CID} as conversation_id,
      json_value(case_content, '$.상담이력 ID') as phone_inquiry_id
    from ${CASES_SQL}
    where year_month >= '2026-04-01'
      and ${CID} is not null
      and json_value(case_content, '$.상담이력 ID') = @inquiryId
    order by inquiry_created_at_kst desc
    limit 1
  `;
  try {
    const [rows] = await getBQ().query({
      query,
      params: { inquiryId },
      ...(LOCATION ? { location: LOCATION } : {}),
    });
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;
    const conversationId = String(r.conversation_id ?? "").trim();
    if (!conversationId) return null;
    return {
      conversationId,
      phoneInquiryId: r.phone_inquiry_id ? String(r.phone_inquiry_id) : inquiryId,
    };
  } catch (e) {
    console.warn(
      "[evaluationSamples] resolveConversationIdByPhoneInquiryId:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

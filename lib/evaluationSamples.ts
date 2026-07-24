import { getBQ } from "./bigquery";
import type { EvaluationSample } from "./types";

// 전화문의 품질평가용 신규 샘플을 BigQuery에서 조회한다.
// ⚠️ 앱 기본 프로젝트(striped-option-…)와 다른 프로젝트/리전(US)의 테이블이라 교차 프로젝트 접근.
//    - 서비스계정에 대상 데이터셋 read 권한 필요(roles/bigquery.dataViewer).
//    - 리전(US)은 GROWTH_CULTURE_LOCATION으로 명시(미설정이면 auto-detect).
// 2026-07: DA가 권한 없는 데이터셋을 참조하던 뷰(vw_…) 대신 data-proj에 실물 테이블을 생성.
//    파티션/증분 처리용으로 case_content의 문의 생성시간을 꺼낸 inquiry_created_at_kst 컬럼이 추가됨.
const PROJECT = process.env.GROWTH_CULTURE_PROJECT_ID ?? "data-proj-470202";
const TABLE = process.env.EVAL_CASES_TABLE ?? "ds_growth_culture.qradar_evaluation_cases";
const LOCATION = process.env.GROWTH_CULTURE_LOCATION; // 미설정이면 auto-detect (실제값: US)

const SNIPPET_MAX = 200;

// 통화 길이(초). call_end-call_start를 우선 쓰고, 안 되면 minutes_taken(분)으로 폴백.
function callDurationSec(callStart: unknown, callEnd: unknown, minutesTaken: unknown): number | null {
  const s = Date.parse(String(callStart ?? ""));
  const e = Date.parse(String(callEnd ?? ""));
  if (Number.isFinite(s) && Number.isFinite(e) && e > s) return Math.round((e - s) / 1000);
  const m = Number(minutesTaken);
  if (Number.isFinite(m) && m > 0) return Math.round(m * 60);
  return null;
}

export async function listEvaluationSamples(limit = 100): Promise<EvaluationSample[]> {
  const query = `
    select
      json_value(case_content, '$.genesys_conversation_id') as conversation_id,
      json_value(case_content, '$.상담이력 ID')             as phone_inquiry_id,
      json_value(case_content, '$.상담이력')                as phone_inquiry_content,
      json_value(case_content, '$.call_start')              as call_start,
      json_value(case_content, '$.call_end')                as call_end,
      json_value(case_content, '$.minutes_taken')           as minutes_taken,
      cast(inquiry_created_at_kst as string)                as inquiry_created_at,
      cast(year_month as string)                            as year_month
    from \`${PROJECT}.${TABLE}\`
    where year_month >= '2026-04-01'
      and json_value(case_content, '$.genesys_conversation_id') is not null
    -- 한 통화(conversation_id)가 여러 상담이력 케이스에 묶여 중복될 수 있어 통화당 최신 1건만.
    qualify row_number() over (
      partition by json_value(case_content, '$.genesys_conversation_id')
      order by inquiry_created_at_kst desc
    ) = 1
    order by inquiry_created_at_kst desc
    limit @limit
  `;

  const [rows] = await getBQ().query({
    query,
    params: { limit },
    ...(LOCATION ? { location: LOCATION } : {}),
  });

  return (rows as Record<string, unknown>[]).map((r) => ({
    conversationId: String(r.conversation_id ?? ""),
    phoneInquiryId: r.phone_inquiry_id ? String(r.phone_inquiry_id) : "",
    contentSnippet: r.phone_inquiry_content ? String(r.phone_inquiry_content).slice(0, SNIPPET_MAX) : "",
    inquiryCreatedAt: r.inquiry_created_at ? String(r.inquiry_created_at) : "",
    yearMonth: r.year_month ? String(r.year_month) : "",
    callDurationSec: callDurationSec(r.call_start, r.call_end, r.minutes_taken),
  }));
}

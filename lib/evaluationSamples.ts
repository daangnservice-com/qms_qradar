import { getBQ } from "./bigquery";
import type { EvaluationSample } from "./types";

// 전화문의 품질평가용 신규 샘플을 BigQuery 뷰에서 조회한다.
// ⚠️ 앱 기본 프로젝트(striped-option-…)와 다른 프로젝트/리전의 뷰라 교차 프로젝트 접근.
//    - 서비스계정에 대상 데이터셋 read 권한 필요(roles/bigquery.dataViewer).
//    - location은 강제하지 않고 BigQuery 자동 감지에 맡긴다(다른 리전이라 asia-northeast3 고정 금지).
//      필요 시 GROWTH_CULTURE_LOCATION으로 명시.
const PROJECT = process.env.GROWTH_CULTURE_PROJECT_ID ?? "data-proj-470202";
const VIEW = process.env.EVAL_CASES_VIEW ?? "ds_growth_culture.vw_qradar_evaluation_cases";
const LOCATION = process.env.GROWTH_CULTURE_LOCATION; // 미설정이면 auto-detect

const SNIPPET_MAX = 200;

export async function listEvaluationSamples(limit = 100): Promise<EvaluationSample[]> {
  const query = `
    select
      json_value(case_content, '$.genesys_conversation_id') as conversation_id,
      json_value(case_content, '$.상담이력 ID')             as phone_inquiry_id,
      json_value(case_content, '$.상담이력')                as phone_inquiry_content,
      cast(year_month as string)                            as year_month
    from \`${PROJECT}.${VIEW}\`
    where year_month >= '2026-04-01'
      and json_value(case_content, '$.genesys_conversation_id') is not null
    order by year_month desc
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
    yearMonth: r.year_month ? String(r.year_month) : "",
  }));
}

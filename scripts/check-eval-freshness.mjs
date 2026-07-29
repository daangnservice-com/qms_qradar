// 콜 분석 샘플 소스 테이블의 적재 현황 점검(읽기 전용 SELECT만).
//
// "특정 날짜 데이터가 앱에서 안 보인다"의 원인을 아래 3가지로 가른다.
//   1) 적재 지연        — 그 날짜 행이 테이블에 아직 없음(DA 파이프라인)
//   2) CID null        — 행은 있는데 genesys_conversation_id 미매핑 → 앱의 is not null 조건에 전멸
//   3) year_month null — 파티션 컬럼 미기입 → 앱의 year_month >= '2026-04-01' 조건에서 NULL로 제외
// 덤으로 call_start의 타임존 표기(UTC/KST)도 원문 샘플로 확인한다.
//
// 실행: node --env-file=.env.local scripts/check-eval-freshness.mjs [조회시작일=2026-07-15]
// ⚠️ 출력에 PII(이름·상담내용)는 포함하지 않는다. 날짜·건수·타임존 표기만 본다.

import { BigQuery } from "@google-cloud/bigquery";

const BILLING_PROJECT = process.env.GOOGLE_CLOUD_PROJECT_ID ?? "striped-option-493506-a7";
const PROJECT = process.env.GROWTH_CULTURE_PROJECT_ID ?? "data-proj-470202";
const TABLE = process.env.EVAL_CASES_TABLE ?? "ds_growth_culture.qradar_evaluation_cases";
const LOCATION = process.env.GROWTH_CULTURE_LOCATION ?? "US";
const FROM = process.argv[2] ?? "2026-07-15";

const [DATASET, TABLE_NAME] = TABLE.split(".");
const CID = "json_value(case_content, '$.genesys_conversation_id')";
const CALL_DATE = "substr(json_value(case_content, '$.call_start'), 1, 10)";

const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const bq = new BigQuery({
  projectId: BILLING_PROJECT,
  ...(saJson ? { credentials: JSON.parse(saJson) } : {}),
});
const run = async (query) => (await bq.query({ query, location: LOCATION }))[0];

const fmt = (v) => (v == null ? "-" : typeof v === "object" && "value" in v ? String(v.value) : String(v));
const table = (rows, cols) => {
  if (!rows.length) return "  (행 없음)";
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => fmt(r[c]).length)));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padEnd(w[i])).join("  ");
  return [line(cols), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(cols.map((c) => fmt(r[c]))))].join("\n");
};

console.log(`\n대상: ${PROJECT}.${TABLE}  (location=${LOCATION}, billing=${BILLING_PROJECT})`);
console.log(`조회 범위: call_start >= ${FROM}\n`);

// ① 테이블 자체가 언제 마지막으로 갱신됐나 → 적재 지연 판정의 기준선.
try {
  const meta = await run(`
    select timestamp_millis(last_modified_time) as last_modified, row_count
    from \`${PROJECT}.${DATASET}.__TABLES__\`
    where table_id = '${TABLE_NAME}'
  `);
  console.log("① 테이블 메타(마지막 갱신 시각 = 적재 시점)");
  console.log(table(meta, ["last_modified", "row_count"]), "\n");
} catch (e) {
  console.log(`① 테이블 메타 조회 실패: ${e.message}\n`);
}

// ② 날짜별 원본 건수 vs 앱 조건 통과 건수. 둘의 차이가 곧 앱에서 사라진 행이다.
const daily = await run(`
  select
    ${CALL_DATE}                                              as call_date,
    count(*)                                                  as rows_raw,
    countif(${CID} is null)                                   as cid_null,
    countif(year_month is null)                               as ym_null,
    countif(${CID} is not null and year_month >= '2026-04-01') as app_visible,
    count(distinct ${CID})                                    as conversations
  from \`${PROJECT}.${TABLE}\`
  where ${CALL_DATE} >= '${FROM}'
  group by call_date
  order by call_date desc
`);
console.log("② 날짜별 적재 현황 (app_visible = 앱 필터를 통과해 실제로 보이는 건수)");
console.log(table(daily, ["call_date", "rows_raw", "cid_null", "ym_null", "app_visible", "conversations"]), "\n");

// ③ call_start 원문 표기 — 타임존 접미사(Z / +09:00 / 없음)로 UTC인지 KST인지 판별.
const raw = await run(`
  select distinct json_value(case_content, '$.call_start') as call_start_raw
  from \`${PROJECT}.${TABLE}\`
  where ${CALL_DATE} >= '${FROM}'
  order by call_start_raw desc
  limit 3
`);
console.log("③ call_start 원문 샘플(타임존 표기 확인용)");
console.log(table(raw, ["call_start_raw"]), "\n");

// ④ year_month 실제 값 분포 — '2026-07' 인지 '2026-07-01' 인지, null이 섞였는지.
const ym = await run(`
  select year_month, count(*) as rows_raw
  from \`${PROJECT}.${TABLE}\`
  where ${CALL_DATE} >= '${FROM}'
  group by year_month
  order by year_month desc
`);
console.log("④ year_month 값 분포");
console.log(table(ym, ["year_month", "rows_raw"]), "\n");

// ⑤ call_start가 null인 행은 ②에서 통째로 빠지므로 별도로 센다.
//    상담이력 생성시각(KST) 기준 최신값이 곧 "파이프라인이 마지막으로 넣은 데이터"다.
const inq = await run(`
  select
    date(inquiry_created_at_kst)          as inquiry_date_kst,
    count(*)                              as rows_raw,
    countif(json_value(case_content, '$.call_start') is null) as call_start_null
  from \`${PROJECT}.${TABLE}\`
  where inquiry_created_at_kst >= datetime '2026-07-15'
  group by inquiry_date_kst
  order by inquiry_date_kst desc
  limit 15
`);
console.log("⑤ 상담이력 생성일(KST) 기준 — call_start null 행까지 포함한 최신 적재");
console.log(table(inq, ["inquiry_date_kst", "rows_raw", "call_start_null"]), "\n");

/**
 * 평가 아이템 키 통일 (dev, 2026-09-21).
 *
 * 전화 `qradar_evaluation_results` + 인앱 `qradar_evaluation_item_results` 를
 * 한 결과 테이블로 합치고, reviews/completions/claims 키를
 * (channel, source_system, source_id) 로 맞춘다.
 *
 * Usage (기본 dry-run, 쓰기는 명시 플래그):
 *   npx tsx scripts/migrate-eval-item-key.ts --target=dev
 *   npx tsx scripts/migrate-eval-item-key.ts --target=dev --apply
 *   npx tsx scripts/migrate-eval-item-key.ts --target=dev --verify
 *   npx tsx scripts/migrate-eval-item-key.ts --target=dev --swap
 *   npx tsx scripts/migrate-eval-item-key.ts --target=dev --rollback
 *
 * 19:00 순서: 앱 쓰기 중단 → --apply → --verify → --swap → 앱 재시작 → 스모크.
 * prod 는 --allow-prod 없이 거부한다.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";
import {
  EVAL_HUMAN_REVIEWS_V2_SCHEMA,
  EVAL_RESULTS_V2_SCHEMA,
  EVAL_REVIEW_CLAIMS_V2_SCHEMA,
  EVAL_REVIEW_COMPLETIONS_V2_SCHEMA,
  type BqField,
} from "../lib/evalSchemaV2";
import { PHONE_SOURCE_SYSTEM } from "../lib/evaluationChannel";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

function argFlag(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

const dryRun = !process.argv.includes("--apply")
  && !process.argv.includes("--verify")
  && !process.argv.includes("--swap")
  && !process.argv.includes("--rollback");
const doApply = process.argv.includes("--apply");
const doVerify = process.argv.includes("--verify") || doApply;
const doSwap = process.argv.includes("--swap");
const doRollback = process.argv.includes("--rollback");
const rebuildV2 = process.argv.includes("--rebuild-v2");
const allowProd = process.argv.includes("--allow-prod");
const targetArg = (argFlag("target") ?? process.env.BQ_TARGET ?? "dev").toLowerCase();
const target = targetArg === "prod" ? "prod" : "dev";
const stamp = argFlag("stamp") ?? "20260921";

process.env.BQ_TARGET = target;
delete process.env.QRADAR_DATASET;

const PHONE_CHANNEL = "phone";

type Names = {
  project: string;
  dataset: string;
  location: string;
  results: string;
  resultsV2: string;
  resultsBak: string;
  resultsLegacy: string;
  resultsFailed: string;
  item: string;
  itemBak: string;
  itemLegacy: string;
  reviews: string;
  reviewsV2: string;
  reviewsBak: string;
  reviewsLegacy: string;
  reviewsFailed: string;
  completions: string;
  completionsV2: string;
  completionsBak: string;
  completionsLegacy: string;
  completionsFailed: string;
  claims: string;
  claimsV2: string;
  claimsBak: string;
  claimsLegacy: string;
  claimsFailed: string;
  criterionResults: string;
};

function namesFor(project: string, dataset: string, location: string): Names {
  return {
    project,
    dataset,
    location,
    results: "qradar_evaluation_results",
    resultsV2: "qradar_evaluation_results_v2",
    resultsBak: `qradar_evaluation_results_bak_${stamp}`,
    resultsLegacy: `qradar_evaluation_results_legacy_${stamp}`,
    resultsFailed: `qradar_evaluation_results_v2_failed_${stamp}`,
    item: "qradar_evaluation_item_results",
    itemBak: `qradar_evaluation_item_results_bak_${stamp}`,
    itemLegacy: `qradar_evaluation_item_results_legacy_${stamp}`,
    reviews: "qradar_eval_human_reviews",
    reviewsV2: "qradar_eval_human_reviews_v2",
    reviewsBak: `qradar_eval_human_reviews_bak_${stamp}`,
    reviewsLegacy: `qradar_eval_human_reviews_legacy_${stamp}`,
    reviewsFailed: `qradar_eval_human_reviews_v2_failed_${stamp}`,
    completions: "qradar_eval_review_completions",
    completionsV2: "qradar_eval_review_completions_v2",
    completionsBak: `qradar_eval_review_completions_bak_${stamp}`,
    completionsLegacy: `qradar_eval_review_completions_legacy_${stamp}`,
    completionsFailed: `qradar_eval_review_completions_v2_failed_${stamp}`,
    claims: "qradar_eval_review_claims",
    claimsV2: "qradar_eval_review_claims_v2",
    claimsBak: `qradar_eval_review_claims_bak_${stamp}`,
    claimsLegacy: `qradar_eval_review_claims_legacy_${stamp}`,
    claimsFailed: `qradar_eval_review_claims_v2_failed_${stamp}`,
    criterionResults: "qradar_evaluation_criterion_results",
  };
}

function fq(n: Names, table: string): string {
  return `\`${n.project}.${n.dataset}.${table}\``;
}

async function tableExists(bq: BigQuery, n: Names, table: string): Promise<boolean> {
  try {
    const [ex] = await bq.dataset(n.dataset, { projectId: n.project }).table(table).exists();
    return Boolean(ex);
  } catch {
    return false;
  }
}

async function fieldNames(bq: BigQuery, n: Names, table: string): Promise<Set<string>> {
  const [meta] = await bq.dataset(n.dataset, { projectId: n.project }).table(table).getMetadata();
  return new Set(
    ((meta as { schema?: { fields?: Array<{ name?: string }> } }).schema?.fields ?? []).map((f) =>
      String(f.name ?? "").toLowerCase(),
    ),
  );
}

async function count(bq: BigQuery, n: Names, query: string): Promise<number> {
  const [rows] = await bq.query({ query, location: n.location });
  return Number((rows as { n?: number }[])[0]?.n ?? 0);
}

function has(fields: Set<string>, name: string): boolean {
  return fields.has(name.toLowerCase());
}

function colOr(fields: Set<string>, name: string, fallbackSql: string): string {
  return has(fields, name) ? name : fallbackSql;
}

async function run(bq: BigQuery, n: Names, query: string, label: string): Promise<void> {
  console.log(`[eval-item-key] SQL ${label}`);
  if (dryRun) {
    console.log(query.trim().slice(0, 800) + (query.length > 800 ? "\n…\n" : "\n"));
    return;
  }
  await bq.query({ query, location: n.location });
}

async function copyBackup(bq: BigQuery, n: Names, src: string, bak: string): Promise<void> {
  if (!(await tableExists(bq, n, src))) {
    console.log(`[eval-item-key] skip backup, missing ${src}`);
    return;
  }
  if (await tableExists(bq, n, bak)) {
    console.log(`[eval-item-key] backup exists, skip ${bak}`);
    return;
  }
  await run(
    bq,
    n,
    `create table ${fq(n, bak)} options (expiration_timestamp = null) as select * from ${fq(n, src)}`,
    `backup ${src} → ${bak}`,
  );
}

async function dropIfExists(bq: BigQuery, n: Names, table: string): Promise<void> {
  if (!(await tableExists(bq, n, table))) return;
  await run(bq, n, `drop table ${fq(n, table)}`, `drop ${table}`);
}

function bqType(field: BqField): string {
  if (field.type === "INTEGER") return "INT64";
  if (field.type === "FLOAT") return "FLOAT64";
  if (field.type === "BOOLEAN") return "BOOL";
  return field.type;
}

function createTableDdl(
  n: Names,
  table: string,
  schema: BqField[],
  partitionField: string,
  cluster: string[],
  description: string,
): string {
  const cols = schema
    .map((f) => `  ${f.name} ${bqType(f)}${f.mode === "REQUIRED" ? " not null" : ""}`)
    .join(",\n");
  return `
create table ${fq(n, table)} (
${cols}
)
partition by date(${partitionField})
cluster by ${cluster.join(", ")}
options (description = ${JSON.stringify(description)})
`;
}

function purposeSql(expr: string): string {
  return `case when ${expr} in ('qa_eval', 'train') then 'qa_eval' else 'call_eval' end`;
}

function phoneAttrsSql(fields: Set<string>): string {
  const parts: string[] = [];
  const add = (jsonKey: string, sqlExpr: string) => parts.push(`'${jsonKey}', ${sqlExpr}`);
  if (has(fields, "phone_inquiry_id")) add("phoneInquiryId", "phone_inquiry_id");
  if (has(fields, "duration_sec")) add("durationSec", "duration_sec");
  if (has(fields, "silence_count")) add("silenceCount", "silence_count");
  if (has(fields, "silence_total_sec")) add("silenceTotalSec", "silence_total_sec");
  if (has(fields, "silence_longest_sec")) add("silenceLongestSec", "silence_longest_sec");
  if (has(fields, "silence_ratio")) add("silenceRatio", "silence_ratio");
  if (has(fields, "min_silence_sec")) add("minSilenceSec", "min_silence_sec");
  if (has(fields, "noise_db")) add("noiseDb", "noise_db");
  if (has(fields, "audio_kept")) add("audioKept", "audio_kept");
  if (has(fields, "audio_path")) add("audioPath", "audio_path");
  if (has(fields, "stt_source")) add("sttSource", "stt_source");
  if (has(fields, "high_risk_flags_json")) {
    add("highRiskFlags", "safe.parse_json(ifnull(nullif(high_risk_flags_json, ''), '[]'))");
  }
  if (!parts.length) return "to_json(struct())";
  return `to_json_string(json_strip_nulls(json_object(${parts.join(", ")})))`;
}

async function backfillResults(bq: BigQuery, n: Names): Promise<void> {
  const liveFields = await fieldNames(bq, n, n.results);
  const hasItem = await tableExists(bq, n, n.item);
  const itemFields = hasItem ? await fieldNames(bq, n, n.item) : new Set<string>();

  const transcript = colOr(liveFields, "transcript_json", "'[]'");
  const resultJson = colOr(liveFields, "result_json", "'{}'");
  const purpose = has(liveFields, "purpose") ? "purpose" : "cast(null as string)";

  await run(
    bq,
    n,
    `
    insert into ${fq(n, n.resultsV2)} (
      analysis_id, analyzed_at, channel, source_system, source_id, org, purpose,
      analyzed_by, model, prompt_version_id, prompt_version, ai_label,
      turns_json, input_snapshot_json, channel_attrs_json, result_json, llm_call_id, error
    )
    select
      analysis_id,
      analyzed_at,
      '${PHONE_CHANNEL}',
      '${PHONE_SOURCE_SYSTEM}',
      conversation_id,
      org,
      ${purposeSql(purpose)},
      analyzed_by,
      model,
      ${colOr(liveFields, "prompt_version_id", "cast(null as string)")},
      ${colOr(liveFields, "prompt_version", "cast(null as string)")},
      ${colOr(liveFields, "ai_label", "cast(null as string)")},
      ifnull(nullif(${transcript}, ''), '[]'),
      '{}',
      ${phoneAttrsSql(liveFields)},
      ifnull(nullif(${resultJson}, ''), '{}'),
      ${colOr(liveFields, "llm_call_id", "cast(null as string)")},
      ${colOr(liveFields, "error", "cast(null as string)")}
    from ${fq(n, n.results)}
    where conversation_id is not null and conversation_id != ''
    `,
    "backfill phone results",
  );

  if (!hasItem) {
    console.log("[eval-item-key] no item_results, skip feedback backfill");
    return;
  }
  const itemTurns = has(itemFields, "conversation_json")
    ? `if(ifnull(conversation_json, '') not in ('', '[]'), conversation_json, ifnull(transcript_json, '[]'))`
    : colOr(itemFields, "transcript_json", "'[]'");
  await run(
    bq,
    n,
    `
    insert into ${fq(n, n.resultsV2)} (
      analysis_id, analyzed_at, channel, source_system, source_id, org, purpose,
      analyzed_by, model, prompt_version_id, prompt_version, ai_label,
      turns_json, input_snapshot_json, channel_attrs_json, result_json, llm_call_id, error
    )
    select
      analysis_id,
      analyzed_at,
      channel,
      source_system,
      source_id,
      org,
      ${purposeSql(colOr(itemFields, "purpose", "'call_eval'"))},
      analyzed_by,
      model,
      ${colOr(itemFields, "prompt_version_id", "cast(null as string)")},
      ${colOr(itemFields, "prompt_version", "cast(null as string)")},
      ${colOr(itemFields, "ai_label", "cast(null as string)")},
      ifnull(nullif(${itemTurns}, ''), '[]'),
      ifnull(${colOr(itemFields, "input_snapshot_json", "'{}'")}, '{}'),
      '{}',
      ifnull(nullif(${colOr(itemFields, "result_json", "'{}'")}, ''), '{}'),
      ${colOr(itemFields, "llm_call_id", "cast(null as string)")},
      ${colOr(itemFields, "error", "cast(null as string)")}
    from ${fq(n, n.item)}
    where source_id is not null and source_id != ''
      and analysis_id not in (select analysis_id from ${fq(n, n.resultsV2)})
    `,
    "backfill feedback item_results",
  );
}

async function backfillCriterionFromItems(bq: BigQuery, n: Names): Promise<void> {
  if (!(await tableExists(bq, n, n.item)) || !(await tableExists(bq, n, n.criterionResults))) return;
  await run(
    bq,
    n,
    `
    insert into ${fq(n, n.criterionResults)} (
      analysis_id, eval_set_id, criterion_id, criterion_prompt_id,
      violated, reason, evidence_json, created_at
    )
    select
      r.analysis_id,
      r.prompt_version_id,
      safe_cast(json_value(c, '$.id') as int64),
      cast(null as string),
      safe_cast(json_value(c, '$.violated') as bool),
      json_value(c, '$.reason'),
      to_json_string(json_query(c, '$.evidence')),
      r.analyzed_at
    from ${fq(n, n.item)} r
    left join unnest(json_query_array(safe.parse_json(ifnull(nullif(r.checklist_json, ''), '[]')))) as c
    where safe_cast(json_value(c, '$.id') as int64) is not null
      and not exists (
        select 1 from ${fq(n, n.criterionResults)} e where e.analysis_id = r.analysis_id
      )
    `,
    "backfill criterion_results from item_results",
  );
}

async function backfillReviews(bq: BigQuery, n: Names): Promise<void> {
  if (!(await tableExists(bq, n, n.reviews))) return;
  await run(
    bq,
    n,
    `
    insert into ${fq(n, n.reviewsV2)} (
      annotation_id, channel, source_system, source_id,
      criterion_id, scope, judgment, review_needed, best_category, source,
      at_sec, segment_index, turn_id, comment, quote,
      ai_criterion_id, ai_violated, ai_quote, ai_reason,
      payload_json, updated_at, updated_by, deleted
    )
    select
      annotation_id,
      '${PHONE_CHANNEL}',
      '${PHONE_SOURCE_SYSTEM}',
      conversation_id,
      safe_cast(json_value(payload_json, '$.criterionId') as int64),
      json_value(payload_json, '$.scope'),
      json_value(payload_json, '$.judgment'),
      safe_cast(json_value(payload_json, '$.reviewNeeded') as bool),
      json_value(payload_json, '$.bestCategory'),
      json_value(payload_json, '$.source'),
      safe_cast(json_value(payload_json, '$.atSec') as float64),
      safe_cast(json_value(payload_json, '$.segmentIndex') as int64),
      json_value(payload_json, '$.turnId'),
      json_value(payload_json, '$.comment'),
      json_value(payload_json, '$.quote'),
      safe_cast(json_value(payload_json, '$.aiCriterionId') as int64),
      safe_cast(json_value(payload_json, '$.aiViolated') as bool),
      json_value(payload_json, '$.aiQuote'),
      json_value(payload_json, '$.aiReason'),
      payload_json,
      updated_at,
      updated_by,
      ifnull(deleted, false)
    from ${fq(n, n.reviews)}
    where conversation_id is not null and conversation_id != ''
    `,
    "backfill reviews",
  );
}

async function backfillCompletions(bq: BigQuery, n: Names): Promise<void> {
  if (!(await tableExists(bq, n, n.completions))) return;
  await run(
    bq,
    n,
    `
    insert into ${fq(n, n.completionsV2)} (
      channel, source_system, source_id, completed_at, completed_by, analysis_id, org
    )
    select
      '${PHONE_CHANNEL}', '${PHONE_SOURCE_SYSTEM}', conversation_id,
      completed_at, completed_by, analysis_id, org
    from ${fq(n, n.completions)}
    where conversation_id is not null and conversation_id != ''
    `,
    "backfill completions",
  );

  if (!(await tableExists(bq, n, n.results))) return;
  const liveFields = await fieldNames(bq, n, n.results);
  if (!has(liveFields, "review_completed_at")) return;
  await run(
    bq,
    n,
    `
    insert into ${fq(n, n.completionsV2)} (
      channel, source_system, source_id, completed_at, completed_by, analysis_id, org
    )
    select
      '${PHONE_CHANNEL}', '${PHONE_SOURCE_SYSTEM}', conversation_id,
      review_completed_at,
      ifnull(review_completed_by, 'legacy-review-complete'),
      analysis_id,
      org
    from ${fq(n, n.results)}
    where review_completed_at is not null
      and conversation_id is not null and conversation_id != ''
      and not exists (
        select 1 from ${fq(n, n.completionsV2)} c
        where c.channel = '${PHONE_CHANNEL}'
          and c.source_system = '${PHONE_SOURCE_SYSTEM}'
          and c.source_id = conversation_id
      )
    qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
    `,
    "backfill legacy review_completed_at → completions",
  );
}

async function backfillClaims(bq: BigQuery, n: Names): Promise<void> {
  if (!(await tableExists(bq, n, n.claims))) return;
  await run(
    bq,
    n,
    `
    insert into ${fq(n, n.claimsV2)} (
      channel, source_system, source_id, claimed_by, claimed_at, active
    )
    select
      '${PHONE_CHANNEL}', '${PHONE_SOURCE_SYSTEM}', conversation_id,
      claimed_by, claimed_at, active
    from ${fq(n, n.claims)}
    where conversation_id is not null and conversation_id != ''
    `,
    "backfill claims",
  );
}

type Check = { name: string; ok: boolean; detail: string };

async function verify(bq: BigQuery, n: Names, usingV2Names: boolean): Promise<Check[]> {
  if (!(await tableExists(bq, n, n.resultsBak))) {
    throw new Error("결과 백업 테이블이 없습니다. 먼저 --apply 하세요.");
  }
  const v2StillAside = await tableExists(bq, n, n.resultsV2);
  const resultsT = usingV2Names && v2StillAside ? n.resultsV2 : n.results;
  const reviewsT = usingV2Names && v2StillAside ? n.reviewsV2 : n.reviews;
  const completionsT = usingV2Names && v2StillAside ? n.completionsV2 : n.completions;
  const claimsT = usingV2Names && v2StillAside ? n.claimsV2 : n.claims;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const srcPhone = await count(
    bq,
    n,
    `select count(*) as n from ${fq(n, n.resultsBak)}
     where conversation_id is not null and conversation_id != ''`,
  );
  const v2Phone = await count(
    bq,
    n,
    `select count(*) as n from ${fq(n, resultsT)} where channel = 'phone'`,
  );
  add("phone_result_rows", v2Phone === srcPhone, `src=${srcPhone} v2_phone=${v2Phone}`);

  if (await tableExists(bq, n, n.itemBak)) {
    const srcItem = await count(
      bq,
      n,
      `select count(*) as n from ${fq(n, n.itemBak)}
       where source_id is not null and source_id != ''`,
    );
    const v2Fb = await count(
      bq,
      n,
      `select count(*) as n from ${fq(n, resultsT)} where channel = 'feedback'`,
    );
    add("feedback_result_rows", v2Fb === srcItem, `src_item=${srcItem} v2_feedback=${v2Fb}`);
  }

  const dup = await count(
    bq,
    n,
    `select count(*) as n from (
       select analysis_id from ${fq(n, resultsT)} group by analysis_id having count(*) > 1
     )`,
  );
  add("unique_analysis_id", dup === 0, `dup_analysis_id=${dup}`);

  const emptyId = await count(
    bq,
    n,
    `select count(*) as n from ${fq(n, resultsT)} where source_id is null or source_id = ''`,
  );
  add("nonempty_source_id", emptyId === 0, `empty=${emptyId}`);

  const badPurpose = await count(
    bq,
    n,
    `select count(*) as n from ${fq(n, resultsT)} where purpose not in ('call_eval', 'qa_eval')`,
  );
  add("purpose_normalized", badPurpose === 0, `other_purpose=${badPurpose}`);

  const fields = await fieldNames(bq, n, resultsT);
  add(
    "results_schema",
    fields.has("source_id") && !fields.has("conversation_id") && !fields.has("review_completed_at"),
    `source_id=${fields.has("source_id")} conversation_id=${fields.has("conversation_id")} review_completed_at=${fields.has("review_completed_at")}`,
  );

  if (await tableExists(bq, n, n.reviewsBak)) {
    const src = await count(bq, n, `select count(*) as n from ${fq(n, n.reviewsBak)}`);
    const dest = await count(bq, n, `select count(*) as n from ${fq(n, reviewsT)}`);
    add("review_rows", src === dest, `src=${src} dest=${dest}`);
  }
  if (await tableExists(bq, n, n.completionsBak)) {
    const src = await count(bq, n, `select count(*) as n from ${fq(n, n.completionsBak)}`);
    const dest = await count(bq, n, `select count(*) as n from ${fq(n, completionsT)}`);
    add("completion_rows_min", dest >= src, `src=${src} dest=${dest} (dest may include legacy review_completed_at)`);
  }
  if (await tableExists(bq, n, n.claimsBak)) {
    const src = await count(bq, n, `select count(*) as n from ${fq(n, n.claimsBak)}`);
    const dest = await count(bq, n, `select count(*) as n from ${fq(n, claimsT)}`);
    add("claim_rows", src === dest, `src=${src} dest=${dest}`);
  }

  const labelMismatch = await count(
    bq,
    n,
    `
    select count(*) as n
    from ${fq(n, n.resultsBak)} src
    join ${fq(n, resultsT)} dst
      on dst.analysis_id = src.analysis_id
    where ifnull(src.ai_label, '') != ifnull(dst.ai_label, '')
    `,
  ).catch(() => -1);
  add(
    "ai_label_match",
    labelMismatch === 0,
    labelMismatch < 0 ? "skipped (no ai_label on bak?)" : `mismatch=${labelMismatch}`,
  );

  return checks;
}

async function createV2Tables(bq: BigQuery, n: Names): Promise<void> {
  const specs: Array<{ table: string; schema: BqField[]; partition: string; cluster: string[]; desc: string }> = [
    {
      table: n.resultsV2,
      schema: EVAL_RESULTS_V2_SCHEMA,
      partition: "analyzed_at",
      cluster: ["channel", "source_id", "purpose"],
      desc: "채널 공통 AI 평가 실행. 수기 라벨/검수완료는 저장하지 않음.",
    },
    {
      table: n.reviewsV2,
      schema: EVAL_HUMAN_REVIEWS_V2_SCHEMA,
      partition: "updated_at",
      cluster: ["channel", "source_id"],
      desc: "수기 주석 append-only.",
    },
    {
      table: n.completionsV2,
      schema: EVAL_REVIEW_COMPLETIONS_V2_SCHEMA,
      partition: "completed_at",
      cluster: ["channel", "source_id"],
      desc: "수기 검수 완료 이벤트.",
    },
    {
      table: n.claimsV2,
      schema: EVAL_REVIEW_CLAIMS_V2_SCHEMA,
      partition: "claimed_at",
      cluster: ["channel", "source_id"],
      desc: "검수 찜 이벤트.",
    },
  ];
  for (const spec of specs) {
    if (await tableExists(bq, n, spec.table)) {
      if (rebuildV2) await dropIfExists(bq, n, spec.table);
      else {
        console.log(`[eval-item-key] ${spec.table} exists (use --rebuild-v2 to recreate)`);
        continue;
      }
    }
    await run(
      bq,
      n,
      createTableDdl(n, spec.table, spec.schema, spec.partition, spec.cluster, spec.desc),
      `create ${spec.table}`,
    );
  }
}

async function rename(bq: BigQuery, n: Names, from: string, to: string): Promise<void> {
  if (!(await tableExists(bq, n, from))) throw new Error(`rename source missing: ${from}`);
  if (await tableExists(bq, n, to)) throw new Error(`rename dest exists: ${to}`);
  await run(bq, n, `alter table ${fq(n, from)} rename to ${to}`, `rename ${from} → ${to}`);
}

function viewSql(n: Names): string {
  const file = readFileSync(resolve(process.cwd(), "scripts/bq/eval_item_key_v2_views.sql"), "utf8");
  return file.replaceAll("{{project}}", n.project).replaceAll("{{dataset}}", n.dataset);
}

async function applyViews(bq: BigQuery, n: Names): Promise<void> {
  const sql = viewSql(n);
  const stmts = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));
  for (const stmt of stmts) {
    await run(bq, n, stmt, "view");
  }
}

async function dropViews(bq: BigQuery, n: Names): Promise<void> {
  for (const v of [
    "vw_qradar_eval_latest_run",
    "vw_qradar_eval_latest_annotations",
    "vw_qradar_eval_item_status",
  ]) {
    await run(bq, n, `drop view if exists ${fq(n, v)}`, `drop view ${v}`);
  }
}

async function printPlan(bq: BigQuery, n: Names): Promise<void> {
  const rows: Array<[string, string]> = [];
  for (const t of [n.results, n.item, n.reviews, n.completions, n.claims]) {
    const exists = await tableExists(bq, n, t);
    const c = exists ? await count(bq, n, `select count(*) as n from ${fq(n, t)}`) : -1;
    rows.push([t, exists ? String(c) : "MISSING"]);
  }
  console.log("[eval-item-key] current counts");
  for (const [t, c] of rows) console.log(`  ${t}\t${c}`);
}

async function main() {
  if (target === "prod" && (doApply || doSwap || doRollback) && !allowProd) {
    throw new Error("prod 쓰기는 --allow-prod 가 필요합니다. 이 컷오버는 dev 전용입니다.");
  }
  const { gcpAdcPreferredAuth } = await import("../lib/gcpCredentials");
  const { growthBq, bqRefsSummary } = await import("../lib/bqRefs");
  const bq = new BigQuery({
    projectId: growthBq.projectId,
    location: growthBq.location,
    ...gcpAdcPreferredAuth(),
  });
  const n = namesFor(growthBq.projectId, growthBq.dataset, growthBq.location ?? "US");
  console.log(`[eval-item-key] target=${target} project=${n.project} dataset=${n.dataset} location=${n.location} stamp=${stamp}`);
  console.log(`[eval-item-key] flags dryRun=${dryRun} apply=${doApply} verify=${doVerify} swap=${doSwap} rollback=${doRollback}`);
  console.log(`[eval-item-key] ${bqRefsSummary()}`);

  if (doRollback) {
    await dropViews(bq, n);
    const pairs: Array<[string, string, string]> = [
      [n.results, n.resultsFailed, n.resultsLegacy],
      [n.reviews, n.reviewsFailed, n.reviewsLegacy],
      [n.completions, n.completionsFailed, n.completionsLegacy],
      [n.claims, n.claimsFailed, n.claimsLegacy],
    ];
    for (const [live, failed, legacy] of pairs) {
      if (await tableExists(bq, n, live)) await rename(bq, n, live, failed);
      if (await tableExists(bq, n, legacy)) await rename(bq, n, legacy, live);
    }
    if (await tableExists(bq, n, n.itemLegacy) && !(await tableExists(bq, n, n.item))) {
      await rename(bq, n, n.itemLegacy, n.item);
    }
    console.log("[eval-item-key] rollback done. restart the app (v1 schema).");
    return;
  }

  await printPlan(bq, n);

  if (doApply) {
    await copyBackup(bq, n, n.results, n.resultsBak);
    await copyBackup(bq, n, n.item, n.itemBak);
    await copyBackup(bq, n, n.reviews, n.reviewsBak);
    await copyBackup(bq, n, n.completions, n.completionsBak);
    await copyBackup(bq, n, n.claims, n.claimsBak);
    await createV2Tables(bq, n);
    const v2Count = await tableExists(bq, n, n.resultsV2)
      ? await count(bq, n, `select count(*) as n from ${fq(n, n.resultsV2)}`)
      : 0;
    if (v2Count > 0 && !rebuildV2) {
      console.log(`[eval-item-key] ${n.resultsV2} already has ${v2Count} rows; skip backfill (use --rebuild-v2)`);
    } else {
      await backfillResults(bq, n);
      await backfillCriterionFromItems(bq, n);
      await backfillReviews(bq, n);
      await backfillCompletions(bq, n);
      await backfillClaims(bq, n);
    }
  }

  if (doVerify) {
    const usingV2 = await tableExists(bq, n, n.resultsV2);
    if (!usingV2) throw new Error("v2 결과 테이블이 없습니다. 먼저 --apply 하세요.");
    const checks = await verify(bq, n, true);
    let failed = 0;
    for (const c of checks) {
      console.log(`[eval-item-key] check ${c.ok ? "OK" : "FAIL"} ${c.name} ${c.detail}`);
      if (!c.ok) failed += 1;
    }
    if (failed) throw new Error(`verify failed (${failed} checks). --swap 하지 마세요.`);
    console.log("[eval-item-key] verify passed");
  }

  if (doSwap) {
    const liveFields = await fieldNames(bq, n, n.results);
    if (liveFields.has("source_id") && !liveFields.has("conversation_id")) {
      throw new Error("라이브 결과 테이블이 이미 v2 입니다. swap 중단.");
    }
    const checks = await verify(bq, n, true);
    if (checks.some((c) => !c.ok)) throw new Error("verify 실패. swap 거부.");
    await rename(bq, n, n.results, n.resultsLegacy);
    await rename(bq, n, n.resultsV2, n.results);
    await rename(bq, n, n.reviews, n.reviewsLegacy);
    await rename(bq, n, n.reviewsV2, n.reviews);
    await rename(bq, n, n.completions, n.completionsLegacy);
    await rename(bq, n, n.completionsV2, n.completions);
    await rename(bq, n, n.claims, n.claimsLegacy);
    await rename(bq, n, n.claimsV2, n.claims);
    if (await tableExists(bq, n, n.item)) await rename(bq, n, n.item, n.itemLegacy);
    await applyViews(bq, n);
    console.log("[eval-item-key] swap done. restart Next.js so schema auto-detect picks v2.");
  }

  if (dryRun) {
    console.log("[eval-item-key] dry-run only. 19:00: --apply then --verify then --swap.");
  }
}

main().catch((e) => {
  console.error("[eval-item-key] blocked:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

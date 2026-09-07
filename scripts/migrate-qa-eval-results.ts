/**
 * 레거시 `qradar_qa_eval_results` → 통합 `qradar_evaluation_results` (purpose=qa_eval) 물리 복사.
 *
 * Usage:
 *   npx tsx scripts/migrate-qa-eval-results.ts --target=dev --dry-run
 *   npx tsx scripts/migrate-qa-eval-results.ts --target=dev
 *   npx tsx scripts/migrate-qa-eval-results.ts --target=prod
 *
 * 이미 dest에 같은 analysis_id(=qa_run_id)가 있으면 skip (idempotent).
 * 소스 후보: 동일 qradar 데이터셋 → ds_growth_culture → helpdesk_x
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";

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

const dryRun = process.argv.includes("--dry-run");
const targetArg = (argFlag("target") ?? process.env.BQ_TARGET ?? "dev").toLowerCase();
const target = targetArg === "prod" ? "prod" : "dev";
const locationOverride = argFlag("location");

process.env.BQ_TARGET = target;
delete process.env.QRADAR_DATASET;

const SRC_TABLE = "qradar_qa_eval_results";
const SRC_TABLE_BARE = "qa_eval_results";

async function tableExists(
  bq: BigQuery,
  projectId: string,
  dataset: string,
  table: string,
): Promise<boolean> {
  try {
    const [ex] = await bq.dataset(dataset, { projectId }).table(table).exists();
    return Boolean(ex);
  } catch {
    return false;
  }
}

async function countQuery(bq: BigQuery, query: string, location: string): Promise<number> {
  const [rows] = await bq.query({ query, location });
  return Number((rows as { n?: number }[])[0]?.n ?? 0);
}

async function main() {
  const { gcpClientAuth } = await import("../lib/gcpCredentials");
  const { growthBq, bqRefsSummary } = await import("../lib/bqRefs");
  const { ensureEvalResultsTable } = await import("../lib/evalResultStore");

  const projectId = growthBq.projectId;
  const destDataset = growthBq.dataset;
  const location =
    locationOverride?.trim() ||
    process.env.QRADAR_LOCATION?.trim() ||
    process.env.BIGQUERY_LOCATION?.trim() ||
    process.env.GROWTH_CULTURE_LOCATION?.trim() ||
    "US";
  const destTable = growthBq.resultsTable;
  const destFq = `${projectId}.${destDataset}.${destTable}`;

  const sourceCandidates: Array<{ dataset: string; table: string }> = [
    { dataset: destDataset, table: SRC_TABLE },
    { dataset: destDataset, table: SRC_TABLE_BARE },
    { dataset: "ds_growth_culture", table: SRC_TABLE },
    { dataset: "ds_growth_culture", table: SRC_TABLE_BARE },
    { dataset: "helpdesk_x", table: SRC_TABLE },
    { dataset: "helpdesk_x", table: SRC_TABLE_BARE },
  ];

  console.log("[migrate-qa] === qa_eval_results → evaluation_results ===");
  console.log(`[migrate-qa] target=${target} dryRun=${dryRun}`);
  console.log(`[migrate-qa] dest=${destFq} location=${location}`);
  console.log(`[migrate-qa] ${bqRefsSummary()}`);

  const bq = new BigQuery({ projectId, ...gcpClientAuth() });

  let srcFq: string | null = null;
  for (const c of sourceCandidates) {
    if (await tableExists(bq, projectId, c.dataset, c.table)) {
      srcFq = `${projectId}.${c.dataset}.${c.table}`;
      console.log(`[migrate-qa] source found: ${srcFq}`);
      break;
    }
  }
  if (!srcFq) {
    console.error("[migrate-qa] source table not found in candidates");
    process.exit(1);
  }

  if (!(await tableExists(bq, projectId, destDataset, destTable))) {
    console.log(`[migrate-qa] dest missing — ensureEvalResultsTable()`);
    if (!dryRun) await ensureEvalResultsTable();
  } else if (!dryRun) {
    await ensureEvalResultsTable(); // add missing columns
  }

  const srcTotal = await countQuery(bq, `select count(*) as n from \`${srcFq}\``, location);
  const already = await countQuery(
    bq,
    `
    select count(*) as n
    from \`${srcFq}\` s
    where exists (
      select 1 from \`${destFq}\` d where d.analysis_id = s.qa_run_id
    )
  `,
    location,
  );
  const pending = await countQuery(
    bq,
    `
    select count(*) as n
    from \`${srcFq}\` s
    where not exists (
      select 1 from \`${destFq}\` d where d.analysis_id = s.qa_run_id
    )
  `,
    location,
  );

  console.log(`[migrate-qa] source rows=${srcTotal} already=${already} pending=${pending}`);

  if (pending === 0) {
    console.log("[migrate-qa] nothing to do");
    return;
  }
  if (dryRun) {
    console.log("[migrate-qa] dry-run only — insert skipped");
    return;
  }

  const [job] = await bq.createQueryJob({
    query: `
      insert into \`${destFq}\` (
        analysis_id, analyzed_at, conversation_id, phone_inquiry_id,
        org, purpose, analyzed_by,
        model, prompt_version_id, prompt_version,
        human_result, ai_label, match, checklist_json,
        transcript_json, result_json,
        llm_call_id, audio_kept, audio_path, error,
        review_completed_at, review_completed_by
      )
      select
        s.qa_run_id,
        s.analyzed_at,
        s.conversation_id,
        s.phone_inquiry_id,
        'growth',
        'qa_eval',
        s.analyzed_by,
        s.model,
        s.prompt_version_id,
        cast(null as string),
        s.human_result,
        s.ai_label,
        s.match,
        s.checklist_json,
        s.transcript_json,
        s.result_json,
        s.llm_call_id,
        s.audio_kept,
        s.audio_path,
        s.error,
        cast(null as timestamp),
        cast(null as string)
      from \`${srcFq}\` s
      where not exists (
        select 1 from \`${destFq}\` d where d.analysis_id = s.qa_run_id
      )
    `,
    location,
  });
  await job.getQueryResults();

  const afterQa = await countQuery(
    bq,
    `select count(*) as n from \`${destFq}\` where purpose = 'qa_eval'`,
    location,
  );
  console.log(`[migrate-qa] done. dest purpose=qa_eval rows=${afterQa}`);
}

main().catch((e) => {
  console.error("[migrate-qa] failed", e);
  process.exit(1);
});

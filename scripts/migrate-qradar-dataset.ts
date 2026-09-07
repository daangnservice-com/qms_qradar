/**
 * 레거시 `_dev` 접미 / 분산 데이터셋 → `ds_qradar_{dev|prod}` + `qradar_*` 테이블로 복사.
 *
 * Usage:
 *   npx tsx scripts/migrate-qradar-dataset.ts --target=dev
 *   npx tsx scripts/migrate-qradar-dataset.ts --target=dev --dry-run
 *   npx tsx scripts/migrate-qradar-dataset.ts --target=prod
 *
 * 소스 후보 우선순위 (테이블마다, dest=dev 기준):
 *   1) {src}.{base}_dev / {src}.qradar_{base}_dev
 *   2) {src}.{base} / {src}.qradar_{base}
 *   src 데이터셋: MIGRATE_SOURCE_DATASET → ds_growth_culture → helpdesk_x
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
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
const force = process.argv.includes("--force");
const targetArg = (argFlag("target") ?? process.env.BQ_TARGET ?? "dev").toLowerCase();
const target = targetArg === "prod" ? "prod" : "dev";

process.env.BQ_TARGET = target;
delete process.env.QRADAR_DATASET;

async function tableExists(bq: BigQuery, projectId: string, dataset: string, table: string): Promise<boolean> {
  try {
    const [ex] = await bq.dataset(dataset, { projectId }).table(table).exists();
    return Boolean(ex);
  } catch {
    return false;
  }
}

async function countRows(bq: BigQuery, fq: string, location: string): Promise<number> {
  try {
    const [rows] = await bq.query({
      query: `select count(*) as n from \`${fq}\``,
      location,
    });
    return Number((rows as { n: unknown }[])[0]?.n ?? 0);
  } catch {
    return -1;
  }
}

async function main() {
  const { gcpClientAuth } = await import("../lib/gcpCredentials");
  const { QRADAR_WRITABLE_TABLES, bqRefsSummary } = await import("../lib/bqRefs");

  const projectId =
    process.env.GROWTH_CULTURE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() ||
    "data-proj-470202";
  const destDataset = target === "dev" ? "ds_qradar_dev" : "ds_qradar_prod";
  const location =
    process.env.QRADAR_LOCATION?.trim() ||
    process.env.BIGQUERY_LOCATION?.trim() ||
    process.env.GROWTH_CULTURE_LOCATION?.trim() ||
    "US";

  const sourceDatasets = [
    process.env.MIGRATE_SOURCE_DATASET?.trim(),
    "ds_growth_culture",
    "helpdesk_x",
  ].filter(Boolean) as string[];

  const jobs = Object.entries(QRADAR_WRITABLE_TABLES).map(([key, destTable]) => {
    const bare = destTable.replace(/^qradar_/, "");
    const withPrefix = destTable;
    const candidates =
      target === "dev"
        ? [`${bare}_dev`, `${withPrefix}_dev`, bare, withPrefix]
        : [bare, withPrefix, `${bare}_dev`, `${withPrefix}_dev`];
    return { key, destTable, candidates: [...new Set(candidates)] };
  });

  console.log("=== migrate-qradar-dataset ===");
  console.log(`target=${target} dryRun=${dryRun} force=${force}`);
  console.log(`dest=${projectId}.${destDataset} location=${location}`);
  console.log(`sources=${sourceDatasets.join(", ")}`);
  console.log(bqRefsSummary());
  console.log("");

  const bq = new BigQuery({ projectId, ...gcpClientAuth() });

  const ds = bq.dataset(destDataset, { projectId });
  const [dsExists] = await ds.exists();
  if (!dsExists) {
    console.log(`[dataset] create ${projectId}.${destDataset} (${location})`);
    if (!dryRun) {
      await ds.create({ location }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/already exists/i.test(msg)) throw e;
      });
    }
  } else {
    console.log(`[dataset] exists ${projectId}.${destDataset}`);
  }

  let copied = 0;
  let skipped = 0;
  let missing = 0;

  for (const job of jobs) {
    const destFq = `${projectId}.${destDataset}.${job.destTable}`;
    const destExists = await tableExists(bq, projectId, destDataset, job.destTable);

    let source: { dataset: string; table: string; fq: string } | null = null;
    for (const srcDs of sourceDatasets) {
      for (const name of job.candidates) {
        const fq = `${projectId}.${srcDs}.${name}`;
        if (fq === destFq) continue;
        if (await tableExists(bq, projectId, srcDs, name)) {
          source = { dataset: srcDs, table: name, fq };
          break;
        }
      }
      if (source) break;
    }

    if (!source) {
      console.log(`[miss] ${job.key} → ${destFq} (소스 없음 — 앱 첫 사용 시 자동 생성)`);
      missing += 1;
      continue;
    }

    if (destExists && !force) {
      const sn = await countRows(bq, source.fq, location);
      const dn = await countRows(bq, destFq, location);
      console.log(`[skip] ${job.key}: dest 존재 (dst=${dn}, src=${sn}). source=${source.fq}`);
      skipped += 1;
      continue;
    }

    console.log(`[copy] ${source.fq} → ${destFq}${force && destExists ? " (force overwrite)" : ""}`);
    if (dryRun) {
      copied += 1;
      continue;
    }

    if (destExists && force) {
      await bq.query({
        query: `drop table if exists \`${destFq}\``,
        location,
      });
    }

    // 쿼리 기반 복사 — COPY 잡은 streaming buffer 행을 빠뜨림
    await bq.query({
      query: `create table \`${destFq}\` as select * from \`${source.fq}\``,
      location,
    });

    const n = await countRows(bq, destFq, location);
    console.log(`       ok · ${n} rows`);
    copied += 1;
  }

  console.log("");
  console.log(`done. copied=${copied} skipped=${skipped} missing=${missing}`);
  if (dryRun) console.log("(dry-run — 실제 쓰기는 없었습니다)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

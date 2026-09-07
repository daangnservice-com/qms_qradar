/**
 * dest vs source 행 수 비교 후, 부족한 테이블만 CTAS로 재생성.
 * (BQ COPY 잡은 streaming buffer 행을 빠뜨리는 문제 보정)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
process.env.BQ_TARGET = "dev";
delete process.env.QRADAR_DATASET;

async function count(bq: BigQuery, fq: string): Promise<number> {
  const [rows] = await bq.query({
    query: `select count(*) as n from \`${fq}\``,
    location: "US",
  });
  return Number((rows as { n: number }[])[0]?.n ?? 0);
}

async function tableExists(bq: BigQuery, projectId: string, dataset: string, table: string) {
  try {
    const [ex] = await bq.dataset(dataset, { projectId }).table(table).exists();
    return Boolean(ex);
  } catch {
    return false;
  }
}

async function main() {
  const { gcpClientAuth } = await import("../lib/gcpCredentials");
  const { QRADAR_WRITABLE_TABLES } = await import("../lib/bqRefs");
  const projectId = "data-proj-470202";
  const destDataset = "ds_qradar_dev";
  const sources = ["ds_growth_culture", "helpdesk_x"];
  const location = "US";
  const bq = new BigQuery({ projectId, ...gcpClientAuth() });

  let fixed = 0;
  let ok = 0;

  for (const [key, destTable] of Object.entries(QRADAR_WRITABLE_TABLES)) {
    const destFq = `${projectId}.${destDataset}.${destTable}`;
    const bare = destTable.replace(/^qradar_/, "");
    const candidates = [`${bare}_dev`, `${destTable}_dev`, bare, destTable];

    let sourceFq: string | null = null;
    for (const srcDs of sources) {
      for (const name of candidates) {
        const fq = `${projectId}.${srcDs}.${name}`;
        if (fq === destFq) continue;
        if (await tableExists(bq, projectId, srcDs, name)) {
          sourceFq = fq;
          break;
        }
      }
      if (sourceFq) break;
    }
    if (!sourceFq) {
      console.log(`[miss] ${key}`);
      continue;
    }

    const sn = await count(bq, sourceFq);
    const dn = await count(bq, destFq);
    if (sn === dn) {
      console.log(`[ok] ${key}: ${dn} rows`);
      ok += 1;
      continue;
    }

    console.log(`[fix] ${key}: dest=${dn} src=${sn} ← ${sourceFq}`);
    await bq.query({ query: `drop table if exists \`${destFq}\``, location });
    await bq.query({ query: `create table \`${destFq}\` as select * from \`${sourceFq}\``, location });
    const after = await count(bq, destFq);
    console.log(`       → ${after} rows`);
    fixed += 1;
  }

  console.log(`done. ok=${ok} fixed=${fixed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Verify dist tables row counts after Sheets→BQ migrate.
 * Usage: npx tsx scripts/verify-dist-bq.ts --target=dev
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile(resolve(".env.local"));
const target = (process.argv.find((a) => a.startsWith("--target="))?.slice(9) ||
  process.env.BQ_TARGET ||
  "dev") as string;
process.env.BQ_TARGET = target === "prod" ? "prod" : "dev";
delete process.env.QRADAR_DATASET;

async function main() {
  const { getBQ } = await import("../lib/bigquery");
  const { distBq } = await import("../lib/bqRefs");
  const bq = getBQ();
  console.log(`verify ${distBq.dataset}`);
  for (const [key, table] of Object.entries(distBq.tables)) {
    try {
      const [rows] = await bq.query({
        query: `SELECT count(*) AS n FROM ${distBq.sql(table)}`,
        location: distBq.location || "US",
      });
      console.log(`${key}\t${table}\t${(rows as { n: unknown }[])[0]?.n}`);
    } catch (e) {
      console.log(`${key}\t${table}\tERR\t${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

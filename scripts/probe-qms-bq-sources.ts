/**
 * Probe dashboard source view + list qradar datasets.
 * Usage: npx tsx scripts/probe-qms-bq-sources.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

async function main() {
  const { getBQ } = await import("../lib/bigquery");
  const { bqRefsSummary, BQ_TARGET } = await import("../lib/bqRefs");
  console.log(bqRefsSummary());
  console.log("BQ_TARGET=", BQ_TARGET);

  const bq = getBQ();
  const view = "data-proj-470202.ds_growth_culture.vw_quality_evaluation_cases_detail_with_fallback";

  const [cols] = await bq.query({
    query: `
      SELECT column_name, data_type
      FROM \`data-proj-470202.ds_growth_culture.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'vw_quality_evaluation_cases_detail_with_fallback'
      ORDER BY ordinal_position
    `,
    location: "US",
  });
  console.log("\n=== view columns ===");
  for (const r of cols as { column_name: string; data_type: string }[]) {
    console.log(`${r.column_name}\t${r.data_type}`);
  }

  const [cnt] = await bq.query({
    query: `SELECT count(*) AS n FROM \`${view}\``,
    location: "US",
  });
  console.log("\nrow_count=", (cnt as { n: unknown }[])[0]?.n);

  const [sample] = await bq.query({
    query: `SELECT * FROM \`${view}\` LIMIT 1`,
    location: "US",
  });
  console.log("\n=== sample keys ===");
  console.log(Object.keys((sample as object[])[0] ?? {}));

  for (const ds of ["ds_qradar_dev", "ds_qradar_prod"]) {
    const [tables] = await bq.query({
      query: `
        SELECT table_name, table_type
        FROM \`data-proj-470202.${ds}.INFORMATION_SCHEMA.TABLES\`
        WHERE STARTS_WITH(table_name, 'qradar_')
        ORDER BY table_name
      `,
      location: "US",
    });
    console.log(`\n=== ${ds} qradar_* (${(tables as unknown[]).length}) ===`);
    for (const t of tables as { table_name: string; table_type: string }[]) {
      console.log(`${t.table_name}\t${t.table_type}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

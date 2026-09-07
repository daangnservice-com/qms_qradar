import type { Table } from "@google-cloud/bigquery";
import { getBQ } from "./bigquery";

/**
 * BigQuery table update quota 를 아끼기 위해,
 * ALTER 전에 metadata 로 컬럼 존재 여부를 확인한다.
 * (ADD COLUMN IF NOT EXISTS 도 no-op여도 table update quota 를 소모함)
 */
export async function addColumnsIfMissing(
  table: Table,
  columns: Array<{ name: string; type: string; mode?: string }>,
  opts?: { location?: string; logTag?: string },
): Promise<number> {
  if (!columns.length) return 0;
  let meta: { schema?: { fields?: Array<{ name?: string }> } };
  try {
    [meta] = await table.getMetadata();
  } catch (e) {
    console.warn(`[${opts?.logTag ?? "bqSchema"}] getMetadata failed:`, e instanceof Error ? e.message : e);
    return 0;
  }
  const existing = new Set((meta.schema?.fields ?? []).map((f) => String(f.name ?? "").toLowerCase()));
  const missing = columns.filter((c) => !existing.has(c.name.toLowerCase()));
  if (!missing.length) return 0;

  const fq = `${table.dataset.projectId || table.bigQuery.projectId}.${table.dataset.id}.${table.id}`;
  const loc = opts?.location ? { location: opts.location } : {};
  let added = 0;
  for (const col of missing) {
    const mode = col.mode && col.mode !== "NULLABLE" ? ` ${col.mode}` : "";
    try {
      await getBQ().query({
        query: `alter table \`${fq}\` add column if not exists ${col.name} ${col.type}${mode}`,
        ...loc,
      });
      added += 1;
    } catch (e) {
      console.warn(
        `[${opts?.logTag ?? "bqSchema"}] alter ${col.name}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return added;
}

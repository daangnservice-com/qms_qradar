import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { loadEnvLocal } from "./loadEnvLocal";

loadEnvLocal();

/**
 * db/migrations/*.sql 을 파일명 순으로 적용한다.
 * 사용: npm run serving:migrate
 */

const url = process.env.SERVING_DATABASE_URL?.trim();
if (!url) {
  console.error("SERVING_DATABASE_URL 이 없습니다.");
  process.exit(1);
}

async function main(): Promise<void> {
  const dir = path.join(process.cwd(), "db", "migrations");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
    const applied = new Set(
      (await client.query<{ id: string }>("select id from schema_migrations")).rows.map((r) => r.id),
    );
    for (const name of names) {
      if (applied.has(name)) {
        console.log(`skip ${name}`);
        continue;
      }
      const sql = await readFile(path.join(dir, name), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (id) values ($1)", [name]);
        await client.query("commit");
        console.log(`applied ${name}`);
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

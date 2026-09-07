import { existsSync, readFileSync } from "node:fs";
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(resolve(process.cwd(), ".env.local"));

async function main() {
  const { listSttBatchState } = await import("../lib/sttBatchStore");
  const { resumePendingSttBatchUploads } = await import("../lib/sttBatchRunner");
  const { controlLocalStt } = await import("../lib/localSttClient");
  const state = await listSttBatchState();
  const pendingByRun = new Map<string, number>();
  for (const j of state.jobs) {
    if (j.status !== "pending_upload") continue;
    pendingByRun.set(j.runId, (pendingByRun.get(j.runId) ?? 0) + 1);
  }
  console.log(`[resume] pending runs=${[...pendingByRun.entries()].map(([id, n]) => `${id.slice(0, 8)}:${n}`).join(",") || "none"}`);
  if (!pendingByRun.size) return;
  await controlLocalStt({ pause: false, overrideMinutes: 240 });
  for (const runId of pendingByRun.keys()) {
    console.log(`[resume] uploading ${runId}`);
    await resumePendingSttBatchUploads(runId);
    console.log(`[resume] finished ${runId}`);
  }
  const after = await listSttBatchState();
  const by: Record<string, number> = {};
  for (const j of after.jobs) by[j.status] = (by[j.status] ?? 0) + 1;
  console.log(`[resume] jobStatus=${JSON.stringify(by)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

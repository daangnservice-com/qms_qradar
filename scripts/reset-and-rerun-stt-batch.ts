/**
 * 잘못된 channel_names / prompt 로 넣은 배치를 지우고 같은 콜 날짜로 다시 넣는다.
 * Usage: npx tsx scripts/reset-and-rerun-stt-batch.ts
 */
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
    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { cancelLocalSttJob, controlLocalStt, listLocalSttJobIds } = await import("../lib/localSttClient");
  const { startSttBatchRun } = await import("../lib/sttBatchRunner");
  const {
    deleteSttBatchTranscriptFiles,
    hasActiveRun,
    listSttBatchState,
    wipeSttBatchWork,
  } = await import("../lib/sttBatchStore");

  const before = await listSttBatchState();
  const schedule = before.schedules[0];
  if (!schedule) throw new Error("STT 배치 스케줄이 없습니다");
  const callDates = [...new Set(before.runs.map((r) => r.callDate).filter(Boolean))];
  if (!callDates.length) callDates.push("2026-08-31");

  const remoteIds = new Set<string>();
  for (const j of before.jobs) {
    if (j.remoteJobId) remoteIds.add(j.remoteJobId);
  }
  for (const status of ["queued", "running"] as const) {
    try {
      for (const id of await listLocalSttJobIds(status)) remoteIds.add(id);
    } catch (e) {
      console.warn(`[reset] list ${status}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `[reset] schedule=${schedule.id} jobs=${before.jobs.length} remotes=${remoteIds.size} dates=${callDates.join(",")}`,
  );

  let canceled = 0;
  for (const id of remoteIds) {
    try {
      await cancelLocalSttJob(id);
      canceled += 1;
    } catch (e) {
      console.warn(`[reset] cancel ${id}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`[reset] canceled ${canceled}/${remoteIds.size}`);

  await sleep(20_000);
  const wiped = await wipeSttBatchWork();
  console.log(`[reset] wiped jobs=${wiped.jobs} runs=${wiped.runs} transcripts=${wiped.transcripts}`);
  await sleep(10_000);
  const leftover = await deleteSttBatchTranscriptFiles();
  if (leftover) console.log(`[reset] leftover transcripts removed=${leftover}`);

  const gate = await controlLocalStt({ pause: false, overrideMinutes: 240 });
  console.log(`[reset] override accepting=${gate.acceptingWork} until=${gate.overrideUntil} reason=${gate.reason}`);

  for (const callDate of callDates) {
    console.log(`[reset] starting run callDate=${callDate}`);
    const run = await startSttBatchRun({
      schedule,
      trigger: "manual",
      callDate,
      requestedBy: "reset-and-rerun",
    });
    console.log(`[reset] run ${run.id} selected=${run.selectedCount}`);
    const t0 = Date.now();
    while (Date.now() - t0 < 50 * 60_000) {
      const { runs } = await listSttBatchState();
      if (!hasActiveRun(runs, schedule.id)) break;
      await sleep(4000);
    }
    const { runs } = await listSttBatchState();
    if (hasActiveRun(runs, schedule.id)) throw new Error(`upload still running for ${callDate}`);
    const finished = runs.find((r) => r.id === run.id);
    console.log(
      `[reset] uploaded ${callDate} status=${finished?.status} queued=${finished?.queuedCount} failed=${finished?.failedCount}`,
    );
  }

  const after = await listSttBatchState();
  const by: Record<string, number> = {};
  for (const j of after.jobs) by[j.status] = (by[j.status] ?? 0) + 1;
  console.log(`[reset] done jobStatus=${JSON.stringify(by)} runs=${after.runs.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

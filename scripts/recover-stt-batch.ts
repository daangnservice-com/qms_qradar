/**
 * 로컬 STT에서 이미 끝났는데 qradar에 반영되지 않은 배치 잡을 한 번에 회수한다.
 *  1) 지금 state를 .data/stt-batch/state.backup.<ts>.json 으로 떠 둔다
 *  2) 업로드에 실패했지만 같은 콜(같은 콜 날짜)의 다른 잡이 원격 잡을 가진 경우 그 원격 잡에 붙인다
 *     — 중복 run이 같은 오디오 파일을 두고 부딪혀 난 EBUSY·빈 파일 실패
 *  3) 원격 잡을 가진 미완료 잡(queued·running·failed)을 원격 잡 단위로 전부 조회해 결과를 받는다
 * 멱등이라 여러 번 돌려도 된다. 서버가 떠 있는 채로 돌려도 state는 파일 락으로 보호된다.
 * Usage: npx tsx scripts/recover-stt-batch.ts [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SttBatchJob } from "../lib/sttBatchTypes";

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

const DRY_RUN = process.argv.includes("--dry-run");
const CONCURRENCY = 4;

function countBy(jobs: SttBatchJob[], key: (j: SttBatchJob) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of jobs) out[key(j)] = (out[key(j)] ?? 0) + 1;
  return out;
}

function recentByCallDate(jobs: SttBatchJob[]): Record<string, Record<string, number>> {
  const dates = [...new Set(jobs.map((j) => j.callDate))].sort().slice(-4);
  return Object.fromEntries(
    dates.map((d) => [d, countBy(jobs.filter((j) => j.callDate === d), (j) => j.status)]),
  );
}

async function main() {
  const { listSttBatchState, patchSttBatchJobs } = await import("../lib/sttBatchStore");
  const { harvestSttBatchJobByRemoteId } = await import("../lib/sttBatchRunner");

  const before = await listSttBatchState();
  console.log("before:", countBy(before.jobs, (j) => j.status));
  console.table(recentByCallDate(before.jobs));

  const callKey = (j: SttBatchJob) => `${j.conversationId}|${j.callDate}`;
  const live = new Map<string, string>();
  for (const j of before.jobs) {
    if (j.remoteJobId && (j.status === "queued" || j.status === "running" || j.status === "done")) {
      live.set(callKey(j), j.remoteJobId);
    }
  }
  const relinks = before.jobs
    .filter((j) => j.status === "failed" && !j.remoteJobId && live.has(callKey(j)))
    .map((j) => ({
      id: j.id,
      patch: {
        status: "queued" as const,
        remoteJobId: live.get(callKey(j)) as string,
        error: null,
        finishedAt: null,
      },
    }));
  console.log(`failed uploads relinked to the same call's remote job: ${relinks.length}`);

  if (DRY_RUN) {
    console.log("--dry-run: nothing written");
    return;
  }

  const backup = resolve(process.cwd(), ".data", "stt-batch", `state.backup.${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify(before, null, 2), "utf8");
  console.log(`backup: ${backup}`);

  await patchSttBatchJobs(relinks);

  const { jobs } = await listSttBatchState();
  const remoteIds = [
    ...new Set(
      jobs
        .filter((j) => j.remoteJobId && j.status !== "done" && j.status !== "skipped")
        .map((j) => j.remoteJobId as string),
    ),
  ];
  console.log(`remote jobs to check: ${remoteIds.length}`);

  let next = 0;
  let checked = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < remoteIds.length) {
        const id = remoteIds[next++];
        await harvestSttBatchJobByRemoteId(id);
        checked += 1;
        if (checked % 50 === 0) console.log(`  checked ${checked}/${remoteIds.length}`);
      }
    }),
  );

  const after = await listSttBatchState();
  console.log("after:", countBy(after.jobs, (j) => j.status));
  console.table(recentByCallDate(after.jobs));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

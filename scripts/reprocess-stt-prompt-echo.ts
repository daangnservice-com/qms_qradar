/**
 * initial_prompt 문장이 박힌 로컬 전사를 force=true 로 로컬 STT에 다시 넣는다.
 * 업로드는 이 프로세스가 직접 한다(프롬프트 제거된 localSttJobOptions 사용).
 *
 * Usage: node scripts/run-local-ts.cjs scripts/reprocess-stt-prompt-echo.ts [--dry-run]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolve } from "node:path";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
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

const PROMPT_ECHO = "상담원과 고객의 통화 녹취";
const TRANSCRIPT_DIR = path.join(process.cwd(), ".data", "stt-batch", "transcripts");
const UPLOAD_CONCURRENCY = 2;
const REPROCESS_SCHEDULE_ID = "__prompt_reprocess__";

type TranscriptFile = {
  conversationId?: string;
  durationSec?: number;
  transcript?: { text?: string }[];
};

async function mapPool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function listPromptEchoConversationIds(): { conversationId: string; durationSec: number | null }[] {
  const out: { conversationId: string; durationSec: number | null }[] = [];
  if (!existsSync(TRANSCRIPT_DIR)) return out;
  for (const name of readdirSync(TRANSCRIPT_DIR)) {
    if (!name.endsWith(".json")) continue;
    const stem = name.slice(0, -".json".length).trim();
    if (!stem) continue;
    try {
      const raw = readFileSync(path.join(TRANSCRIPT_DIR, name), "utf8");
      if (!raw.includes(PROMPT_ECHO)) continue;
      const parsed = JSON.parse(raw) as TranscriptFile;
      const cid = (parsed.conversationId ?? stem).trim();
      if (!cid) continue;
      out.push({
        conversationId: cid,
        durationSec: Number(parsed.durationSec) || null,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const tainted = listPromptEchoConversationIds();
  console.log(`[reprocess] prompt-echo transcripts=${tainted.length}`);
  if (!tainted.length) return;

  const { currentDateKst } = await import("../lib/sttBatchKst");
  const { isInFlightSttStatus } = await import("../lib/sttBatchTypes");
  const { createSttBatchRun, finishSttBatchRun, listSttBatchState, patchSttBatchJob } = await import("../lib/sttBatchStore");
  const { enqueueLocalSttJob, getLocalSttHealth, localSttJobOptions } = await import("../lib/localSttClient");
  const { prepareUploadAudio, cleanupPaths } = await import("../lib/qaAudio");

  const options = localSttJobOptions();
  if ("initial_prompt" in options) {
    throw new Error("localSttJobOptions still has initial_prompt — abort");
  }
  console.log(`[reprocess] stt options=${JSON.stringify(options)}`);

  const { jobs: existing } = await listSttBatchState();
  const latestByCid = new Map<string, (typeof existing)[number]>();
  for (const j of existing) {
    const prev = latestByCid.get(j.conversationId);
    if (!prev || j.updatedAt > prev.updatedAt) latestByCid.set(j.conversationId, j);
  }

  const skipInFlight: string[] = [];
  const targets = tainted.filter((t) => {
    const latest = latestByCid.get(t.conversationId);
    if (latest && isInFlightSttStatus(latest.status) && latest.skipReuse) {
      skipInFlight.push(t.conversationId);
      return false;
    }
    return true;
  });
  if (skipInFlight.length) {
    console.log(`[reprocess] skip already in-flight reprocess=${skipInFlight.length}`);
  }
  if (dryRun) {
    console.log(`[reprocess] dry-run would force-upload ${targets.length}`);
    console.log(targets.slice(0, 10).map((t) => t.conversationId).join("\n"));
    if (targets.length > 10) console.log(`... +${targets.length - 10}`);
    return;
  }

  const health = await getLocalSttHealth();
  console.log(
    `[reprocess] stt ok=${health.ok} accepting=${health.acceptingWork} reason=${health.reason ?? ""} queue=${health.queueDepth}`,
  );
  if (!health.ok) throw new Error(`로컬 STT 불가: ${health.error ?? "unknown"}`);

  for (const t of targets) {
    const latest = latestByCid.get(t.conversationId);
    if (latest && isInFlightSttStatus(latest.status)) {
      await patchSttBatchJob(latest.id, {
        status: "skipped",
        error: "프롬프트 에코 재처리로 대체",
        finishedAt: new Date().toISOString(),
      });
    }
  }

  type Uploaded = {
    conversationId: string;
    agentName: string;
    team: string;
    callDate: string;
    durationSec: number | null;
    remoteJobId: string;
  };
  const uploaded: Uploaded[] = [];
  const failed: { conversationId: string; error: string }[] = [];
  const started = Date.now();

  await mapPool(targets, UPLOAD_CONCURRENCY, async (t, idx) => {
    const latest = latestByCid.get(t.conversationId);
    try {
      const audio = await prepareUploadAudio(t.conversationId);
      try {
        const enq = await enqueueLocalSttJob({
          conversationId: t.conversationId,
          audioPath: audio.wavPath,
          priority: 0,
          force: true,
        });
        uploaded.push({
          conversationId: t.conversationId,
          agentName: latest?.agentName || "(미상)",
          team: latest?.team || "",
          callDate: latest?.callDate || currentDateKst(),
          durationSec: t.durationSec ?? latest?.durationSec ?? null,
          remoteJobId: enq.remoteJobId,
        });
      } finally {
        await cleanupPaths(audio.tempPaths);
      }
    } catch (e) {
      failed.push({
        conversationId: t.conversationId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    const done = uploaded.length + failed.length;
    if (done % 10 === 0 || done === targets.length) {
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(
        `[reprocess] ${done}/${targets.length} uploaded=${uploaded.length} failed=${failed.length} ${elapsed}s (last #${idx + 1} ${t.conversationId})`,
      );
    }
  });

  const callDate = currentDateKst();
  const dummySchedule = {
    id: REPROCESS_SCHEDULE_ID,
    name: "prompt-echo reprocess",
    enabled: false,
    hour: 0,
    minute: 0,
    perAgentCount: 0,
    maxTotal: 0,
    callDateOffsetDays: 1,
    minDurationSec: null,
    maxDurationSec: null,
    teams: [] as string[],
    lastRunAt: null,
    lastRunDateKst: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "reprocess-stt-prompt-echo",
  };

  if (uploaded.length) {
    const { run, jobs } = await createSttBatchRun({
      schedule: dummySchedule,
      trigger: "ondemand",
      callDate: "prompt-echo-reprocess",
      executionDateKst: callDate,
      requestedBy: "reprocess-stt-prompt-echo",
      jobs: uploaded.map((u) => ({
        conversationId: u.conversationId,
        agentName: u.agentName,
        team: u.team,
        callDate: u.callDate,
        durationSec: u.durationSec,
        status: "queued" as const,
        remoteJobId: u.remoteJobId,
        error: null,
        progress: null,
        stage: null,
        segmentCount: null,
        priority: 0,
        skipReuse: true,
      })),
    });
    const queuedAt = new Date().toISOString();
    for (const job of jobs) {
      await patchSttBatchJob(job.id, { queuedAt, remoteJobId: job.remoteJobId, status: "queued" });
    }
    await finishSttBatchRun(run.id, { status: "completed" });
    console.log(`[reprocess] tracked run=${run.id} jobs=${jobs.length}`);
  }

  console.log(`[reprocess] done uploaded=${uploaded.length} failed=${failed.length}`);
  for (const f of failed) {
    console.log(`[reprocess] FAIL ${f.conversationId}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { isScheduleDue } from "./sttBatchKst";
import { harvestSttBatchJobs, startSttBatchRun } from "./sttBatchRunner";
import { listSttBatchState } from "./sttBatchStore";

const TICK_MS = 60_000;
let started = false;
let ticking = false;

/** Node API에서 1분마다 due 스케줄을 돌리고, 큐에 넣은 잡을 회수한다. */
export function startSttBatchScheduler(): void {
  if (started) return;
  started = true;
  void tickDueSttBatchSchedules();
  setInterval(() => {
    void tickDueSttBatchSchedules();
  }, TICK_MS);
}

export async function tickDueSttBatchSchedules(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { schedules } = await listSttBatchState();
    for (const schedule of schedules) {
      if (
        !isScheduleDue({
          enabled: schedule.enabled,
          hour: schedule.hour,
          minute: schedule.minute,
          lastRunDateKst: schedule.lastRunDateKst,
        })
      ) {
        continue;
      }
      try {
        await startSttBatchRun({ schedule, trigger: "schedule", requestedBy: "scheduler" });
        console.log(`[stt-batch] scheduled run started schedule=${schedule.id}`);
      } catch (e) {
        console.warn(
          `[stt-batch] scheduled run skipped schedule=${schedule.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    await harvestSttBatchJobs();
  } catch (e) {
    console.warn("[stt-batch] tick failed:", e instanceof Error ? e.message : e);
  } finally {
    ticking = false;
  }
}

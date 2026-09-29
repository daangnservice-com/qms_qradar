import { isScheduleDue } from "./sttBatchKst";
import { harvestEvalBatchJobs, startEvalBatchRun } from "./evalBatchRunner";
import { listEvalBatchState } from "./evalBatchStore";

const TICK_MS = 60_000;

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  tick: () => Promise<void>;
};

const g = globalThis as typeof globalThis & { __qradarEvalBatchScheduler?: SchedulerState };

function schedulerState(): SchedulerState {
  g.__qradarEvalBatchScheduler ??= { timer: null, ticking: false, tick: tickDueEvalBatchSchedules };
  return g.__qradarEvalBatchScheduler;
}

schedulerState().tick = tickDueEvalBatchSchedules;

export function startEvalBatchScheduler(): void {
  const s = schedulerState();
  if (s.timer) return;
  s.timer = setInterval(() => {
    void schedulerState().tick();
  }, TICK_MS);
  void s.tick();
}

export async function tickDueEvalBatchSchedules(): Promise<void> {
  const s = schedulerState();
  if (s.ticking) return;
  s.ticking = true;
  try {
    const { schedules } = await listEvalBatchState();
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
        await startEvalBatchRun({ schedule, trigger: "schedule", requestedBy: "scheduler" });
        console.log(`[eval-batch] scheduled run started schedule=${schedule.id}`);
      } catch (e) {
        console.warn(
          `[eval-batch] scheduled run skipped schedule=${schedule.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    await harvestEvalBatchJobs();
  } catch (e) {
    console.warn("[eval-batch] tick failed:", e instanceof Error ? e.message : e);
  } finally {
    s.ticking = false;
  }
}

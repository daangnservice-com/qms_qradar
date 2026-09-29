import { isRecurrenceDue } from "./sttBatchKst";
import { startReviewAssignRun } from "./reviewAssignRunner";
import { listReviewAssignState } from "./reviewAssignStore";

const TICK_MS = 60_000;

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  tick: () => Promise<void>;
};

const g = globalThis as typeof globalThis & { __qradarReviewAssignScheduler?: SchedulerState };

function schedulerState(): SchedulerState {
  g.__qradarReviewAssignScheduler ??= { timer: null, ticking: false, tick: tickDueReviewAssignRules };
  return g.__qradarReviewAssignScheduler;
}

schedulerState().tick = tickDueReviewAssignRules;

export function startReviewAssignScheduler(): void {
  const s = schedulerState();
  if (s.timer) return;
  s.timer = setInterval(() => {
    void schedulerState().tick();
  }, TICK_MS);
  void s.tick();
}

export async function tickDueReviewAssignRules(): Promise<void> {
  const s = schedulerState();
  if (s.ticking) return;
  s.ticking = true;
  try {
    const { rules } = await listReviewAssignState();
    for (const rule of rules) {
      if (
        !isRecurrenceDue({
          enabled: rule.enabled,
          hour: rule.hour,
          minute: rule.minute,
          recurrence: rule.recurrence,
          lastRunDateKst: rule.lastRunDateKst,
        })
      ) {
        continue;
      }
      try {
        await startReviewAssignRun({ rule, trigger: "schedule", requestedBy: "scheduler" });
        console.log(`[review-assign] scheduled run started rule=${rule.id}`);
      } catch (e) {
        console.warn(
          `[review-assign] scheduled run skipped rule=${rule.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } catch (e) {
    console.warn("[review-assign] tick failed:", e instanceof Error ? e.message : e);
  } finally {
    s.ticking = false;
  }
}

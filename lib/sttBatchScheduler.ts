import { isScheduleDue } from "./sttBatchKst";
import {
  harvestSttBatchJobs,
  resumeAllPendingSttBatchUploads,
  startSttBatchRun,
} from "./sttBatchRunner";
import { listSttBatchState } from "./sttBatchStore";

const TICK_MS = 60_000;

/**
 * 스케줄러 상태는 모듈이 아니라 프로세스(globalThis)에 둔다.
 * Next는 라우트마다 번들을 따로 만들고 dev에서는 저장할 때마다 모듈을 다시 평가한다.
 * 모듈 변수로 막으면 인스턴스마다 setInterval이 하나씩 늘어나 같은 콜을 여러 번 올린다.
 */
type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  /** 가장 최근에 평가된 모듈의 tick. 타이머는 하나로 두고 코드만 최신으로 갈아끼운다. */
  tick: () => Promise<void>;
};

const g = globalThis as typeof globalThis & { __qradarSttBatchScheduler?: SchedulerState };

function schedulerState(): SchedulerState {
  g.__qradarSttBatchScheduler ??= { timer: null, ticking: false, tick: tickDueSttBatchSchedules };
  return g.__qradarSttBatchScheduler;
}

schedulerState().tick = tickDueSttBatchSchedules;

/** 프로세스당 하나. 1분마다 due 스케줄을 돌리고 끊긴 업로드·큐 잡을 회수한다. instrumentation.ts가 부른다. */
export function startSttBatchScheduler(): void {
  const s = schedulerState();
  if (s.timer) return;
  s.timer = setInterval(() => {
    void schedulerState().tick();
  }, TICK_MS);
  void s.tick();
}

export async function tickDueSttBatchSchedules(): Promise<void> {
  const s = schedulerState();
  if (s.ticking) return;
  s.ticking = true;
  try {
    // 서버 재시작으로 죽은 업로드 워커를 먼저 다시 켠다 (harvest보다 앞).
    const resumed = await resumeAllPendingSttBatchUploads();
    if (resumed > 0) {
      console.log(`[stt-batch] resumed ${resumed} upload run(s)`);
    }

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
    s.ticking = false;
  }
}

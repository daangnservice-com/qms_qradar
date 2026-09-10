import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickReusableLocalSttJob } from "./localSttClient";
import type { SttBatchJob } from "./sttBatchTypes";

// 같은 콜이 로컬 STT에 여러 번 올라가던 문제의 회귀 테스트.
// 원인: 라우트 번들·HMR마다 스케줄러가 새로 떠서 같은 run을 동시에 업로드했고,
// 실패로 잘못 닫힌 잡은 콜백이 와도 결과를 받지 않았다.

type G = typeof globalThis & Record<string, unknown>;
const g = globalThis as G;

function clearGlobals() {
  const s = g.__qradarSttBatchScheduler as { timer?: ReturnType<typeof setInterval> | null } | undefined;
  if (s?.timer) clearInterval(s.timer);
  delete g.__qradarSttBatchScheduler;
  delete g.__qradarSttUploadingRuns;
  delete g.__qradarSttHarvesting;
}

function job(over: Partial<SttBatchJob>): SttBatchJob {
  return {
    id: "j1",
    runId: "run1",
    scheduleId: "s1",
    conversationId: "c1",
    agentName: "김",
    team: "A",
    callDate: "2026-09-10",
    durationSec: 60,
    status: "queued",
    remoteJobId: null,
    error: null,
    progress: null,
    stage: null,
    segmentCount: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    queuedAt: null,
    finishedAt: null,
    ...over,
  };
}

function mockRunnerDeps(opts: {
  jobs: SttBatchJob[];
  patch: ReturnType<typeof vi.fn>;
  local?: Record<string, unknown>;
  ensureAudio?: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("./sttBatchStore", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sttBatchStore")>()),
    listSttBatchState: vi.fn(async () => ({
      schedules: [],
      runs: [{ id: "run1", status: "running" }],
      jobs: opts.jobs,
    })),
    patchSttBatchJob: opts.patch,
    finishSttBatchRun: vi.fn(async () => null),
  }));
  vi.doMock("./localSttClient", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./localSttClient")>()),
    ...opts.local,
  }));
  vi.doMock("./qaAudio", () => ({
    ensureLocalQaAudio: opts.ensureAudio ?? vi.fn(),
    removeLocalQaAudio: vi.fn(),
    cleanupPaths: vi.fn(),
  }));
  vi.doMock("./sttBatchSelect", () => ({ listSttBatchCandidates: vi.fn(), pickNPerAgent: vi.fn() }));
}

beforeEach(() => {
  vi.resetModules();
  clearGlobals();
});

afterEach(() => {
  clearGlobals();
  vi.doUnmock("./sttBatchStore");
  vi.doUnmock("./localSttClient");
  vi.doUnmock("./qaAudio");
  vi.doUnmock("./sttBatchSelect");
  vi.doUnmock("./sttBatchRunner");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pickReusableLocalSttJob", () => {
  it("prefers a finished job, then a running one, then a queued one", () => {
    const body = {
      jobs: [
        { id: "q", client_ref: "c1", status: "queued" },
        { id: "d", client_ref: "c1", status: "done" },
        { id: "r", client_ref: "c1", status: "running" },
      ],
    };
    expect(pickReusableLocalSttJob(body, "c1")).toEqual({ remoteJobId: "d", status: "done" });
  });

  it("ignores failed, canceled and canceling jobs", () => {
    const body = {
      jobs: [
        { id: "f", client_ref: "c1", status: "failed" },
        { id: "x", client_ref: "c1", status: "canceled" },
        { id: "y", client_ref: "c1", status: "canceling" },
      ],
    };
    expect(pickReusableLocalSttJob(body, "c1")).toBeNull();
  });

  it("does not trust a server that ignored the client_ref filter", () => {
    const body = { jobs: [{ id: "other", client_ref: "c2", status: "done" }] };
    expect(pickReusableLocalSttJob(body, "c1")).toBeNull();
  });
});

describe("sttBatchScheduler", () => {
  it("keeps one timer across repeated starts and module re-evaluation", async () => {
    vi.useFakeTimers();
    vi.doMock("./sttBatchRunner", () => ({
      harvestSttBatchJobs: vi.fn(async () => 0),
      resumeAllPendingSttBatchUploads: vi.fn(async () => 0),
      startSttBatchRun: vi.fn(),
    }));
    vi.doMock("./sttBatchStore", () => ({
      listSttBatchState: vi.fn(async () => ({ schedules: [], jobs: [], runs: [] })),
    }));
    const spy = vi.spyOn(globalThis, "setInterval");

    const first = await import("./sttBatchScheduler");
    first.startSttBatchScheduler();
    first.startSttBatchScheduler();
    vi.resetModules(); // 라우트 번들이나 HMR이 하는 일: 모듈 인스턴스가 하나 더 생긴다
    const second = await import("./sttBatchScheduler");
    second.startSttBatchScheduler();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("upload reuses a live STT job", () => {
  it("attaches the existing remote job instead of downloading and uploading again", async () => {
    const patch = vi.fn(async () => null);
    const ensureAudio = vi.fn();
    const enqueue = vi.fn();
    mockRunnerDeps({
      jobs: [job({ id: "j2", conversationId: "c9", status: "pending_upload" })],
      patch,
      ensureAudio,
      local: {
        findReusableLocalSttJob: vi.fn(async () => ({ remoteJobId: "live-1", status: "queued" })),
        enqueueLocalSttJob: enqueue,
      },
    });

    const { resumePendingSttBatchUploads } = await import("./sttBatchRunner");
    await resumePendingSttBatchUploads("run1");

    expect(ensureAudio).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "j2",
      expect.objectContaining({ status: "queued", remoteJobId: "live-1", error: null }),
    );
  });
});

describe("callback harvest", () => {
  it("revives a job that was marked failed while its remote job was still alive", async () => {
    const patch = vi.fn(async () => null);
    mockRunnerDeps({
      jobs: [job({ status: "failed", remoteJobId: "r1", error: "no such job: r1", finishedAt: "2026-09-10T07:34:10.000Z" })],
      patch,
      local: {
        getLocalSttJob: vi.fn(async () => ({
          status: "queued",
          progress: 0,
          stage: null,
          error: null,
          resultUrl: null,
          durationSec: null,
        })),
      },
    });

    const { harvestSttBatchJobByRemoteId } = await import("./sttBatchRunner");
    await harvestSttBatchJobByRemoteId("r1");

    expect(patch).toHaveBeenCalledWith(
      "j1",
      expect.objectContaining({ status: "queued", error: null, finishedAt: null }),
    );
  });

  it("updates every qradar job that points at the same remote job", async () => {
    const patch = vi.fn(async () => null);
    mockRunnerDeps({
      jobs: [
        job({ id: "old", status: "failed", remoteJobId: "r1" }),
        job({ id: "new", runId: "run2", status: "queued", remoteJobId: "r1" }),
        job({ id: "other", status: "queued", remoteJobId: "r2" }),
      ],
      patch,
      local: {
        getLocalSttJob: vi.fn(async () => ({
          status: "running",
          progress: 0.5,
          stage: "transcribing",
          error: null,
          resultUrl: null,
          durationSec: 60,
        })),
      },
    });

    const { harvestSttBatchJobByRemoteId } = await import("./sttBatchRunner");
    await harvestSttBatchJobByRemoteId("r1");

    const touched = patch.mock.calls.map((c) => (c as unknown[])[0] as string).sort();
    expect(touched).toEqual(["new", "old"]);
  });
});

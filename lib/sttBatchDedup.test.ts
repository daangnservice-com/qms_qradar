import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  delete g.__qradarSttHarvestCheckedAt;
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
  prepareAudio?: ReturnType<typeof vi.fn>;
  cleanupPaths?: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("./sttBatchStore", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sttBatchStore")>()),
    listSttBatchState: vi.fn(async () => ({
      schedules: [],
      runs: [{ id: "run1", status: "running" }],
      jobs: opts.jobs,
    })),
    patchSttBatchJob: opts.patch,
    patchSttBatchJobs: vi.fn(async (list: { id: string; patch: unknown }[]) => {
      for (const p of list) await opts.patch(p.id, p.patch);
      return list.length;
    }),
    saveSttBatchTranscript: vi.fn(async () => {}),
    finishSttBatchRun: vi.fn(async () => null),
  }));
  vi.doMock("./localSttClient", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./localSttClient")>()),
    ...opts.local,
  }));
  // 공유 경로 함수(ensureLocalQaAudio·removeLocalQaAudio)는 일부러 빼 둔다 — 배치가 부르면 테스트가 깨진다.
  vi.doMock("./qaAudio", () => ({
    prepareUploadAudio: opts.prepareAudio ?? vi.fn(),
    cleanupPaths: opts.cleanupPaths ?? vi.fn(),
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
    const prepareAudio = vi.fn();
    const enqueue = vi.fn();
    mockRunnerDeps({
      jobs: [job({ id: "j2", conversationId: "c9", status: "pending_upload" })],
      patch,
      prepareAudio,
      local: {
        findReusableLocalSttJob: vi.fn(async () => ({ remoteJobId: "live-1", status: "queued" })),
        enqueueLocalSttJob: enqueue,
      },
    });

    const { resumePendingSttBatchUploads } = await import("./sttBatchRunner");
    await resumePendingSttBatchUploads("run1");

    expect(prepareAudio).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "j2",
      expect.objectContaining({ status: "queued", remoteJobId: "live-1", error: null }),
    );
  });

  // 2026-09-11: 중복 run이 같은 콜을 동시에 올리며 .data/qa-audio/{id}.wav 하나를 두고
  // EBUSY·빈 파일 업로드·ENOENT로 실패했다.
  it("uploads from its own temp file and deletes only that", async () => {
    const patch = vi.fn(async () => null);
    const cleanup = vi.fn(async () => {});
    const prepareAudio = vi.fn(async () => ({ wavPath: "t.wav", tempPaths: ["t.audio", "t.wav"] }));
    const enqueue = vi.fn(async () => ({ remoteJobId: "r9", status: "queued" }));
    mockRunnerDeps({
      jobs: [job({ id: "j3", conversationId: "c3", status: "pending_upload" })],
      patch,
      prepareAudio,
      cleanupPaths: cleanup,
      local: { findReusableLocalSttJob: vi.fn(async () => null), enqueueLocalSttJob: enqueue },
    });

    const { resumePendingSttBatchUploads } = await import("./sttBatchRunner");
    await resumePendingSttBatchUploads("run1");

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ audioPath: "t.wav" }));
    expect(cleanup).toHaveBeenCalledWith(["t.audio", "t.wav"]);
    expect(patch).toHaveBeenCalledWith("j3", expect.objectContaining({ status: "queued", remoteJobId: "r9" }));
  });

  it("reprocess skips remote reuse and posts force=true with the conversation id", async () => {
    const patch = vi.fn(async () => null);
    const findReusable = vi.fn(async () => ({ remoteJobId: "old-done", status: "done" }));
    const enqueue = vi.fn(async () => ({ remoteJobId: "new-1", status: "queued" }));
    const prepareAudio = vi.fn(async () => ({ wavPath: "t.wav", tempPaths: ["t.wav"] }));
    mockRunnerDeps({
      jobs: [job({ id: "jr", conversationId: "c-re", status: "pending_upload", skipReuse: true, priority: 100 })],
      patch,
      prepareAudio,
      local: { findReusableLocalSttJob: findReusable, enqueueLocalSttJob: enqueue },
    });

    const { resumePendingSttBatchUploads } = await import("./sttBatchRunner");
    await resumePendingSttBatchUploads("run1");

    expect(findReusable).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith({
      conversationId: "c-re",
      audioPath: "t.wav",
      priority: 100,
      force: true,
    });
    expect(patch).toHaveBeenCalledWith("jr", expect.objectContaining({ status: "queued", remoteJobId: "new-1" }));
  });
});

function remoteView(status: string) {
  return { status, progress: null, stage: null, error: null, resultUrl: null, durationSec: null };
}

const sttResult = {
  segments: [],
  transcript: [{ atSec: 0, speaker: "고객", text: "네" }],
  durationSec: 60,
  language: "ko",
};

describe("polling harvest", () => {
  // 2026-09-11: 배열 앞 40건(원격 대기 중)만 매분 다시 보느라 뒤쪽의 끝난 잡 754건이 몇 시간째 "STT 큐"였다.
  it("reaches finished jobs that sit behind jobs still waiting remotely", async () => {
    const patch = vi.fn(async () => null);
    const waiting = Array.from({ length: 45 }, (_, i) =>
      job({ id: `w${i}`, conversationId: `cw${i}`, remoteJobId: `rw${i}` }),
    );
    const late = job({ id: "late", conversationId: "c-late", remoteJobId: "r-late" });
    mockRunnerDeps({
      jobs: [...waiting, late],
      patch,
      local: {
        localSttConfigured: vi.fn(() => true),
        getLocalSttHealth: vi.fn(async () => ({ ok: true })),
        getLocalSttJob: vi.fn(async (id: string) => remoteView(id === "r-late" ? "done" : "queued")),
        getLocalSttResult: vi.fn(async () => sttResult),
      },
    });

    const { harvestSttBatchJobs } = await import("./sttBatchRunner");
    await harvestSttBatchJobs();
    await harvestSttBatchJobs();

    expect(patch).toHaveBeenCalledWith("late", expect.objectContaining({ status: "done", segmentCount: 1 }));
  });

  it("fetches a finished result once for every qradar job on the same remote job", async () => {
    const patch = vi.fn(async () => null);
    const getResult = vi.fn(async () => sttResult);
    mockRunnerDeps({
      jobs: ["a", "b", "c", "d"].map((id, i) =>
        job({ id, runId: `run${i}`, remoteJobId: "r1", status: id === "d" ? "failed" : "queued" }),
      ),
      patch,
      local: {
        getLocalSttJob: vi.fn(async () => remoteView("done")),
        getLocalSttResult: getResult,
      },
    });

    const { harvestSttBatchJobByRemoteId } = await import("./sttBatchRunner");
    await harvestSttBatchJobByRemoteId("r1");

    expect(getResult).toHaveBeenCalledTimes(1);
    const touched = patch.mock.calls.map((c) => (c as unknown[])[0] as string).sort();
    expect(touched).toEqual(["a", "b", "c", "d"]);
  });
});

describe("createSttBatchRun", () => {
  let dir: string;

  beforeEach(() => {
    // 스토어는 process.cwd()/.data에 쓴다. 실제 state.json을 건드리지 않게 임시 폴더로 돌린다.
    dir = mkdtempSync(path.join(tmpdir(), "stt-batch-store-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const scheduleInput = {
    name: "배치",
    enabled: true,
    hour: 2,
    minute: 0,
    perAgentCount: 10,
    maxTotal: 400,
    callDateOffsetDays: 1,
    minDurationSec: null,
    maxDurationSec: null,
    teams: [],
  };

  function pending(conversationId: string) {
    return {
      conversationId,
      agentName: "김",
      team: "A",
      callDate: "2026-09-10",
      durationSec: 60,
      status: "pending_upload" as const,
      remoteJobId: null,
      error: null,
      progress: null,
      stage: null,
      segmentCount: null,
    };
  }

  // 2026-09-11: 동시에 뜬 tick 4~5개가 락 밖 확인을 모두 통과해 같은 스케줄 run을 여러 개 만들었다.
  it("lets only one of several simultaneous scheduled starts through, across module instances", async () => {
    const a = await import("./sttBatchStore");
    vi.resetModules(); // 다른 라우트 번들·프로세스처럼 체인을 공유하지 않는 인스턴스
    const b = await import("./sttBatchStore");
    const schedule = await a.upsertSttBatchSchedule(scheduleInput, null);
    const start = (store: typeof a) =>
      store.createSttBatchRun({
        schedule,
        trigger: "schedule",
        callDate: "2026-09-10",
        executionDateKst: "2099-01-01",
        requestedBy: "scheduler",
        jobs: [pending("c1"), pending("c2")],
      });

    const results = await Promise.allSettled([start(a), start(b), start(a), start(b)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const state = await a.listSttBatchState();
    expect(state.runs).toHaveLength(1);
    expect(state.jobs.map((j) => j.conversationId).sort()).toEqual(["c1", "c2"]);
  });

  it("refuses a second scheduled run on the same day and drops calls already queued", async () => {
    const store = await import("./sttBatchStore");
    const schedule = await store.upsertSttBatchSchedule(scheduleInput, null);
    const input = (trigger: "schedule" | "manual", ids: string[]) => ({
      schedule,
      trigger,
      callDate: "2026-09-10",
      executionDateKst: "2099-01-01",
      requestedBy: null,
      jobs: ids.map(pending),
    });

    const first = await store.createSttBatchRun(input("schedule", ["c1"]));
    await store.finishSttBatchRun(first.run.id, { status: "completed" });

    await expect(store.createSttBatchRun(input("schedule", ["c2"]))).rejects.toThrow("오늘 이미");
    const manual = await store.createSttBatchRun(input("manual", ["c1", "c2"]));
    expect(manual.jobs.map((j) => j.conversationId)).toEqual(["c2"]);
  });

  it("reprocess puts a call back even when that date already has a job", async () => {
    vi.resetModules();
    const store = await import("./sttBatchStore");
    const schedule = await store.upsertSttBatchSchedule(scheduleInput, null);
    const first = await store.createSttBatchRun({
      schedule,
      trigger: "manual",
      callDate: "2026-09-10",
      executionDateKst: "2099-01-01",
      requestedBy: null,
      jobs: [pending("c1")],
    });
    await store.finishSttBatchRun(first.run.id, { status: "completed" });
    const again = await store.createSttBatchRun({
      schedule,
      trigger: "manual",
      callDate: "2026-09-10",
      executionDateKst: "2099-01-02",
      requestedBy: null,
      reprocess: true,
      jobs: [{ ...pending("c1"), priority: 200, skipReuse: true }],
    });
    expect(again.jobs.map((j) => j.conversationId)).toEqual(["c1"]);
    expect(again.jobs[0]?.priority).toBe(200);
    expect(again.jobs[0]?.skipReuse).toBe(true);
  });

  it("archives the previous local transcript when a new job replaces it", async () => {
    vi.resetModules();
    const store = await import("./sttBatchStore");
    const oldLine = [{ atSec: 8, speaker: "상담원", text: "예전 시계" }];
    const newLine = [{ atSec: 28, speaker: "상담원", text: "맞춘 시계" }];
    await store.saveSttBatchTranscript({
      conversationId: "c1",
      durationSec: 40,
      remoteJobId: "job-old",
      transcript: oldLine,
    });
    await store.saveSttBatchTranscript({
      conversationId: "c1",
      durationSec: 40,
      remoteJobId: "job-old",
      transcript: [{ atSec: 8, speaker: "상담원", text: "같은 잡 갱신" }],
    });
    await store.saveSttBatchTranscript({
      conversationId: "c1",
      durationSec: 40,
      remoteJobId: "job-new",
      transcript: newLine,
    });

    const latest = await store.getLatestBatchTranscript("c1");
    expect(latest?.transcript[0]?.text).toBe("맞춘 시계");
    const versions = await store.listBatchTranscriptVersions("c1");
    expect(versions.map((v) => v.versionId).sort()).toEqual(["batch", "batch:job-old"]);
    expect(versions.find((v) => v.versionId === "batch:job-old")?.transcript[0]?.text).toBe("같은 잡 갱신");
    const ids = await store.listBatchTranscriptConversationIds();
    expect(ids.has("c1")).toBe(true);
    expect([...ids].some((id) => id.includes("job-old"))).toBe(false);
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

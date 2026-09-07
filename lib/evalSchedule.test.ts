import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetEvalScheduleForTests,
  finishEvalJob,
  listEvalSchedule,
  tryStartEvalJob,
  updateEvalJob,
} from "./evalSchedule";

beforeEach(() => {
  _resetEvalScheduleForTests();
});

describe("evalSchedule", () => {
  it("allows one active job per conversation", () => {
    const a = tryStartEvalJob({ conversationId: "c1", purpose: "call_eval", requestedBy: "a@x.com" });
    expect(a.ok).toBe(true);
    const b = tryStartEvalJob({ conversationId: "c1", purpose: "qa_eval", requestedBy: "b@x.com" });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.existing.jobId).toBe(a.ok ? a.job.jobId : "");
      expect(b.rejected.status).toBe("rejected_duplicate");
    }
    expect(listEvalSchedule().active).toHaveLength(1);
    expect(listEvalSchedule().recent.some((j) => j.status === "rejected_duplicate")).toBe(true);
  });

  it("releases lock on finish so a new job can start", () => {
    const a = tryStartEvalJob({ conversationId: "c1", purpose: "call_eval" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    updateEvalJob(a.job.jobId, { step: "analyze", sttReused: true });
    finishEvalJob(a.job.jobId, { status: "completed" });
    expect(listEvalSchedule().active).toHaveLength(0);
    const b = tryStartEvalJob({ conversationId: "c1", purpose: "call_eval" });
    expect(b.ok).toBe(true);
  });

  it("allows concurrent jobs for different conversations", () => {
    expect(tryStartEvalJob({ conversationId: "a", purpose: "call_eval" }).ok).toBe(true);
    expect(tryStartEvalJob({ conversationId: "b", purpose: "call_eval" }).ok).toBe(true);
    expect(listEvalSchedule().active).toHaveLength(2);
  });
});

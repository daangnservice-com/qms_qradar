import { randomUUID } from "node:crypto";
import { createJsonFileStore } from "./jsonFileStore";
import { categoryCounts } from "./replyPolishSample";
import {
  DEFAULT_REPLY_POLISH_TEMPLATE,
  type ReplyPolishResult,
  type ReplyPolishRun,
  type ReplyPolishSampleSet,
  type ReplyPolishSampleSetSummary,
  type ReplyPolishTemplate,
} from "./replyPolishTypes";

const MAX_TEMPLATES = 50;
const MAX_SAMPLE_SETS = 12;
const MAX_RUNS = 80;
const MAX_RESULTS = 8000;

type State = {
  templates: ReplyPolishTemplate[];
  sampleSets: ReplyPolishSampleSet[];
  runs: ReplyPolishRun[];
  results: ReplyPolishResult[];
};

const empty = (): State => ({ templates: [], sampleSets: [], runs: [], results: [] });

const store = createJsonFileStore<State>({
  name: "reply-polish",
  empty,
  prepareSave: (state) => ({
    templates: state.templates.slice(0, MAX_TEMPLATES),
    sampleSets: state.sampleSets.slice(0, MAX_SAMPLE_SETS),
    runs: state.runs.slice(0, MAX_RUNS),
    results: state.results.slice(-MAX_RESULTS),
  }),
});

function nowIso() {
  return new Date().toISOString();
}

function asState(parsed: Partial<State>): State {
  return {
    templates: Array.isArray(parsed.templates) ? parsed.templates : [],
    sampleSets: Array.isArray(parsed.sampleSets) ? parsed.sampleSets : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    results: Array.isArray(parsed.results) ? parsed.results : [],
  };
}

function defaultTemplate(email: string | null): ReplyPolishTemplate {
  const now = nowIso();
  return {
    id: randomUUID(),
    name: "기본 톤앤매너",
    body: DEFAULT_REPLY_POLISH_TEMPLATE,
    createdAt: now,
    updatedAt: now,
    updatedBy: email,
  };
}

export function summarizeSampleSet(set: ReplyPolishSampleSet): ReplyPolishSampleSetSummary {
  return {
    id: set.id,
    team: set.team,
    dateStart: set.dateStart,
    dateEnd: set.dateEnd,
    target: set.target,
    seed: set.seed,
    candidateCount: set.candidateCount,
    csatRates: Array.isArray(set.csatRates) ? set.csatRates : [],
    csatIncludeNone: Boolean(set.csatIncludeNone),
    createdAt: set.createdAt,
    createdBy: set.createdBy,
    sampleCount: set.samples.length,
    categories: categoryCounts(set.samples),
  };
}

export async function listReplyPolishState(): Promise<State> {
  return store.withLock(async () => asState(await store.load()));
}

export async function listReplyPolishTemplates(email: string | null): Promise<ReplyPolishTemplate[]> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    if (!state.templates.length) {
      state.templates = [defaultTemplate(email)];
      await store.save(state);
    }
    return state.templates;
  });
}

export async function upsertReplyPolishTemplate(
  input: { id?: string; name: string; body: string },
  email: string | null,
): Promise<ReplyPolishTemplate> {
  const name = input.name.trim() || "이름 없는 템플릿";
  const body = input.body;
  if (!body.trim()) throw new Error("템플릿 본문이 비어 있습니다");
  return store.withLock(async () => {
    const state = asState(await store.load());
    const now = nowIso();
    const existing = input.id ? state.templates.find((t) => t.id === input.id) : undefined;
    if (existing) {
      const next: ReplyPolishTemplate = { ...existing, name, body, updatedAt: now, updatedBy: email };
      state.templates = state.templates.map((t) => (t.id === next.id ? next : t));
      await store.save(state);
      return next;
    }
    const created: ReplyPolishTemplate = {
      id: randomUUID(),
      name,
      body,
      createdAt: now,
      updatedAt: now,
      updatedBy: email,
    };
    state.templates.unshift(created);
    await store.save(state);
    return created;
  });
}

export async function duplicateReplyPolishTemplate(
  id: string,
  email: string | null,
): Promise<ReplyPolishTemplate> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    const src = state.templates.find((t) => t.id === id);
    if (!src) throw new Error("템플릿을 찾을 수 없습니다");
    const now = nowIso();
    const created: ReplyPolishTemplate = {
      id: randomUUID(),
      name: `${src.name} 복사`,
      body: src.body,
      createdAt: now,
      updatedAt: now,
      updatedBy: email,
    };
    state.templates.unshift(created);
    await store.save(state);
    return created;
  });
}

export async function deleteReplyPolishTemplate(id: string): Promise<void> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    const next = state.templates.filter((t) => t.id !== id);
    if (next.length === state.templates.length) throw new Error("템플릿을 찾을 수 없습니다");
    state.templates = next;
    await store.save(state);
  });
}

export async function listReplyPolishSampleSets(): Promise<ReplyPolishSampleSetSummary[]> {
  const state = await listReplyPolishState();
  return state.sampleSets.map(summarizeSampleSet);
}

export async function getReplyPolishSampleSet(id: string): Promise<ReplyPolishSampleSet | null> {
  const state = await listReplyPolishState();
  return state.sampleSets.find((s) => s.id === id) ?? null;
}

export async function saveReplyPolishSampleSet(
  set: Omit<ReplyPolishSampleSet, "id" | "createdAt"> & { id?: string },
): Promise<ReplyPolishSampleSet> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    const now = nowIso();
    const created: ReplyPolishSampleSet = {
      ...set,
      id: set.id ?? randomUUID(),
      createdAt: now,
    };
    state.sampleSets.unshift(created);
    await store.save(state);
    return created;
  });
}

export async function createReplyPolishRun(input: {
  sampleSetId: string;
  templateIds: string[];
  createdBy: string | null;
}): Promise<{ run: ReplyPolishRun; results: ReplyPolishResult[] }> {
  const templateIds = [...new Set(input.templateIds.map((id) => id.trim()).filter(Boolean))];
  if (!templateIds.length) throw new Error("템플릿을 선택하세요");
  return store.withLock(async () => {
    const state = asState(await store.load());
    const sampleSet = state.sampleSets.find((s) => s.id === input.sampleSetId);
    if (!sampleSet) throw new Error("샘플셋을 찾을 수 없습니다");
    const templates = templateIds.map((id) => state.templates.find((t) => t.id === id));
    if (templates.some((t) => !t)) throw new Error("선택한 템플릿을 찾을 수 없습니다");
    if (!sampleSet.samples.length) throw new Error("샘플이 비어 있습니다");

    const now = nowIso();
    const run: ReplyPolishRun = {
      id: randomUUID(),
      sampleSetId: sampleSet.id,
      templateIds,
      status: "pending",
      total: sampleSet.samples.length * templateIds.length,
      done: 0,
      failed: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };
    const results: ReplyPolishResult[] = [];
    for (const sample of sampleSet.samples) {
      for (const templateId of templateIds) {
        const id = `${sampleSet.id}:${sample.id}:${templateId}`;
        const result: ReplyPolishResult = {
          id,
          runId: run.id,
          sampleSetId: sampleSet.id,
          sampleId: sample.id,
          templateId,
          status: "pending",
          polishedText: null,
          error: null,
          llmCallId: null,
          latencyMs: null,
          updatedAt: now,
        };
        results.push(result);
        state.results = state.results.filter((r) => r.id !== id);
      }
    }
    state.results.push(...results);
    state.runs.unshift(run);
    await store.save(state);
    return { run, results };
  });
}

export async function getReplyPolishRun(id: string): Promise<ReplyPolishRun | null> {
  const state = await listReplyPolishState();
  return state.runs.find((r) => r.id === id) ?? null;
}

export async function listReplyPolishRuns(sampleSetId?: string): Promise<ReplyPolishRun[]> {
  const state = await listReplyPolishState();
  if (!sampleSetId) return state.runs;
  return state.runs.filter((r) => r.sampleSetId === sampleSetId);
}

export async function listReplyPolishResults(opts: {
  sampleSetId: string;
  templateIds?: string[];
  runId?: string;
}): Promise<ReplyPolishResult[]> {
  const state = await listReplyPolishState();
  return state.results.filter((r) => {
    if (r.sampleSetId !== opts.sampleSetId) return false;
    if (opts.runId && r.runId !== opts.runId) return false;
    if (opts.templateIds?.length && !opts.templateIds.includes(r.templateId)) return false;
    return true;
  });
}

const STUCK_MS = 120_000;

export async function claimReplyPolishResults(limit: number): Promise<
  Array<{
    result: ReplyPolishResult;
    inquiry: string;
    answer: string;
    category: string;
    templateBody: string;
    templateName: string;
  }>
> {
  const cap = Math.max(1, Math.min(20, Math.floor(limit)));
  return store.withLock(async () => {
    const state = asState(await store.load());
    const now = Date.now();
    const nowIsoStr = nowIso();
    const claimed: Array<{
      result: ReplyPolishResult;
      inquiry: string;
      answer: string;
      category: string;
      templateBody: string;
      templateName: string;
    }> = [];

    for (const result of state.results) {
      if (claimed.length >= cap) break;
      const stuck = result.status === "running" && now - Date.parse(result.updatedAt) > STUCK_MS;
      if (result.status !== "pending" && !stuck) continue;
      const sampleSet = state.sampleSets.find((s) => s.id === result.sampleSetId);
      const sample = sampleSet?.samples.find((s) => s.id === result.sampleId);
      const template = state.templates.find((t) => t.id === result.templateId);
      if (!sample || !template) {
        result.status = "error";
        result.error = !sample ? "샘플을 찾을 수 없습니다" : "템플릿을 찾을 수 없습니다";
        result.updatedAt = nowIsoStr;
        continue;
      }
      result.status = "running";
      result.error = null;
      result.updatedAt = nowIsoStr;
      const run = state.runs.find((r) => r.id === result.runId);
      if (run && run.status === "pending") {
        run.status = "running";
        run.updatedAt = nowIsoStr;
      }
      claimed.push({
        result: { ...result },
        inquiry: sample.inquiry,
        answer: sample.answer,
        category: sample.category,
        templateBody: template.body,
        templateName: template.name,
      });
    }
    await store.save(state);
    return claimed;
  });
}

export async function finishReplyPolishResult(input: {
  id: string;
  status: "done" | "error";
  polishedText?: string | null;
  error?: string | null;
  llmCallId?: string | null;
  latencyMs?: number | null;
}): Promise<void> {
  await store.withLock(async () => {
    const state = asState(await store.load());
    const result = state.results.find((r) => r.id === input.id);
    if (!result) return;
    const now = nowIso();
    result.status = input.status;
    result.polishedText = input.status === "done" ? (input.polishedText ?? "") : result.polishedText;
    result.error = input.status === "error" ? (input.error ?? "다듬기 실패") : null;
    result.llmCallId = input.llmCallId ?? result.llmCallId;
    result.latencyMs = input.latencyMs ?? result.latencyMs;
    result.updatedAt = now;

    const run = state.runs.find((r) => r.id === result.runId);
    if (run) {
      const mine = state.results.filter((r) => r.runId === run.id);
      run.done = mine.filter((r) => r.status === "done").length;
      run.failed = mine.filter((r) => r.status === "error").length;
      const pending = mine.filter((r) => r.status === "pending" || r.status === "running").length;
      run.status = pending > 0 ? "running" : run.failed && !run.done ? "error" : "done";
      run.updatedAt = now;
    }
    await store.save(state);
  });
}

export async function countPendingReplyPolishJobs(): Promise<number> {
  const state = await listReplyPolishState();
  return state.results.filter((r) => r.status === "pending" || r.status === "running").length;
}

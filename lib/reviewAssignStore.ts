import { randomUUID } from "node:crypto";
import { createJsonFileStore } from "./jsonFileStore";
import { clampHour, clampMinute, clampPositiveInt, initialLastRunDateKst } from "./sttBatchKst";
import { listLatestReviewCompletionsByConversationIds } from "./evalReviewCompletionStore";
import {
  reservoirConversationIds,
  type ReviewAssignItem,
  type ReviewAssignQuota,
  type ReviewAssignRecurrence,
  type ReviewAssignRule,
  type ReviewAssignRuleInput,
  type ReviewAssignRun,
} from "./reviewAssignTypes";

const MAX_ITEMS = 8000;
const MAX_RUNS = 200;

type State = {
  rules: ReviewAssignRule[];
  items: ReviewAssignItem[];
  runs: ReviewAssignRun[];
};

const empty = (): State => ({ rules: [], items: [], runs: [] });

const store = createJsonFileStore<State>({
  name: "review-assign",
  empty,
  prepareSave: (state) => ({
    ...state,
    items: state.items.length > MAX_ITEMS ? state.items.slice(-MAX_ITEMS) : state.items,
    runs: state.runs.length > MAX_RUNS ? state.runs.slice(-MAX_RUNS) : state.runs,
  }),
});

function nowIso() {
  return new Date().toISOString();
}

function ymd(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function parseRecurrence(raw: unknown): ReviewAssignRecurrence {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = o.kind;
  if (kind === "weekly") {
    const weekday = Number(o.weekday);
    return { kind: "weekly", weekday: Number.isFinite(weekday) ? ((weekday % 7) + 7) % 7 : 1 };
  }
  if (kind === "monthly") {
    const day = Number(o.dayOfMonth);
    return { kind: "monthly", dayOfMonth: Math.min(28, Math.max(1, Number.isFinite(day) ? Math.trunc(day) : 1)) };
  }
  return { kind: "once" };
}

function nullableMin(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export function normalizeReviewAssignInput(input: ReviewAssignRuleInput): ReviewAssignRuleInput {
  const today = new Date();
  const fallback = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    name: input.name.trim() || "수기 검수 할당",
    enabled: Boolean(input.enabled),
    rangeStart: ymd(input.rangeStart, fallback),
    rangeEnd: ymd(input.rangeEnd, fallback),
    recurrence: parseRecurrence(input.recurrence),
    hour: clampHour(input.hour),
    minute: clampMinute(input.minute),
    perAgentTarget: clampPositiveInt(input.perAgentTarget, 3, 50),
    maxTotal: clampPositiveInt(input.maxTotal, 20, 5_000),
    perEvaluatorQuota: clampPositiveInt(input.perEvaluatorQuota, 10, 500),
    minDurationMin: nullableMin(input.minDurationMin),
    maxDurationMin: nullableMin(input.maxDurationMin),
    teams: (input.teams ?? []).map((s) => s.trim()).filter(Boolean),
  };
}

function asState(parsed: Partial<State>): State {
  return {
    rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    items: Array.isArray(parsed.items) ? parsed.items : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
  };
}

export async function listReviewAssignState(): Promise<State> {
  return store.withLock(async () => asState(await store.load()));
}

export async function upsertReviewAssignRule(
  input: ReviewAssignRuleInput & { id?: string },
  email: string | null,
): Promise<ReviewAssignRule> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    const body = normalizeReviewAssignInput(input);
    const now = nowIso();
    const existing = input.id ? state.rules.find((s) => s.id === input.id) : undefined;
    if (existing) {
      const next: ReviewAssignRule = { ...existing, ...body, updatedAt: now };
      state.rules = state.rules.map((s) => (s.id === next.id ? next : s));
      await store.save(state);
      return next;
    }
    const created: ReviewAssignRule = {
      id: randomUUID(),
      ...body,
      lastRunAt: null,
      lastRunDateKst: initialLastRunDateKst(body.hour, body.minute),
      createdAt: now,
      updatedAt: now,
      createdBy: email,
    };
    state.rules.unshift(created);
    await store.save(state);
    return created;
  });
}

export async function getReviewAssignRule(id: string): Promise<ReviewAssignRule | null> {
  const state = await listReviewAssignState();
  return state.rules.find((s) => s.id === id) ?? null;
}

export { reservoirConversationIds };

export async function listReviewRequestConversationIds(): Promise<string[]> {
  const { items } = await listReviewAssignState();
  return reservoirConversationIds(items);
}

export function assignedConversationIds(items: ReviewAssignItem[]): Set<string> {
  return new Set(items.map((i) => i.conversationId.trim()).filter(Boolean));
}

export async function createReviewAssignRun(input: {
  rule: ReviewAssignRule;
  trigger: ReviewAssignRun["trigger"];
  executionDateKst: string;
  requestedBy: string | null;
  items: Omit<ReviewAssignItem, "id" | "ruleId" | "runId" | "assignedAt">[];
}): Promise<{ run: ReviewAssignRun; items: ReviewAssignItem[] }> {
  return store.withLock(async () => {
    const state = asState(await store.load());
    if (state.runs.some((r) => r.ruleId === input.rule.id && r.status === "running")) {
      throw new Error("이 규칙의 할당이 이미 실행 중입니다.");
    }
    const now = nowIso();
    const runId = randomUUID();
    const existing = assignedConversationIds(state.items);
    const fresh = input.items.filter((i) => i.conversationId && !existing.has(i.conversationId));
    const items: ReviewAssignItem[] = fresh.map((i) => ({
      ...i,
      id: randomUUID(),
      ruleId: input.rule.id,
      runId,
      assignedAt: now,
    }));
    const run: ReviewAssignRun = {
      id: runId,
      ruleId: input.rule.id,
      trigger: input.trigger,
      status: "completed",
      selectedCount: items.length,
      skippedCount: input.items.length - items.length,
      requestedBy: input.requestedBy,
      startedAt: now,
      finishedAt: now,
      error: null,
    };
    state.runs.push(run);
    state.items.push(...items);
    const rule = state.rules.find((s) => s.id === input.rule.id);
    if (rule) {
      rule.lastRunAt = now;
      rule.lastRunDateKst = input.executionDateKst;
      rule.updatedAt = now;
    }
    await store.save(state);
    return { run, items };
  });
}

export function latestReviewAssignRun(runs: ReviewAssignRun[], ruleId: string): ReviewAssignRun | null {
  const list = runs.filter((r) => r.ruleId === ruleId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return list[0] ?? null;
}

export function itemsForRule(items: ReviewAssignItem[], ruleId: string): ReviewAssignItem[] {
  return items.filter((i) => i.ruleId === ruleId);
}

export async function reviewAssignQuotaForEmail(email: string): Promise<ReviewAssignQuota> {
  const { rules, items } = await listReviewAssignState();
  const enabled = rules.filter((r) => r.enabled);
  const quota = enabled.reduce((s, r) => s + r.perEvaluatorQuota, 0);
  const ids = reservoirConversationIds(items);
  if (!ids.length) {
    return { quota, completed: 0, remaining: quota, incompleteCount: 0 };
  }
  const completions = await listLatestReviewCompletionsByConversationIds(ids);
  const mine = email.trim().toLowerCase();
  let completed = 0;
  let incompleteCount = 0;
  for (const id of ids) {
    const c = completions.get(id);
    if (!c) {
      incompleteCount += 1;
      continue;
    }
    if (c.completedBy.trim().toLowerCase() === mine) completed += 1;
  }
  return { quota, completed, remaining: Math.max(0, quota - completed), incompleteCount };
}

export async function listOpenReviewRequestConversationIds(): Promise<string[]> {
  const ids = await listReviewRequestConversationIds();
  if (!ids.length) return [];
  const completions = await listLatestReviewCompletionsByConversationIds(ids);
  return ids.filter((id) => !completions.get(id));
}

export async function _resetReviewAssignStoreForTests(): Promise<void> {
  await store.withLock(async () => {
    await store.save(empty());
  });
}

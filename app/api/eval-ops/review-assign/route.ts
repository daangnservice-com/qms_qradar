import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { tickDueReviewAssignRules } from "@/lib/reviewAssignScheduler";
import {
  itemsForRule,
  latestReviewAssignRun,
  listReviewAssignState,
  upsertReviewAssignRule,
} from "@/lib/reviewAssignStore";
import type { ReviewAssignRecurrence, ReviewAssignRuleInput } from "@/lib/reviewAssignTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRecurrence(raw: unknown): ReviewAssignRecurrence {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (o.kind === "weekly") return { kind: "weekly", weekday: Number(o.weekday) };
  if (o.kind === "monthly") return { kind: "monthly", dayOfMonth: Number(o.dayOfMonth) };
  return { kind: "once" };
}

function parseBody(raw: unknown): ReviewAssignRuleInput & { id?: string } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const teamsRaw = o.teams;
  const teams = Array.isArray(teamsRaw)
    ? teamsRaw.map((s) => String(s))
    : String(teamsRaw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    id: o.id ? String(o.id) : undefined,
    name: String(o.name ?? ""),
    enabled: Boolean(o.enabled),
    rangeStart: String(o.rangeStart ?? ""),
    rangeEnd: String(o.rangeEnd ?? ""),
    recurrence: parseRecurrence(o.recurrence),
    hour: Number(o.hour ?? 10),
    minute: Number(o.minute ?? 0),
    perAgentTarget: Number(o.perAgentTarget),
    maxTotal: Number(o.maxTotal),
    perEvaluatorQuota: Number(o.perEvaluatorQuota),
    minDurationMin: o.minDurationMin == null || o.minDurationMin === "" ? null : Number(o.minDurationMin),
    maxDurationMin: o.maxDurationMin == null || o.maxDurationMin === "" ? null : Number(o.maxDurationMin),
    teams,
  };
}

export async function GET(req: Request) {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  void tickDueReviewAssignRules();

  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId") ?? "";
  const state = await listReviewAssignState();
  const selected = state.rules.find((s) => s.id === ruleId) ?? state.rules[0] ?? null;
  const latestRun = selected ? latestReviewAssignRun(state.runs, selected.id) : null;
  const items = selected ? itemsForRule(state.items, selected.id) : [];

  return NextResponse.json({
    ok: true,
    rules: state.rules,
    selectedId: selected?.id ?? null,
    latestRun,
    items: items.slice(-200).reverse(),
    reservoirCount: state.items.length,
  });
}

export async function POST(req: Request) {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const rule = await upsertReviewAssignRule(parseBody(raw), gate.email);
    return NextResponse.json({ ok: true, rule });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { evalBatchTargetCallDate } from "@/lib/evalBatchRunner";
import { tickDueEvalBatchSchedules } from "@/lib/evalBatchScheduler";
import {
  jobsForEvalBatchRun,
  latestEvalBatchRun,
  listEvalBatchState,
  summarizeEvalBatchAgents,
  upsertEvalBatchSchedule,
} from "@/lib/evalBatchStore";
import type { EvalBatchScheduleInput, EvalBatchSttRequirement } from "@/lib/evalBatchTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStt(v: unknown): EvalBatchSttRequirement {
  return v === "pending" || v === "any" || v === "done" ? v : "done";
}

function parseBody(raw: unknown): EvalBatchScheduleInput & { id?: string } {
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
    hour: Number(o.hour),
    minute: Number(o.minute),
    perAgentCount: Number(o.perAgentCount),
    maxTotal: Number(o.maxTotal),
    callDateOffsetDays: Number(o.callDateOffsetDays),
    minDurationMin: o.minDurationMin == null || o.minDurationMin === "" ? null : Number(o.minDurationMin),
    maxDurationMin: o.maxDurationMin == null || o.maxDurationMin === "" ? null : Number(o.maxDurationMin),
    teams,
    sttRequirement: parseStt(o.sttRequirement),
  };
}

export async function GET(req: Request) {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  void tickDueEvalBatchSchedules();

  const url = new URL(req.url);
  const scheduleId = url.searchParams.get("scheduleId") ?? "";
  const state = await listEvalBatchState();
  const selected = state.schedules.find((s) => s.id === scheduleId) ?? state.schedules[0] ?? null;
  const latestRun = selected ? latestEvalBatchRun(state.runs, selected.id) : null;
  const jobs = latestRun ? jobsForEvalBatchRun(state.jobs, latestRun.id) : [];

  return NextResponse.json({
    ok: true,
    schedules: state.schedules,
    selectedId: selected?.id ?? null,
    latestRun,
    jobs,
    agents: selected ? summarizeEvalBatchAgents(jobs, selected.perAgentCount) : [],
    targetCallDate: selected ? evalBatchTargetCallDate(selected) : null,
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
    const schedule = await upsertEvalBatchSchedule(parseBody(raw), gate.email);
    return NextResponse.json({ ok: true, schedule });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

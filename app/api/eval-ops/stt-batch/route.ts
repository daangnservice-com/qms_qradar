import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { getLocalSttHealth, localSttBaseUrl, localSttConfigured } from "@/lib/localSttClient";
import { targetCallDate } from "@/lib/sttBatchRunner";
import { tickDueSttBatchSchedules } from "@/lib/sttBatchScheduler";
import {
  jobsForRun,
  latestRunForSchedule,
  listSttBatchState,
  summarizeAgents,
  summarizeScheduleStats,
  upsertSttBatchSchedule,
} from "@/lib/sttBatchStore";
import type { SttBatchScheduleInput } from "@/lib/sttBatchTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBody(raw: unknown): SttBatchScheduleInput & { id?: string } {
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
    minDurationSec: o.minDurationSec == null || o.minDurationSec === "" ? null : Number(o.minDurationSec),
    maxDurationSec: o.maxDurationSec == null || o.maxDurationSec === "" ? null : Number(o.maxDurationSec),
    teams,
  };
}

export async function GET(req: Request) {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  void tickDueSttBatchSchedules();

  const url = new URL(req.url);
  const scheduleId = url.searchParams.get("scheduleId") ?? "";
  const state = await listSttBatchState();
  const selected =
    state.schedules.find((s) => s.id === scheduleId) ?? state.schedules[0] ?? null;
  const latestRun = selected ? latestRunForSchedule(state.runs, selected.id) : null;
  const jobs = latestRun ? jobsForRun(state.jobs, latestRun.id) : [];
  const stats = selected ? summarizeScheduleStats(state.jobs, selected.id) : null;
  const health = await getLocalSttHealth();

  return NextResponse.json({
    ok: true,
    schedules: state.schedules,
    selectedId: selected?.id ?? null,
    latestRun,
    jobs,
    agents: selected ? summarizeAgents(jobs, selected.perAgentCount) : [],
    stats,
    targetCallDate: selected ? targetCallDate(selected) : null,
    health: {
      configured: localSttConfigured(),
      ok: health.ok,
      baseUrl: localSttBaseUrl(),
      queueDepth: health.queueDepth,
      busy: health.busy,
      acceptingWork: health.acceptingWork,
      reason: health.reason,
      windowOpen: health.windowOpen,
      nextWindowAt: health.nextWindowAt,
      paused: health.paused,
      overrideUntil: health.overrideUntil,
      gpuUtilPct: health.gpuUtilPct,
      currentJobId: health.currentJobId,
      error: health.error,
    },
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
    const schedule = await upsertSttBatchSchedule(parseBody(raw), gate.email);
    return NextResponse.json({ ok: true, schedule });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";
import { buildMonthlyReportDraft } from "@/lib/monthlyReportDraft";
import {
  deleteSavedMonthlyReportDraft,
  extractPrevActionText,
  getMonthlyReportNotes,
  getSavedMonthlyReportDraft,
  saveMonthlyReportDraft,
  setMonthlyReportNotes,
} from "@/lib/monthlyReportPersist";
import { getMonthlyQualityReport } from "@/lib/monthlyReportStore";
import type { MonthAgg } from "@/lib/monthlyReportTypes";

export const runtime = "nodejs";
export const maxDuration = 60;

function emptyBucket() {
  return { H: 0, C: 0, M: 0, items: {}, memos: [] as string[], targetTemp: null };
}

function monthsAscFromReport(data: Awaited<ReturnType<typeof getMonthlyQualityReport>>): MonthAgg[] {
  return data.patternMonths.map((p) => {
    if (data.selected && p.ym === data.selected.ym) return data.selected;
    if (data.prev && p.ym === data.prev.ym) return data.prev;
    const agents: MonthAgg["agents"] = {};
    for (const [k, a] of Object.entries(p.agents)) {
      const channels: MonthAgg["agents"][string]["channels"] = {};
      for (const [c, b] of Object.entries(a.channels)) {
        channels[c] = { ...emptyBucket(), H: b.H, C: b.C, M: b.M };
      }
      agents[k] = { key: k, name: a.name, team: a.team, channels };
    }
    return {
      ym: p.ym,
      teams: {},
      agents,
      channels: {},
      items: {},
      cold: 0,
      hot: 0,
      melt: 0,
      integrated: { hot: 0, cold: 0, melt: 0 },
    };
  });
}

async function generateDraft(month: string, team: string, specialNotes: string) {
  const data = await getMonthlyQualityReport({ month, team });
  const prevSaved = data.prev
    ? await getSavedMonthlyReportDraft(data.prev.ym, team)
    : null;
  const text = buildMonthlyReportDraft({
    selected: data.selected,
    prev: data.prev,
    monthsAsc: monthsAscFromReport(data),
    teamFilter: data.team || "__all__",
    specialNotes,
    prevActionText: extractPrevActionText(prevSaved?.text),
  });
  return { month: data.month, team: data.team, text };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(await ensureSessionCanAccessQualityEval(session))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    const team = url.searchParams.get("team") ?? "";
    const fresh = url.searchParams.get("fresh") === "1";
    const notes = month ? await getMonthlyReportNotes(month) : "";
    const saved = !fresh && month ? await getSavedMonthlyReportDraft(month, team) : null;
    if (saved) {
      return NextResponse.json({
        ok: true,
        month,
        team,
        specialNotes: notes,
        text: saved.text,
        saved: true,
        savedAt: saved.savedAt,
      });
    }
    const generated = await generateDraft(month, team, notes);
    return NextResponse.json({
      ok: true,
      month: generated.month,
      team: generated.team,
      specialNotes: notes,
      text: generated.text,
      saved: false,
      savedAt: null,
    });
  } catch (e) {
    console.error("[api/results/monthly-report/draft GET]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(await ensureSessionCanAccessQualityEval(session))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const body = (await req.json()) as {
      month?: string;
      team?: string;
      text?: string;
      specialNotes?: string;
      regenerate?: boolean;
    };
    const month = (body.month ?? "").trim();
    const team = (body.team ?? "").trim();
    if (!month) return NextResponse.json({ error: "month 가 필요합니다" }, { status: 400 });

    const specialNotes = body.specialNotes ?? (await getMonthlyReportNotes(month));
    if (body.text == null && !body.regenerate) {
      await setMonthlyReportNotes(month, specialNotes);
      const saved = await getSavedMonthlyReportDraft(month, team);
      return NextResponse.json({
        ok: true,
        month,
        team,
        specialNotes,
        text: saved?.text ?? "",
        saved: Boolean(saved),
        savedAt: saved?.savedAt ?? null,
      });
    }
    let text = body.text ?? "";
    if (body.regenerate || !text.trim()) {
      text = (await generateDraft(month, team, specialNotes)).text;
    }
    const saved = await saveMonthlyReportDraft({
      month,
      team,
      text,
      specialNotes,
      savedBy: session?.user?.email ?? "",
    });
    return NextResponse.json({
      ok: true,
      month,
      team,
      specialNotes,
      text: saved.text,
      saved: true,
      savedAt: saved.savedAt,
    });
  } catch (e) {
    console.error("[api/results/monthly-report/draft PUT]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(await ensureSessionCanAccessQualityEval(session))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    const team = url.searchParams.get("team") ?? "";
    if (!month) return NextResponse.json({ error: "month 가 필요합니다" }, { status: 400 });
    await deleteSavedMonthlyReportDraft(month, team);
    const notes = await getMonthlyReportNotes(month);
    const generated = await generateDraft(month, team, notes);
    return NextResponse.json({
      ok: true,
      month: generated.month,
      team: generated.team,
      specialNotes: notes,
      text: generated.text,
      saved: false,
      savedAt: null,
    });
  } catch (e) {
    console.error("[api/results/monthly-report/draft DELETE]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

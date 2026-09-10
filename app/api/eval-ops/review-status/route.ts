import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessCallQuality } from "@/lib/sessionAccessServer";
import {
  buildReviewStatusReport,
  currentYearMonthKst,
  dateRangeToIso,
  monthRangeToIso,
} from "@/lib/reviewStatusStore";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessCallQuality(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const month = (url.searchParams.get("month") ?? "").trim();
    const startDate = (url.searchParams.get("startDate") ?? "").trim();
    const endDate = (url.searchParams.get("endDate") ?? "").trim();

    let range: { startIso: string; endIso: string };
    let mode: "month" | "custom";
    let selectedMonth: string | null;

    if (startDate && endDate) {
      range = dateRangeToIso(startDate, endDate);
      mode = "custom";
      selectedMonth = null;
    } else {
      selectedMonth = /^\d{4}-\d{2}$/.test(month) ? month : currentYearMonthKst();
      range = monthRangeToIso(selectedMonth);
      mode = "month";
    }

    const report = await buildReviewStatusReport({
      org: "growth",
      startIso: range.startIso,
      endIso: range.endIso,
    });

    return NextResponse.json({
      ...report,
      filter: {
        mode,
        month: selectedMonth,
        startDate: mode === "custom" ? startDate : null,
        endDate: mode === "custom" ? endDate : null,
      },
    });
  } catch (e) {
    console.error("[api/eval-ops/review-status]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

import { servingRows } from "./servingDb";
import { clampPositiveInt } from "./sttBatchKst";
import type { SttBatchCandidate } from "./sttBatchTypes";


function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const raw = v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 구성원당 n건. 이미 넣은 conversation 은 건너뛰고 다음 후보를 채운다. */
export function pickNPerAgent<T extends { conversationId: string; agentName: string }>(
  rows: T[],
  perAgent: number,
  skipIds: Set<string>,
  maxTotal: number,
): T[] {
  const n = clampPositiveInt(perAgent, 1, 100);
  const cap = clampPositiveInt(maxTotal, 1, 20_000);
  const taken = new Map<string, number>();
  const out: T[] = [];
  for (const row of rows) {
    const cid = row.conversationId.trim();
    const agent = (row.agentName || "").trim();
    if (!cid || !agent) continue;
    if (skipIds.has(cid)) continue;
    const used = taken.get(agent) ?? 0;
    if (used >= n) continue;
    taken.set(agent, used + 1);
    out.push(row);
    if (out.length >= cap) break;
  }
  return out;
}

export async function listSttBatchCandidates(opts: {
  callDate: string;
  /** 있으면 [callDate, callDateEnd]  inclusive */
  callDateEnd?: string;
  perAgentCount: number;
  maxTotal: number;
  teams?: string[];
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
  /** 상담사당 가져올 배수. STT/분석 필터 전에 여유분을 둘 때. */
  fetchMultiplier?: number;
}): Promise<SttBatchCandidate[]> {
  const callDate = opts.callDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
    throw new Error("callDate must be YYYY-MM-DD");
  }
  const callDateEnd = (opts.callDateEnd ?? "").trim();
  if (callDateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(callDateEnd)) {
    throw new Error("callDateEnd must be YYYY-MM-DD");
  }
  const ranged = Boolean(callDateEnd && callDateEnd !== callDate);
  const perAgent = clampPositiveInt(opts.perAgentCount, 1, 100);
  const fetchPerAgent = Math.min(100, perAgent * clampPositiveInt(opts.fetchMultiplier ?? 4, 4, 20));
  const maxTotal = clampPositiveInt(opts.maxTotal, 1, 20_000);
  const teams = (opts.teams ?? []).map((s) => s.trim()).filter(Boolean);

  // 콜 원천의 서빙 사본(call_serving, 증분 15분)에서 고른다. 원천에서 온 행만(source_pulled_at).
  const where: string[] = [
    "source_pulled_at is not null",
    "admin_name <> ''",
    ranged ? "call_date_kst between @callDate::date and @callDateEnd::date" : "call_date_kst = @callDate::date",
  ];
  const params: Record<string, unknown> = { callDate, fetchPerAgent };
  if (ranged) params.callDateEnd = callDateEnd;
  if (teams.length) {
    where.push("team = any(@teams::text[])");
    params.teams = teams;
  }
  if (opts.minDurationSec != null && Number.isFinite(opts.minDurationSec)) {
    where.push("duration_sec >= @minDurationSec");
    params.minDurationSec = opts.minDurationSec;
  }
  if (opts.maxDurationSec != null && Number.isFinite(opts.maxDurationSec)) {
    where.push("duration_sec <= @maxDurationSec");
    params.maxDurationSec = opts.maxDurationSec;
  }

  const rows = await servingRows(
    `
    select conversation_id, admin_name, team, call_date_kst, duration_sec
    from (
      select
        conversation_id, admin_name, team, call_date_kst, duration_sec,
        row_number() over (
          partition by admin_name
          order by duration_sec desc nulls last, inquiry_created_at_kst desc
        ) as rn
      from call_serving
      where ${where.join(" and ")}
    ) ranked
    where rn <= @fetchPerAgent
    order by admin_name collate "C", rn
    `,
    params,
  );

  const mapped: SttBatchCandidate[] = (rows as Record<string, unknown>[]).map((r) => ({
    conversationId: String(r.conversation_id ?? ""),
    agentName: r.admin_name ? String(r.admin_name) : "",
    team: r.team ? String(r.team) : "",
    callDate: r.call_date_kst ? String(r.call_date_kst) : callDate,
    durationSec: numOrNull(r.duration_sec),
  }));

  // 여유분까지 가져왔으므로 JS에서 최종 n·상한을 적용한다(스킵은 runner에서).
  return pickNPerAgent(mapped, fetchPerAgent, new Set(), maxTotal * 4);
}

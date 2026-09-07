import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import { clampPositiveInt } from "./sttBatchKst";
import type { SttBatchCandidate } from "./sttBatchTypes";

const CASES_SQL = growthBq.casesSql();
const LOCATION = growthBq.location;
const CID = "json_value(case_content, '$.genesys_conversation_id')";
const CALL_START_TS = "safe_cast(json_value(case_content, '$.call_start') as timestamp)";
const CALL_DATE_KST = `format_date('%F', date(${CALL_START_TS}, 'Asia/Seoul'))`;
const MINUTES_EXPR = "safe_cast(json_value(case_content, '$.minutes_taken') as float64)";

function callDurationSec(callStart: unknown, callEnd: unknown, minutesTaken: unknown): number | null {
  const s = Date.parse(String(callStart ?? ""));
  const e = Date.parse(String(callEnd ?? ""));
  if (Number.isFinite(s) && Number.isFinite(e) && e > s) return Math.round((e - s) / 1000);
  const m = Number(minutesTaken);
  if (Number.isFinite(m) && m > 0) return Math.round(m * 60);
  return null;
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
  perAgentCount: number;
  maxTotal: number;
  teams?: string[];
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
}): Promise<SttBatchCandidate[]> {
  const callDate = opts.callDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
    throw new Error("callDate must be YYYY-MM-DD");
  }
  const perAgent = clampPositiveInt(opts.perAgentCount, 1, 100);
  const fetchPerAgent = Math.min(100, perAgent * 4);
  const maxTotal = clampPositiveInt(opts.maxTotal, 1, 20_000);
  const teams = (opts.teams ?? []).map((s) => s.trim()).filter(Boolean);

  const where: string[] = [
    "year_month >= '2026-04-01'",
    `${CID} is not null`,
    `json_value(case_content, '$.Admin Name') is not null`,
    `${CALL_DATE_KST} = @callDate`,
  ];
  const params: Record<string, unknown> = { callDate, fetchPerAgent };
  const types: Record<string, string> = { fetchPerAgent: "INT64" };

  if (teams.length) {
    where.push(`json_value(case_content, '$.operator_renewal_team_name') in unnest(@teams)`);
    params.teams = teams;
  }
  if (opts.minDurationSec != null && Number.isFinite(opts.minDurationSec)) {
    where.push(`${MINUTES_EXPR} >= @callLenMin`);
    params.callLenMin = opts.minDurationSec / 60;
    types.callLenMin = "FLOAT64";
  }
  if (opts.maxDurationSec != null && Number.isFinite(opts.maxDurationSec)) {
    where.push(`${MINUTES_EXPR} <= @callLenMax`);
    params.callLenMax = opts.maxDurationSec / 60;
    types.callLenMax = "FLOAT64";
  }

  const query = `
    with calls as (
      select
        ${CID} as conversation_id,
        json_value(case_content, '$.Admin Name') as admin_name,
        json_value(case_content, '$.operator_renewal_team_name') as team,
        ${CALL_DATE_KST} as call_date_kst,
        json_value(case_content, '$.call_start') as call_start,
        json_value(case_content, '$.call_end') as call_end,
        json_value(case_content, '$.minutes_taken') as minutes_taken,
        ${MINUTES_EXPR} as minutes_taken_num,
        inquiry_created_at_kst
      from ${CASES_SQL}
      where ${where.join("\n        and ")}
      qualify row_number() over (partition by ${CID} order by inquiry_created_at_kst desc) = 1
    )
    select *
    from calls
    qualify row_number() over (
      partition by admin_name
      order by minutes_taken_num desc nulls last, inquiry_created_at_kst desc
    ) <= @fetchPerAgent
  `;

  const [rows] = await getBQ().query({
    query,
    params,
    types,
    ...(LOCATION ? { location: LOCATION } : {}),
  });

  const mapped: SttBatchCandidate[] = (rows as Record<string, unknown>[]).map((r) => ({
    conversationId: String(r.conversation_id ?? ""),
    agentName: r.admin_name ? String(r.admin_name) : "",
    team: r.team ? String(r.team) : "",
    callDate: r.call_date_kst ? String(r.call_date_kst) : callDate,
    durationSec: callDurationSec(r.call_start, r.call_end, r.minutes_taken),
  }));

  // BQ에서 여유분까지 가져왔으므로 JS에서 최종 n·상한을 적용한다(스킵은 runner에서).
  return pickNPerAgent(mapped, fetchPerAgent, new Set(), maxTotal * 4);
}

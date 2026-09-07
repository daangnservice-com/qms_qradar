/** Client/server shared helpers for eval-ops schedule calendar (qa_scheduler port). */

export const SCHEDULE_PALETTE = [
  "#ff6f0f",
  "#4d82d6",
  "#16a34a",
  "#9333ea",
  "#e11d48",
  "#0891b2",
  "#ca8a04",
  "#64748b",
] as const;

export const PERSONAL_COLOR_PRESETS = [
  "#4d82d6",
  "#16a34a",
  "#9333ea",
  "#e11d48",
  "#0891b2",
  "#ca8a04",
  "#64748b",
  "#ec4899",
  "#f97316",
] as const;

export type ScheduleCompletionState =
  | "selfDone"
  | "leaderDone"
  | "evalDone"
  | "scheduled"
  | "unscheduled";

export type LaneRange = {
  id: string;
  start: string;
  end: string;
};

/** Half/half with remainder to first (1회차). Disable when n <= 1. */
export function splitPerPersonCounts(n: number): { first: number; second: number } | null {
  const v = Math.floor(Number(n) || 0);
  if (v <= 1) return null;
  return { first: Math.ceil(v / 2), second: Math.floor(v / 2) };
}

export function teamColor(team: string, teams: string[]): string {
  const idx = teams.indexOf(team);
  const i = idx >= 0 ? idx : 0;
  return SCHEDULE_PALETTE[i % SCHEDULE_PALETTE.length];
}

export function completionState(item: {
  selfDone?: boolean;
  leaderDone?: boolean;
  evalDone?: boolean;
  startDate?: string | null;
}): ScheduleCompletionState {
  if (item.selfDone) return "selfDone";
  if (item.leaderDone) return "leaderDone";
  if (item.evalDone) return "evalDone";
  if (item.startDate) return "scheduled";
  return "unscheduled";
}

/** Left-border color for todo items (qa_scheduler priority). */
export function todoBorderColor(
  item: {
    selfDone?: boolean;
    leaderDone?: boolean;
    evalDone?: boolean;
    startDate?: string | null;
    teamName: string;
  },
  teams: string[],
): string {
  const state = completionState(item);
  if (state === "selfDone") return "#999";
  if (state === "leaderDone") return "#aaa";
  if (state === "evalDone") return "#ccc";
  if (state === "scheduled") return teamColor(item.teamName, teams);
  return "#e0e0e0";
}

/** Greedy non-overlapping lane assignment (sorted by start, longer first on ties). */
export function assignLanes(items: LaneRange[]): Record<string, number> {
  const all = [...items]
    .filter((d) => d.start)
    .map((d) => ({ id: d.id, start: d.start, end: d.end || d.start }))
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const laneEnds: string[] = [];
  const laneMap: Record<string, number> = {};
  for (const d of all) {
    let lane = laneEnds.findIndex((e) => e < d.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(d.end);
    } else {
      laneEnds[lane] = d.end;
    }
    laneMap[d.id] = lane;
  }
  return laneMap;
}

export function parseYmd(s: string): Date {
  const p = s.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

export function fmtYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return fmtYmd(d);
}

export function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

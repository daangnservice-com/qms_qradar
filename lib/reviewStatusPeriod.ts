/** Asia/Seoul 기준 당월 YYYY-MM */
export function currentYearMonthKst(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

/** YYYY-MM → [start, end) ISO (KST 자정) */
export function monthRangeToIso(ym: string): { startIso: string; endIso: string } {
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return monthRangeToIso(currentYearMonthKst());
  }
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const start = new Date(`${ym}-01T00:00:00+09:00`);
  const endM = m === 12 ? 1 : m + 1;
  const endY = m === 12 ? y + 1 : y;
  const endYm = `${endY}-${String(endM).padStart(2, "0")}`;
  const end = new Date(`${endYm}-01T00:00:00+09:00`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** date input YYYY-MM-DD → [start, endExclusive) ISO in KST (종료일 포함) */
export function dateRangeToIso(startDate: string, endDate: string): { startIso: string; endIso: string } {
  const s = startDate.trim();
  const e = endDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    return monthRangeToIso(currentYearMonthKst());
  }
  const start = new Date(`${s}T00:00:00+09:00`);
  const endDay = new Date(`${e}T00:00:00+09:00`);
  endDay.setTime(endDay.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: endDay.toISOString() };
}

/** Asia/Seoul 날짜·시각. 배치 스케줄 due 판정용. */

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** 스케줄 생성 시각이 이미 오늘 due를 지났으면 오늘 실행을 건너뛴다. */
export function initialLastRunDateKst(hour: number, minute: number, now = new Date()): string | null {
  const clock = kstClock(now);
  const nowMin = clock.hour * 60 + clock.minute;
  const dueMin = clampHour(hour) * 60 + clampMinute(minute);
  return nowMin >= dueMin ? clock.date : null;
}

export function currentDateKst(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function kstClock(now = new Date()): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const y = part(parts, "year");
  const m = part(parts, "month");
  const d = part(parts, "day");
  let hour = Number(part(parts, "hour"));
  const minute = Number(part(parts, "minute"));
  if (hour === 24) hour = 0;
  return {
    date: `${y}-${m}-${d}`,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

/** YYYY-MM-DD ± days (KST 정오 기준, DST 없음). */
export function addDaysYmd(ymd: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const d = new Date(`${ymd}T12:00:00+09:00`);
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  return currentDateKst(d);
}

export function isScheduleDue(opts: {
  enabled: boolean;
  hour: number;
  minute: number;
  lastRunDateKst: string | null;
  now?: Date;
}): boolean {
  if (!opts.enabled) return false;
  const clock = kstClock(opts.now ?? new Date());
  if (opts.lastRunDateKst === clock.date) return false;
  const nowMin = clock.hour * 60 + clock.minute;
  const dueMin = clampHour(opts.hour) * 60 + clampMinute(opts.minute);
  return nowMin >= dueMin;
}

export function clampHour(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}

export function clampMinute(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(59, Math.max(0, Math.trunc(n)));
}

export function clampPositiveInt(n: number, fallback: number, max = 10_000): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

export type RecurrenceKind =
  | { kind: "once" }
  | { kind: "weekly"; weekday: number }
  | { kind: "monthly"; dayOfMonth: number };

/** 매일 시각 + 반복(1회/매주/매월). lastRunDateKst 가 오늘이면 스킵. */
export function isRecurrenceDue(opts: {
  enabled: boolean;
  hour: number;
  minute: number;
  recurrence: RecurrenceKind;
  lastRunDateKst: string | null;
  now?: Date;
}): boolean {
  if (!opts.enabled) return false;
  const clock = kstClock(opts.now ?? new Date());
  if (opts.lastRunDateKst === clock.date) return false;
  const nowMin = clock.hour * 60 + clock.minute;
  const dueMin = clampHour(opts.hour) * 60 + clampMinute(opts.minute);
  if (nowMin < dueMin) return false;
  if (opts.recurrence.kind === "once") return !opts.lastRunDateKst;
  const weekday = new Date(`${clock.date}T12:00:00+09:00`).getDay();
  if (opts.recurrence.kind === "weekly") {
    return weekday === ((opts.recurrence.weekday % 7) + 7) % 7;
  }
  const day = Number(clock.date.slice(8, 10));
  return day === Math.min(28, Math.max(1, Math.trunc(opts.recurrence.dayOfMonth)));
}

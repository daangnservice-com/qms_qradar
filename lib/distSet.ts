/** 평가 배분 셋 ID: YYYY-MM 또는 YYYY-MM_verN (평가표 YYMMDD_verN 과 같은 버저닝). */

const SET_RE = /^(\d{4})-(\d{2})(?:_ver(\d+))?$/;

export type DistSetIdParts = {
  id: string;
  month: string;
  ver: number;
};

export function parseDistSetId(raw: string | null | undefined): DistSetIdParts | null {
  const m = String(raw || "").trim().match(SET_RE);
  if (!m) return null;
  const month = `${m[1]}-${m[2]}`;
  const ver = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(ver) || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return { id: ver > 0 ? `${month}_ver${ver}` : month, month, ver };
}

/** 판정·COLD용 달력월. 셋 ID면 접두 YYYY-MM. */
export function calendarMonthOf(raw: string | null | undefined): string {
  const p = parseDistSetId(raw);
  if (p) return p.month;
  const s = String(raw || "").trim();
  const m = s.match(/(\d{4})[-./]?\s?(\d{1,2})/);
  if (!m) return s.slice(0, 7);
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
}

export function formatDistSetId(month: string, ver: number): string {
  const cal = calendarMonthOf(month);
  if (!/^\d{4}-\d{2}$/.test(cal)) return month;
  return ver > 0 ? `${cal}_ver${ver}` : cal;
}

export function distSetLabel(id: string, confirmed?: boolean): string {
  const p = parseDistSetId(id);
  if (!p) return id;
  const base = p.ver > 0 ? `${p.month}_ver${p.ver}` : p.month;
  return confirmed ? `${base} · 확정` : base;
}

export function compareDistSetIdDesc(a: string, b: string): number {
  const pa = parseDistSetId(a);
  const pb = parseDistSetId(b);
  if (!pa && !pb) return b.localeCompare(a);
  if (!pa) return 1;
  if (!pb) return -1;
  if (pa.month !== pb.month) return pa.month < pb.month ? 1 : -1;
  return pb.ver - pa.ver;
}

/** 같은 평가월의 다음 셋. 신규 월도 항상 _ver1 부터. */
export function nextDistSetId(calendarMonth: string, existingIds: string[]): string {
  const cal = calendarMonthOf(calendarMonth);
  if (!/^\d{4}-\d{2}$/.test(cal)) {
    throw new Error("평가 월은 2026-08 형식으로 입력해주세요.");
  }
  let maxVer = 0;
  for (const id of existingIds) {
    const p = parseDistSetId(id);
    if (p && p.month === cal) maxVer = Math.max(maxVer, p.ver);
  }
  return `${cal}_ver${maxVer + 1}`;
}

export function isDistSetId(raw: string | null | undefined): boolean {
  return parseDistSetId(raw) != null;
}

/**
 * BQ eval_month 가 셋 ID(2026-08_ver1) 또는 레거시 월/날짜(2026-08, 2026-08-01)인 경우 매칭.
 * 레거시 월 조회가 `_verN` 셋을 삼키지 않게 한다.
 */
export function evalMonthWhereSql(column = "eval_month"): string {
  return `(
    CAST(${column} AS STRING) = @month
    OR (
      NOT REGEXP_CONTAINS(@month, r'_ver[0-9]+$')
      AND STARTS_WITH(CAST(${column} AS STRING), @month)
      AND NOT REGEXP_CONTAINS(CAST(${column} AS STRING), r'_ver[0-9]+')
    )
  )`;
}

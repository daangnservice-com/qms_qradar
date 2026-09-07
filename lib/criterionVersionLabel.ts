/** AI 평가 항목 버전 라벨: YYMMDD_verN[_note] (Asia/Seoul) */

export function formatYymmddSeoul(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "00";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}${m}${d}`;
}

/** 사용자 입력 추가 문구 → 라벨 안전 접미사 */
export function sanitizeVersionNote(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w가-힣.\-]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

const VER_RE = /^(\d{6})_ver(\d+)(?:_(.+))?$/;

export function parseVersionLabel(label: string): {
  yymmdd: string;
  ver: number;
  note: string;
} | null {
  const m = String(label ?? "").trim().match(VER_RE);
  if (!m) return null;
  return { yymmdd: m[1], ver: Number(m[2]), note: m[3] ?? "" };
}

/** 해당 일자(prefix)로 이미 쓰인 ver N 최댓값 */
export function maxVerForDate(labels: string[], yymmdd: string): number {
  let max = 0;
  const re = new RegExp(`^${yymmdd}_ver(\\d+)`);
  for (const label of labels) {
    const m = String(label).match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * @param versionNote 인풋박스 추가 문구(선택)
 * @param existingLabels 같은 criterion 의 기존 version_label 목록
 */
export function buildCriterionVersionLabel(
  versionNote: string | null | undefined,
  existingLabels: string[],
  now = new Date(),
): string {
  const yymmdd = formatYymmddSeoul(now);
  const n = maxVerForDate(existingLabels, yymmdd) + 1;
  const note = sanitizeVersionNote(versionNote);
  return note ? `${yymmdd}_ver${n}_${note}` : `${yymmdd}_ver${n}`;
}

/**
 * 참조 프롬프트 라벨에 `_improved_verN` 접미사.
 * 예: `260810_ver2_초안` → `260810_ver2_초안_improved_ver1`
 */
export function buildImprovedVersionLabel(
  baseLabel: string | null | undefined,
  existingLabels: string[],
): string {
  const raw = String(baseLabel ?? "").trim();
  const base = raw || "prompt";
  // 이미 improved 결과에서 다시 개선할 때는 마지막 _improved_verN 을 기준으로 bump
  const stripRe = /_improved_ver\d+$/;
  const root = stripRe.test(base) ? base.replace(stripRe, "") : base;
  const prefix = `${root}_improved_ver`;
  let max = 0;
  for (const label of existingLabels) {
    const s = String(label);
    if (!s.startsWith(prefix)) continue;
    const rest = s.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;
    max = Math.max(max, Number(rest));
  }
  return `${prefix}${max + 1}`;
}

export function formatUpdatedAtKst(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return iso.slice(0, 16);
  }
}

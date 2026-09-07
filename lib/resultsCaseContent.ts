/** QMS case_content / JSON 블록 안전 렌더 헬퍼 */

export function tryParseJson(raw: string): unknown | null {
  const t = raw.trim();
  if (!t) return null;
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}

export function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 텍스트 안의 URL을 분리 (간단 버전) */
export function splitTextUrls(text: string): Array<{ type: "text" | "url"; value: string }> {
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  const out: Array<{ type: "text" | "url"; value: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({ type: "url", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.length ? out : [{ type: "text", value: text }];
}

export function flattenJsonEntries(
  value: unknown,
  prefix = "",
): Array<{ key: string; value: string }> {
  if (value == null) return [];
  if (typeof value !== "object") {
    return [{ key: prefix || "(value)", value: String(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => flattenJsonEntries(item, prefix ? `${prefix}[${i}]` : `[${i}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object") return flattenJsonEntries(v, key);
    return [{ key, value: v == null ? "" : String(v) }];
  });
}

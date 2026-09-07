/**
 * evidence/silenceComments 의 atSec 보정.
 *
 * 의도: 통화 시작부터의 **초(seconds)**.
 * LLM 실수: STT의 `03:16` 표기를 보고 `3.16`(분.초 소수)로 넣는 경우가 많음.
 */

export type AtSecSttHint = { atSec: number; text: string };

/** evidence quote 화자 접두사: `고객: …` / `상담원: …` */
const SPEAKER_PREFIX_RE = /^(고객|이용자|상담원|상담사|구성원)\s*[:：]\s*/;

export function stripEvidenceSpeakerPrefix(quote: string): string {
  return String(quote ?? "").trim().replace(SPEAKER_PREFIX_RE, "").trim();
}

/** 고객 맥락 quote — atSec는 상담원 시각을 유지해야 하므로 STT 재매칭하지 않음 */
export function isCustomerContextQuote(quote: string): boolean {
  return /^(고객|이용자)\s*[:：]/.test(String(quote ?? "").trim());
}

/** `3.16`처럼 소수 둘째자리까지 있고 소수부≤59이면 MM.SS 후보 */
export function looksLikeMinuteDotSecond(raw: number): boolean {
  if (!Number.isFinite(raw) || raw < 0) return false;
  const s = String(raw);
  const m = /^(\d+)\.(\d{2})$/.exec(s);
  if (!m) return false;
  const secPart = Number(m[2]);
  return secPart <= 59;
}

/** MM.SS → seconds. 후보가 아니면 원값 유지. */
export function minuteDotSecondToSec(raw: number): number {
  if (!looksLikeMinuteDotSecond(raw)) return raw;
  const s = String(raw);
  const m = /^(\d+)\.(\d{2})$/.exec(s)!;
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  // 0.xx 는 초 소수일 가능성이 커서 변환하지 않음 (0.45초 vs 00:45)
  if (minutes === 0) return raw;
  return minutes * 60 + seconds;
}

function normalizeText(t: string): string {
  return t.replace(/\s+/g, "").toLowerCase();
}

/** quote ↔ STT 발화 매칭으로 실제 시작 초를 찾음 */
export function matchAtSecFromStt(quote: string, stt: AtSecSttHint[]): number | null {
  const q = normalizeText(stripEvidenceSpeakerPrefix(quote));
  if (!q || q.length < 2 || !stt.length) return null;

  let best: { atSec: number; score: number } | null = null;
  for (const s of stt) {
    const t = normalizeText(s.text);
    if (!t) continue;
    let score = 0;
    if (t === q) score = 1000 + t.length;
    else if (t.includes(q)) score = 500 + q.length;
    else if (q.includes(t) && t.length >= 6) score = 300 + t.length;
    else {
      // 앞 일부만 겹침
      const slice = q.slice(0, Math.min(24, q.length));
      if (slice.length >= 6 && t.includes(slice)) score = 100 + slice.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { atSec: s.atSec, score };
  }
  return best ? best.atSec : null;
}

/**
 * raw atSec → 실제 초.
 * 1) `고객:` quote는 모델이 넣은 상담원 atSec를 유지 (MM.SS만 보정)
 * 2) 그 외 quote가 STT와 맞으면 STT 시각 우선
 * 3) 아니면 MM.SS 휴리스틱
 */
export function coerceAtSec(
  raw: number,
  opts?: { quote?: string; stt?: AtSecSttHint[] },
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;

  if (opts?.quote && isCustomerContextQuote(opts.quote)) {
    return minuteDotSecondToSec(n);
  }

  const fromStt = opts?.quote && opts.stt?.length ? matchAtSecFromStt(opts.quote, opts.stt) : null;
  if (fromStt != null) return fromStt;

  return minuteDotSecondToSec(n);
}

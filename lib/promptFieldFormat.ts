/**
 * LLM이 한 줄로 뱉은 항목 프롬프트 필드를 읽기 쉽게 줄바꿈.
 * 이미 줄바꿈이 있으면 과도한 공백만 정리.
 */
export function formatPromptFieldText(raw: string): string {
  let s = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!s) return "";

  if (!s.includes("\n")) {
    // 문장 종결 뒤 띄어쓰기 → 줄바꿈
    s = s.replace(/([.!?…])\s+(?=[^\s])/g, "$1\n");
    s = s.replace(/(다\.|요\.|음\.|함\.|됨\.|임\.|슴\.)\s+(?=[^\s])/g, "$1\n");
    // 불릿·구분
    s = s.replace(/\s*[·•]\s*/g, "\n· ");
    s = s.replace(/(?:^|\s)-\s+(?=\S)/g, "\n- ");
    // 섹션 힌트
    s = s.replace(/\s+(예\)|예시\s*[:：]|좋은 사례|나쁜 사례|단,|다만|예외\s*[:：]|주의\s*[:：])/g, "\n$1");
  }

  return s
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatPromptFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = formatPromptFieldText(v);
  }
  return out;
}

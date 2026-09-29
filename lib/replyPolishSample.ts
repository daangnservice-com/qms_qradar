import type { EvaluationTurn } from "./evaluationChannel";
import { DAANGNE_ADMIN_NAME } from "./feedbackAdmins";
import type { ReplyPolishCategoryCount, ReplyPolishSample } from "./replyPolishTypes";

export function categoryKey(category: string | null | undefined): string {
  const trimmed = (category ?? "").trim();
  return trimmed || "(없음)";
}

/** 문의 턴 + 당근이 답변만 이어 붙인다. 둘 중 하나라도 없으면 null. */
export function extractReplyPolishTexts(turns: EvaluationTurn[]): { inquiry: string; answer: string } | null {
  const inquiry = turns
    .filter((turn) => turn.speaker === "customer")
    .map((turn) => turn.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const answer = turns
    .filter((turn) => turn.speakerLabel === DAANGNE_ADMIN_NAME)
    .map((turn) => turn.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!inquiry || !answer) return null;
  return { inquiry, answer };
}

export function categoryCounts(samples: Array<{ category: string }>): ReplyPolishCategoryCount[] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = categoryKey(sample.category);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, "ko"));
}

/**
 * 카테고리별 큐를 한 바퀴씩 돌며 target개를 고른다.
 * 같은 카테고리가 앞쪽에 몰려 있어도 분포가 한쪽으로 치우치지 않는다.
 */
export function pickRoundRobinByCategory<T extends { category: string }>(rows: T[], target: number): T[] {
  const n = Math.max(0, Math.floor(target));
  if (n <= 0 || rows.length === 0) return [];
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = categoryKey(row.category);
    const list = buckets.get(key);
    if (list) list.push(row);
    else {
      buckets.set(key, [row]);
      order.push(key);
    }
  }
  const queues = order.map((key) => buckets.get(key)!);
  const out: T[] = [];
  let depth = 0;
  while (out.length < n) {
    let added = false;
    for (const queue of queues) {
      if (out.length >= n) break;
      const item = queue[depth];
      if (!item) continue;
      out.push(item);
      added = true;
    }
    if (!added) break;
    depth += 1;
  }
  return out;
}

export function sampleSnippet(sample: Pick<ReplyPolishSample, "inquiry">, max = 80): string {
  const text = sample.inquiry.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

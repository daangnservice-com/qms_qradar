import { polishReplyWithGemini } from "./replyPolishLlm";
import { claimReplyPolishResults, countPendingReplyPolishJobs, finishReplyPolishResult } from "./replyPolishStore";

const CONCURRENCY = 3;
const CHUNK = 8;

const g = globalThis as typeof globalThis & {
  __qradarReplyPolishProcessing?: { on: boolean };
};

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function processReplyPolishWork(maxJobs = CHUNK): Promise<{ processed: number; remaining: number }> {
  if (g.__qradarReplyPolishProcessing?.on) {
    return { processed: 0, remaining: await countPendingReplyPolishJobs() };
  }
  g.__qradarReplyPolishProcessing = { on: true };
  try {
    const jobs = await claimReplyPolishResults(maxJobs);
    await mapPool(jobs, CONCURRENCY, async (job) => {
      try {
        const out = await polishReplyWithGemini({
          templateBody: job.templateBody,
          inquiry: job.inquiry,
          answer: job.answer,
          category: job.category,
          conversationId: job.result.sampleId,
          templateKey: job.templateName,
        });
        await finishReplyPolishResult({
          id: job.result.id,
          status: "done",
          polishedText: out.text,
          llmCallId: out.llmCallId,
          latencyMs: out.latencyMs,
        });
      } catch (error) {
        await finishReplyPolishResult({
          id: job.result.id,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return { processed: jobs.length, remaining: await countPendingReplyPolishJobs() };
  } finally {
    g.__qradarReplyPolishProcessing = { on: false };
  }
}

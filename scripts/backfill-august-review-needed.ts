/**
 * 8월 수기 검수 완료 건 중 reviewNeeded 가 없는 어노테이션을 적재한다.
 *
 * Hot + 코멘트에 "감안" → 검토필요 + 최종 Hot
 * Hot + 감안 없음     → 검토불필요
 * Cold                → 검토필요 + 최종 Cold (judgment 유지)
 *
 * Usage:
 *   npx tsx scripts/backfill-august-review-needed.ts --target=dev --dry-run
 *   npx tsx scripts/backfill-august-review-needed.ts --target=dev --apply
 *   npx tsx scripts/backfill-august-review-needed.ts --target=dev --apply --month=2026-08
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

function argFlag(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

const apply = process.argv.includes("--apply");
const dryRun = !apply;
const targetArg = (argFlag("target") ?? process.env.BQ_TARGET ?? "dev").toLowerCase();
const target = targetArg === "dev" ? "dev" : "prod";
const month = argFlag("month") ?? "2026-08";

process.env.BQ_TARGET = target;
delete process.env.QRADAR_DATASET;

const CHUNK = 200;
const INSERT_BATCH = 25;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const { getBQ } = await import("../lib/bigquery");
  const { growthBq, bqRefsSummary, qradarTable } = await import("../lib/bqRefs");
  const { monthRangeToIso } = await import("../lib/reviewStatusPeriod");
  const reviewTypes = await import("../lib/evalReviewTypes");
  const { inferLegacyReviewNeeded, needsLegacyReviewNeededBackfill } = reviewTypes;
  type EvalReviewAnnotation = reviewTypes.EvalReviewAnnotation;
  const { listEvalReviewsByConversationIds, saveEvalReview } = await import("../lib/evalReviewStore");

  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`invalid --month=${month} (YYYY-MM)`);
  }
  const { startIso, endIso } = monthRangeToIso(month);

  console.log("[backfill-reviewNeeded] === 8월 수기 reviewNeeded 백필 ===");
  console.log(`[backfill-reviewNeeded] target=${target} dryRun=${dryRun} month=${month}`);
  console.log(`[backfill-reviewNeeded] period ${startIso} .. ${endIso} (KST month)`);
  console.log(`[backfill-reviewNeeded] ${bqRefsSummary()}`);
  console.log(`[backfill-reviewNeeded] reviews=${growthBq.projectId}.${growthBq.dataset}.${qradarTable("eval_human_reviews")}`);

  const loc = growthBq.location ? { location: growthBq.location } : {};
  const completionSql = growthBq.resultsSql(qradarTable("eval_review_completions"));
  const reviewsSql = growthBq.resultsSql(qradarTable("eval_human_reviews"));
  const resultsSql = growthBq.resultsSql(growthBq.resultsTable);

  const pullIds = async (label: string, query: string) => {
    const [rows] = await getBQ().query({
      query,
      params: { start_iso: startIso, end_iso: endIso },
      ...loc,
    });
    const ids = [
      ...new Set(
        (rows as { conversation_id?: string }[])
          .map((r) => String(r.conversation_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    console.log(`[backfill-reviewNeeded] ${label}=${ids.length}`);
    return ids;
  };

  const fromCompletions = await pullIds(
    "completions",
    `
      select conversation_id
      from (
        select conversation_id, completed_at
        from ${completionSql}
        where completed_at >= timestamp(@start_iso)
          and completed_at < timestamp(@end_iso)
        qualify row_number() over (partition by conversation_id order by completed_at desc) = 1
      )
    `,
  );
  const fromLegacyResults = await pullIds(
    "legacy review_completed_at",
    `
      select conversation_id
      from (
        select conversation_id, review_completed_at
        from ${resultsSql}
        where purpose = 'call_eval'
          and review_completed_at is not null
          and review_completed_at >= timestamp(@start_iso)
          and review_completed_at < timestamp(@end_iso)
        qualify row_number() over (partition by conversation_id order by analyzed_at desc) = 1
      )
    `,
  );
  const fromReviewUpdates = await pullIds(
    "reviews updated in month",
    `
      select distinct conversation_id
      from ${reviewsSql}
      where updated_at >= timestamp(@start_iso)
        and updated_at < timestamp(@end_iso)
        and conversation_id is not null
        and conversation_id != ''
    `,
  );

  const convIds = [...new Set([...fromCompletions, ...fromLegacyResults, ...fromReviewUpdates])];
  console.log(`[backfill-reviewNeeded] completed conversations=${convIds.length}`);
  if (!convIds.length) {
    console.log("[backfill-reviewNeeded] nothing to do");
    return;
  }

  const reviewsByConv = new Map<string, EvalReviewAnnotation[]>();
  for (const ids of chunk(convIds, CHUNK)) {
    const part = await listEvalReviewsByConversationIds(ids);
    for (const [cid, list] of part) reviewsByConv.set(cid, list);
  }

  let total = 0;
  let already = 0;
  let skippedBest = 0;
  const pending: EvalReviewAnnotation[] = [];
  let hotGaman = 0;
  let hotOver = 0;
  let cold = 0;

  for (const list of reviewsByConv.values()) {
    for (const r of list) {
      total += 1;
      if (r.judgment === "best") {
        skippedBest += 1;
        continue;
      }
      if (!needsLegacyReviewNeededBackfill(r)) {
        already += 1;
        continue;
      }
      const needed = inferLegacyReviewNeeded(r);
      if (needed == null) continue;
      pending.push({ ...r, reviewNeeded: needed });
      if (r.judgment === "cold") cold += 1;
      else if (needed) hotGaman += 1;
      else hotOver += 1;
    }
  }

  console.log(
    `[backfill-reviewNeeded] annotations=${total} already=${already} best=${skippedBest} pending=${pending.length}`,
  );
  console.log(
    `[backfill-reviewNeeded] pending breakdown: cold(need)=${cold} hot+감안(need+hot)=${hotGaman} hot(no 감안, not-need)=${hotOver}`,
  );

  const sampleBucket = (label: string, pred: (r: EvalReviewAnnotation) => boolean) => {
    const hits = pending.filter(pred).slice(0, 3);
    if (!hits.length) return;
    console.log(`[backfill-reviewNeeded] samples ${label}:`);
    for (const r of hits) {
      console.log(
        "  ",
        JSON.stringify({
          conversationId: r.conversationId,
          annotationId: r.annotationId,
          judgment: r.judgment,
          reviewNeeded: r.reviewNeeded,
          comment: (r.comment || "").slice(0, 80),
        }),
      );
    }
  };
  sampleBucket("cold", (r) => r.judgment === "cold");
  sampleBucket("hot+감안", (r) => r.judgment === "hot" && r.reviewNeeded === true);
  sampleBucket("hot no 감안", (r) => r.judgment === "hot" && r.reviewNeeded === false);

  if (dryRun) {
    console.log("[backfill-reviewNeeded] dry-run only — insert skipped (pass --apply to write)");
    return;
  }
  if (!pending.length) {
    console.log("[backfill-reviewNeeded] nothing to write");
    return;
  }

  let written = 0;
  for (const batch of chunk(pending, INSERT_BATCH)) {
    await Promise.all(
      batch.map((r) =>
        saveEvalReview({
          ...r,
          annotationId: r.annotationId,
          updatedBy: r.updatedBy || "backfill:reviewNeeded",
        }),
      ),
    );
    written += batch.length;
    console.log(`[backfill-reviewNeeded] wrote ${written}/${pending.length}`);
  }
  console.log(`[backfill-reviewNeeded] done. wrote=${written}`);
}

main().catch((e) => {
  console.error("[backfill-reviewNeeded] failed", e);
  process.exit(1);
});

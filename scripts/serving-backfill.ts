import { loadEnvLocal } from "./loadEnvLocal";

loadEnvLocal();

/**
 * BQ dev 데이터셋에서 서빙 테이블로 1회 적재.
 * 사용: npm run serving:backfill
 * bqRefs 는 모듈 로드 때 env 를 읽으므로, env 를 넣은 뒤에 import 한다.
 */

async function main(): Promise<void> {
  const { backfillAppTables, pullCallSources, pullCsat, pullServingMeta } = await import(
    "../lib/servingSync"
  );
  const cases = await pullCallSources();
  console.log(`cases ${cases}`);
  const csat = await pullCsat();
  console.log(`csat ${csat}`);
  await pullServingMeta();
  console.log("meta ok");
  await backfillAppTables();
  console.log("app tables ok");
  const { pullFeedbackThreads } = await import("../lib/feedbackServingStore");
  const feedback = await pullFeedbackThreads({ full: true });
  console.log(`feedback inserted ${feedback}`);
  const { closeServingPool } = await import("../lib/servingDb");
  await closeServingPool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

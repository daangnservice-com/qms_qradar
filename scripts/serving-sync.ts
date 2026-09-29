import { loadEnvLocal } from "./loadEnvLocal";

loadEnvLocal();

/**
 * 주기 작업을 한 번 돌린다.
 * 사용: npm run serving:sync            (증분 pull)
 *       npm run serving:sync -- --nightly (전량 pull + BQ 덤프)
 */

async function main(): Promise<void> {
  const { runServingSync } = await import("../lib/servingSync");
  const mode = process.argv.includes("--nightly") ? "nightly" : "fast";
  const ran = await runServingSync(mode);
  if (!ran) console.log("다른 프로세스가 동기화 중이라 건너뜀");
  console.log("serving sync done");
  const { closeServingPool } = await import("../lib/servingDb");
  await closeServingPool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

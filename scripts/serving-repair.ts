import { loadEnvLocal } from "./loadEnvLocal";

loadEnvLocal();

/**
 * 서빙 DB 보정. 몇 번을 돌려도 결과가 같다.
 * - BQ 전화 평가 결과의 과거 버전을 채운다 (예전 백필은 콜당 최신 1건만 복사했다).
 * - 시작 후 사흘 넘게 걸려 종결된 인앱 문의를 채운다.
 * - BQ 의 LLM·STT 호출 로그와 사용 이벤트를 서빙으로 가져온다(집계 화면용).
 * - 앱 설정·운영 테이블(qradar_*)이 서빙에 비어 있으면 BQ 에서 가져온다.
 * 사용: npm run serving:repair
 */

async function main(): Promise<void> {
  const { backfillCallLogs, backfillEvalResultHistory } = await import("../lib/servingSync");
  await backfillEvalResultHistory();
  await backfillCallLogs();
  const { backfillMirrorTables } = await import("../lib/servingMirror");
  console.log("mirror tables", await backfillMirrorTables());
  const { pullFeedbackThreads } = await import("../lib/feedbackServingStore");
  const feedback = await pullFeedbackThreads({ closedWithinDays: 180 });
  console.log(`feedback inserted ${feedback}`);
  const { closeServingPool } = await import("../lib/servingDb");
  await closeServingPool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

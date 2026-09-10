/**
 * 서버 프로세스가 뜰 때 한 번 불린다(Next 15). 로컬 STT 배치 스케줄러는 여기서만 시작한다.
 * 예전에는 라우트 모듈 최상단에서 시작했는데, 라우트마다 번들이 따로라 스케줄러가 여러 개 돌며
 * 같은 콜을 중복 업로드했다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSttBatchScheduler } = await import("./lib/sttBatchScheduler");
  startSttBatchScheduler();
}

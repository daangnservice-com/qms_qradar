import { BigQuery } from "@google-cloud/bigquery";
import { appBq } from "./bqRefs";
import { gcpAdcPreferredAuth } from "./gcpCredentials";

// BigQuery 클라이언트. 사이트 사용량은 lib/usageEvents.ts(서빙 Postgres)가 적재·집계하고,
// 여기서는 야간 덤프가 쓸 usage_events 테이블만 만든다. 대상은 lib/bqRefs.ts(appBq).
// 인증은 ADC 우선(gcpAdcPreferredAuth) — SA JSON은 GCS 전용.
// ⚠️ 클라이언트에서 import 금지 (@google-cloud/bigquery → fs).

const PROJECT_ID = appBq.projectId;
const DATASET = appBq.dataset;
const LOCATION = appBq.location;
const USAGE_TABLE = appBq.tables.usageEvents;

const USAGE_SCHEMA = [
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" }, // 접속 시각(UTC)
  { name: "user_email", type: "STRING", mode: "NULLABLE" }, // 접속자
  { name: "path", type: "STRING", mode: "NULLABLE" }, // 조회한 경로
  { name: "event", type: "STRING", mode: "NULLABLE" }, // 이벤트 종류(기본 pageview)
] as const;

let _bq: BigQuery | null = null;
export function getBQ(): BigQuery {
  if (!_bq) {
    _bq = new BigQuery({
      projectId: PROJECT_ID,
      ...gcpAdcPreferredAuth(),
    });
  }
  return _bq;
}

// 데이터셋·테이블이 없으면 생성한다(테이블별 최초 1회, 프로세스 수명 동안 캐시).
// ⚠️ 데이터셋에 기본 테이블 만료(defaultTableExpiration)를 설정하지 않는다 —
//    과거 다른 데이터셋의 60일 기본 만료로 데이터가 통째로 자동 삭제된 사고를 반복하지 않기 위함.
const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

const _ensured = new Map<string, Promise<void>>();
function ensureTable(name: string, schema: readonly { name: string; type: string; mode: string }[]): Promise<void> {
  let p = _ensured.get(name);
  if (!p) {
    p = (async () => {
      const bq = getBQ();
      const dataset = bq.dataset(DATASET);
      const [dsExists] = await dataset.exists();
      if (!dsExists) await dataset.create({ location: LOCATION }).catch((e) => { if (!isAlreadyExists(e)) throw e; });
      const table = dataset.table(name);
      const [tExists] = await table.exists();
      if (!tExists) await table.create({ schema: schema as unknown as { name: string; type: string; mode: string }[] }).catch((e) => { if (!isAlreadyExists(e)) throw e; });
    })().catch((err) => {
      _ensured.delete(name); // 실패 시 다음 호출에서 재시도할 수 있도록 캐시 해제
      throw err;
    });
    _ensured.set(name, p);
  }
  return p;
}

export const ensureUsageTable = () => ensureTable(USAGE_TABLE, USAGE_SCHEMA);

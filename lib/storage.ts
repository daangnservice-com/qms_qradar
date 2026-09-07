import { Storage } from "@google-cloud/storage";
import { appBq } from "./bqRefs";
import { gcpClientAuth } from "./gcpCredentials";

// STT 임시 WAV 업로드용 GCS 헬퍼.
// 버킷은 uniform 접근·비공개. lifecycle로 90일 자동 삭제.
// 인증: lib/gcpCredentials.ts (SA JSON → ADC).

const PROJECT_ID = appBq.projectId;
/** STT 임시 업로드 버킷. data-proj-470202의 qms_qradar. */
export const FEEDBACK_BUCKET = process.env.GCS_FEEDBACK_BUCKET ?? "qms_qradar";
const LOCATION = process.env.GCS_LOCATION ?? appBq.location;
const TTL_DAYS = 90;

let _storage: Storage | null = null;
export function getStorage(): Storage {
  if (!_storage) {
    _storage = new Storage({
      projectId: PROJECT_ID,
      ...gcpClientAuth(),
    });
  }
  return _storage;
}

// 버킷 없으면 생성 시도(권한 없으면 warn 후 진행 — 업로드 단계에서 실제 에러).
const _ensured = new Map<string, Promise<void>>();
export function ensureGcsBucket(name: string): Promise<void> {
  let p = _ensured.get(name);
  if (!p) {
    p = (async () => {
      try {
        const bucket = getStorage().bucket(name);
        const [exists] = await bucket.exists();
        if (!exists) {
          await getStorage().createBucket(name, {
            location: LOCATION,
            iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
            lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: TTL_DAYS } }] },
          });
        }
      } catch (err) {
        console.warn(
          `[storage] ensureGcsBucket(${name}) skipped:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();
    _ensured.set(name, p);
  }
  return p;
}

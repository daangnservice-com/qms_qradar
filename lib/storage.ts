import { Storage } from "@google-cloud/storage";
import type { DamageParty } from "./types";

// 피드백이 달린 케이스의 원본 사진만 비공개 GCS 버킷에 보관한다(관리자 리뷰용).
// - 평상시 판별 이미지는 저장하지 않는다(ephemeral). 피드백 제출 시에만 업로드.
// - 버킷은 uniform 접근·비공개. 열람은 관리자에게만 v4 signed URL로 제공.
// - lifecycle로 90일 자동 삭제(PII 노출을 시간으로 제한).
// 인증: GOOGLE_SERVICE_ACCOUNT_JSON(서비스계정 키) 우선, 없으면 ADC.

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID ?? "striped-option-493506-a7";
const BUCKET = process.env.GCS_FEEDBACK_BUCKET ?? "striped-option-493506-a7-helpdesk-x-feedback";
const LOCATION = process.env.GCS_LOCATION ?? "asia-northeast3";
const TTL_DAYS = 90;

let _storage: Storage | null = null;
export function getStorage(): Storage {
  if (!_storage) {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    _storage = new Storage({
      projectId: PROJECT_ID,
      ...(saJson ? { credentials: JSON.parse(saJson) } : {}),
    });
  }
  return _storage;
}

// 버킷 준비(최초 1회, 프로세스 수명 동안 캐시).
// best-effort: 버킷이 없고 생성 권한(storage.buckets.create)이 있으면 생성한다.
// 권한이 없거나 조회/생성이 실패하면 "버킷이 관리자에 의해 미리 프로비저닝된 것"으로
// 간주하고 조용히 넘어간다 — SA엔 객체 권한(storage.objectAdmin)만 주고 버킷은
// 콘솔에서 만들어 둔 최소권한 구성을 지원하기 위함. 실제로 버킷/권한이 없으면
// 이어지는 업로드가 명확한 에러를 던진다.
let _ensured: Promise<void> | null = null;
export function ensureFeedbackBucket(): Promise<void> {
  if (!_ensured) {
    _ensured = (async () => {
      try {
        const bucket = getStorage().bucket(BUCKET);
        const [exists] = await bucket.exists();
        if (!exists) {
          await getStorage().createBucket(BUCKET, {
            location: LOCATION,
            iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
            lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: TTL_DAYS } }] },
          });
        }
      } catch (err) {
        // 버킷은 미리 프로비저닝된 것으로 간주하고 진행(업로드 단계에서 실제 접근성 검증됨)
        console.warn("[storage] ensureFeedbackBucket skipped (assuming pre-provisioned):", err instanceof Error ? err.message : err);
      }
    })();
  }
  return _ensured;
}

// 객체 경로: damage-feedback/{feedbackId}/{party}-{index}.{ext}
export function feedbackObjectName(feedbackId: string, party: DamageParty, index: number, ext: string): string {
  return `damage-feedback/${feedbackId}/${party}-${index}${ext}`;
}

export async function uploadFeedbackImage(
  objectName: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await ensureFeedbackBucket();
  await getStorage()
    .bucket(BUCKET)
    .file(objectName)
    .save(Buffer.from(bytes), { contentType, resumable: false });
}

// 한 피드백의 사진 전부 삭제(prefix로 일괄). best-effort — 이미 없으면 무시.
export async function deleteFeedbackImages(feedbackId: string): Promise<void> {
  try {
    await getStorage().bucket(BUCKET).deleteFiles({ prefix: `damage-feedback/${feedbackId}/` });
  } catch (err) {
    console.warn("[storage] deleteFeedbackImages failed:", err instanceof Error ? err.message : err);
  }
}

// 관리자 열람용 v4 읽기 signed URL(기본 10분 만료).
export async function signedReadUrl(objectName: string, minutes = 10): Promise<string> {
  // TTL 만료로 객체가 사라진 경우도 있으니 존재하지 않으면 빈 문자열 반환
  const file = getStorage().bucket(BUCKET).file(objectName);
  const [exists] = await file.exists();
  if (!exists) return "";
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + minutes * 60 * 1000,
  });
  return url;
}

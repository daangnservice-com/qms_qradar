import { getBQ } from "./bigquery";
import { growthBq } from "./bqRefs";
import {
  PHONE_SOURCE_SYSTEM,
  phoneItemRef,
  type EvaluationChannel,
  type EvaluationItemRef,
} from "./evaluationChannel";

export { PHONE_SOURCE_SYSTEM, phoneItemRef, evaluationItemKey } from "./evaluationChannel";

/** 운영 평가. 채널과 무관. 레거시 값 `call_eval` / `text_eval` 을 여기로 정규화. */
export const PURPOSE_OPS = "call_eval" as const;
/** Train/QA 레퍼런스 평가. 레거시 값 `qa_eval`. */
export const PURPOSE_TRAIN = "qa_eval" as const;
export type StoredEvalPurpose = typeof PURPOSE_OPS | typeof PURPOSE_TRAIN;

let detectedV2: boolean | null = null;

export function resetEvalItemKeyV2Cache(): void {
  detectedV2 = null;
}

/**
 * v2 스키마 = 결과 테이블에 source_id 가 있고 conversation_id 가 없음.
 * env `EVAL_ITEM_KEY_V2=1|0` 이 있으면 메타데이터 조회를 건너뛴다.
 */
export async function isEvalItemKeyV2(): Promise<boolean> {
  const env = (process.env.EVAL_ITEM_KEY_V2 ?? "").trim().toLowerCase();
  if (env === "1" || env === "true" || env === "v2") return true;
  if (env === "0" || env === "false" || env === "v1") return false;
  if (detectedV2 != null) return detectedV2;
  try {
    const table = getBQ()
      .dataset(growthBq.dataset, { projectId: growthBq.projectId })
      .table(growthBq.resultsTable);
    const [meta] = await table.getMetadata();
    const names = new Set(
      ((meta as { schema?: { fields?: Array<{ name?: string }> } }).schema?.fields ?? []).map((f) =>
        String(f.name ?? "").toLowerCase(),
      ),
    );
    detectedV2 = names.has("source_id") && !names.has("conversation_id");
    return detectedV2;
  } catch (e) {
    console.warn("[evalItemKey] schema detect failed, assuming v1:", e instanceof Error ? e.message : e);
    detectedV2 = false;
    return false;
  }
}

/** 저장·백필용 purpose 정규화. train 만 qa_eval, 나머지는 call_eval. */
export function mapStoredPurpose(raw: unknown): StoredEvalPurpose {
  const v = String(raw ?? "").trim();
  if (v === "qa_eval" || v === "train") return PURPOSE_TRAIN;
  return PURPOSE_OPS;
}

export function phoneScopeSql(v2: boolean, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  if (!v2) return "true";
  return `${p}channel = @phone_channel and ${p}source_system = @phone_source_system`;
}

export function itemIdCol(v2: boolean, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return v2 ? `${p}source_id` : `${p}conversation_id`;
}

export function phoneIdEqSql(v2: boolean, param = "cid", alias = ""): string {
  const scope = phoneScopeSql(v2, alias);
  const col = itemIdCol(v2, alias);
  return v2 ? `${scope} and ${col} = @${param}` : `${col} = @${param}`;
}

export function phoneIdInSql(v2: boolean, param = "ids", alias = ""): string {
  const scope = phoneScopeSql(v2, alias);
  const col = itemIdCol(v2, alias);
  return v2 ? `${scope} and ${col} in unnest(@${param})` : `${col} in unnest(@${param})`;
}

export function phoneScopeParams(v2: boolean): Record<string, string> {
  return v2 ? { phone_channel: "phone", phone_source_system: PHONE_SOURCE_SYSTEM } : {};
}

export function refFromPhoneConversationId(conversationId: string): EvaluationItemRef {
  return phoneItemRef(conversationId);
}

export function conversationIdFromRef(ref: EvaluationItemRef): string {
  return ref.sourceId;
}

export function channelOf(value: unknown): EvaluationChannel | null {
  return value === "phone" || value === "feedback" || value === "chatcs" ? value : null;
}

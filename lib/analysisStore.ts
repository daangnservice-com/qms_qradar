import { randomUUID } from "node:crypto";
import { getBQ } from "./bigquery";
import type { EvaluationResult } from "./types";
import type { CallQualityOrg } from "./callQualityOrg";

// 콜 분석 결과를 DA 프로젝트(data-proj-470202)의 실물 테이블에 이력 누적(append)으로 저장한다.
// ⚠️ 교차 프로젝트 쓰기 → 서비스계정에 dataEditor 권한 필요. 리전 US.
// 조직(탭)별로 결과 테이블을 분리한다: 성장문화실 / 페이팀.
const RESULTS_PROJECT = process.env.GROWTH_CULTURE_PROJECT_ID ?? "data-proj-470202";
const RESULTS_DATASET = process.env.EVAL_RESULTS_DATASET ?? "ds_growth_culture";
const RESULTS_TABLE_GROWTH = process.env.EVAL_RESULTS_TABLE ?? "qradar_evaluation_results";
const RESULTS_TABLE_PAY = process.env.EVAL_RESULTS_TABLE_PAY ?? "qradar_evaluation_results_pay";
const LOCATION = process.env.GROWTH_CULTURE_LOCATION; // US
const PROMPT_VERSION = process.env.CALL_PROMPT_VERSION ?? "v1";

const ALL_ORGS: CallQualityOrg[] = ["growth", "pay"];
const resultsTableName = (org: CallQualityOrg) => (org === "pay" ? RESULTS_TABLE_PAY : RESULTS_TABLE_GROWTH);
const fq = (org: CallQualityOrg) => `${RESULTS_PROJECT}.${RESULTS_DATASET}.${resultsTableName(org)}`;
const tableRef = (org: CallQualityOrg) =>
  getBQ().dataset(RESULTS_DATASET, { projectId: RESULTS_PROJECT }).table(resultsTableName(org));
const loc = () => (LOCATION ? { location: LOCATION } : {});

// ⚠️ 만료(defaultTableExpiration) 미설정 — 과거 60일 자동삭제 사고 반복 방지.
const SCHEMA = [
  { name: "analysis_id", type: "STRING", mode: "REQUIRED" }, // 결과 단건 식별자(공유 URL 키)
  { name: "analyzed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "conversation_id", type: "STRING", mode: "REQUIRED" },
  { name: "phone_inquiry_id", type: "STRING", mode: "NULLABLE" },
  { name: "org", type: "STRING", mode: "NULLABLE" }, // growth | pay
  { name: "analyzed_by", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version", type: "STRING", mode: "NULLABLE" },
  { name: "attitude_score", type: "INTEGER", mode: "NULLABLE" },
  { name: "attitude_comment", type: "STRING", mode: "NULLABLE" },
  { name: "resolution_score", type: "INTEGER", mode: "NULLABLE" },
  { name: "resolution_comment", type: "STRING", mode: "NULLABLE" },
  { name: "flow_score", type: "INTEGER", mode: "NULLABLE" },
  { name: "flow_comment", type: "STRING", mode: "NULLABLE" },
  { name: "overall_summary", type: "STRING", mode: "NULLABLE" },
  { name: "duration_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "silence_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "silence_total_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "silence_longest_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "silence_ratio", type: "FLOAT", mode: "NULLABLE" },
  { name: "min_silence_sec", type: "INTEGER", mode: "NULLABLE" },
  { name: "noise_db", type: "INTEGER", mode: "NULLABLE" },
  { name: "transcript_json", type: "STRING", mode: "NULLABLE" },
  { name: "result_json", type: "STRING", mode: "NULLABLE" }, // 전체 EvaluationResult
  { name: "error", type: "STRING", mode: "NULLABLE" },
] as const;

const isAlreadyExists = (e: unknown) =>
  (e as { code?: number })?.code === 409 || /already exists/i.test(e instanceof Error ? e.message : String(e));

// 테이블 없으면 생성(테이블별 1회 캐시). 데이터셋은 이미 존재.
const _ensured = new Map<string, Promise<void>>();
function ensureResultsTable(org: CallQualityOrg): Promise<void> {
  const name = resultsTableName(org);
  let p = _ensured.get(name);
  if (!p) {
    p = (async () => {
      const t = tableRef(org);
      const [exists] = await t.exists();
      if (!exists) {
        await t
          .create({ schema: SCHEMA as unknown as { name: string; type: string; mode: string }[] })
          .catch((e) => {
            if (!isAlreadyExists(e)) throw e;
          });
      }
    })().catch((err) => {
      _ensured.delete(name);
      throw err;
    });
    _ensured.set(name, p);
  }
  return p;
}

/** 분석 결과 1건 저장(append). 조직별 테이블에. 저장된 analysis_id 반환. */
export async function saveAnalysisResult(input: {
  org: CallQualityOrg;
  conversationId: string;
  phoneInquiryId?: string | null;
  analyzedBy: string;
  result: EvaluationResult;
}): Promise<string> {
  await ensureResultsTable(input.org);
  const id = randomUUID();
  const r = input.result;
  const e = r.evaluation;
  const row = {
    analysis_id: id,
    analyzed_at: new Date().toISOString(),
    conversation_id: input.conversationId,
    phone_inquiry_id: input.phoneInquiryId ?? null,
    org: input.org,
    analyzed_by: input.analyzedBy,
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    prompt_version: PROMPT_VERSION,
    attitude_score: e.scores.attitude.score,
    attitude_comment: e.scores.attitude.comment,
    resolution_score: e.scores.resolution.score,
    resolution_comment: e.scores.resolution.comment,
    flow_score: e.scores.flow.score,
    flow_comment: e.scores.flow.comment,
    overall_summary: e.overallSummary,
    duration_sec: r.durationSec,
    silence_count: r.silenceSummary.count,
    silence_total_sec: r.silenceSummary.totalSec,
    silence_longest_sec: r.silenceSummary.longestSec,
    silence_ratio: r.silenceSummary.silenceRatio,
    min_silence_sec: r.threshold.minSilenceSec,
    noise_db: r.threshold.noiseDb,
    transcript_json: JSON.stringify(e.transcript ?? []),
    result_json: JSON.stringify(r),
    error: e.error ?? null,
  };
  await tableRef(input.org).insert([row]);
  return id;
}

/** 해당 조직에서 분석 결과가 저장된 conversation_id들. (완료 표시용) */
export async function listAnalyzedConversationIds(org: CallQualityOrg, conversationIds: string[]): Promise<string[]> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (!ids.length) return [];
  try {
    const query = `select distinct conversation_id from \`${fq(org)}\` where conversation_id in unnest(@ids)`;
    const [rows] = await getBQ().query({ query, params: { ids }, ...loc() });
    return (rows as Record<string, unknown>[]).map((r) => String(r.conversation_id));
  } catch (err) {
    console.error("[listAnalyzedConversationIds]", err); // 테이블 없음 등 → 완료 표시만 생략
    return [];
  }
}

/** 해당 조직의 conversation_id 최신 저장 결과. 없으면 null. */
export async function getLatestResultByConversation(
  org: CallQualityOrg,
  conversationId: string,
): Promise<EvaluationResult | null> {
  const cid = (conversationId ?? "").trim();
  if (!cid) return null;
  try {
    const query = `select analysis_id, result_json from \`${fq(org)}\` where conversation_id = @cid order by analyzed_at desc limit 1`;
    const [rows] = await getBQ().query({ query, params: { cid }, ...loc() });
    const row = (rows as Record<string, unknown>[])[0];
    if (!row?.result_json) return null;
    const result = JSON.parse(String(row.result_json)) as EvaluationResult;
    if (row.analysis_id) result.analysisId = String(row.analysis_id);
    return result;
  } catch (err) {
    console.error("[getLatestResultByConversation]", err);
    return null;
  }
}

async function getAnalysisFromTable(org: CallQualityOrg, id: string): Promise<{
  result: EvaluationResult;
  org: CallQualityOrg;
  conversationId: string;
  phoneInquiryId: string | null;
  analyzedBy: string | null;
  analyzedAt: string | null;
} | null> {
  try {
    const query = `
      select analysis_id, conversation_id, phone_inquiry_id, analyzed_by,
             cast(analyzed_at as string) as analyzed_at, result_json
      from \`${fq(org)}\` where analysis_id = @id limit 1
    `;
    const [rows] = await getBQ().query({ query, params: { id }, ...loc() });
    const row = (rows as Record<string, unknown>[])[0];
    if (!row?.result_json) return null;
    const result = JSON.parse(String(row.result_json)) as EvaluationResult;
    result.analysisId = String(row.analysis_id);
    const conversationId = row.conversation_id ? String(row.conversation_id) : "";
    if (conversationId) result.conversationId = conversationId;
    return {
      result,
      org,
      conversationId,
      phoneInquiryId: row.phone_inquiry_id ? String(row.phone_inquiry_id) : null,
      analyzedBy: row.analyzed_by ? String(row.analyzed_by) : null,
      analyzedAt: row.analyzed_at ? String(row.analyzed_at) : null,
    };
  } catch {
    return null;
  }
}

/** analysis_id로 저장 결과 1건(메타 포함). 조직 테이블 양쪽을 조회. 없으면 null. */
export async function getAnalysisById(analysisId: string) {
  const id = (analysisId ?? "").trim();
  if (!id) return null;
  for (const org of ALL_ORGS) {
    const found = await getAnalysisFromTable(org, id);
    if (found) return found;
  }
  return null;
}

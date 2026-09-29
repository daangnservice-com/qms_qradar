// 평가 결과 서빙 행. 요청 경로의 저장·조회는 여기만 쓴다.
// 전화와 인앱 문의 결과가 같은 테이블에 있다. 전화 전용 조회는 channel = 'phone' 으로 거른다.
import { patchCallApp } from "./callServingStore";
import { servingQuery } from "./servingDb";

export type ServingEvalRecord = Record<string, unknown>;

export async function insertServingEvalResult(input: {
  record: ServingEvalRecord;
  flagKeys: string[];
  hasStt: boolean;
  phoneInquiryId: string | null;
}): Promise<void> {
  const r = input.record;
  const analysisId = String(r.analysis_id ?? "");
  const conversationId = String(r.source_id ?? r.conversation_id ?? "");
  const channel = String(r.channel ?? "phone") || "phone";
  if (!analysisId || !conversationId) throw new Error("analysis_id와 conversation_id가 필요합니다.");
  await servingQuery(
    `
    insert into serving_eval_results (
      analysis_id, conversation_id, org, purpose, analyzed_at, analyzed_by,
      prompt_version_id, prompt_version, ai_label, row_json, exported_at, channel, source_system
    ) values (
      $1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10::jsonb, null, $11, $12
    )
    on conflict (analysis_id) do update set
      row_json = excluded.row_json,
      ai_label = excluded.ai_label,
      exported_at = null
    `,
    [
      analysisId,
      conversationId,
      r.org ?? null,
      String(r.purpose ?? "call_eval"),
      String(r.analyzed_at ?? new Date().toISOString()),
      r.analyzed_by ?? null,
      r.prompt_version_id ?? null,
      r.prompt_version ?? null,
      r.ai_label ?? null,
      JSON.stringify(r),
      channel,
      r.source_system ?? null,
    ],
  );
  // 콜 목록 인덱스는 전화만. 인앱 스레드를 넣으면 전화 목록에 빈 콜로 뜬다.
  if (channel !== "phone") return;
  await patchCallApp(conversationId, {
    analyzed: true,
    aiLabel: r.ai_label != null ? String(r.ai_label) : null,
    evalFlagKeys: input.flagKeys,
    hasStt: input.hasStt,
    sttSource: r.stt_source != null ? String(r.stt_source) : null,
    latestAnalysisId: analysisId,
    org: r.org != null ? String(r.org) : null,
    phoneInquiryId: input.phoneInquiryId,
  });
}

function unwrap(row: { row_json: ServingEvalRecord } | undefined): ServingEvalRecord | null {
  if (!row?.row_json) return null;
  const json = row.row_json;
  return typeof json === "string" ? (JSON.parse(json) as ServingEvalRecord) : json;
}

export async function findLatestServingEval(opts: {
  conversationId: string;
  org?: string | null;
  purpose?: string | null;
}): Promise<ServingEvalRecord | null> {
  const rows = await servingQuery<{ row_json: ServingEvalRecord }>(
    `
    select row_json from serving_eval_results
    where channel = 'phone'
      and conversation_id = $1
      and ($2::text is null or org is null or org = $2)
      and ($3::text is null or purpose = $3)
    order by analyzed_at desc
    limit 1
    `,
    [opts.conversationId, opts.org ?? null, opts.purpose ?? null],
  );
  return unwrap(rows[0]);
}

export async function findServingEvalByAnalysisId(analysisId: string): Promise<ServingEvalRecord | null> {
  const rows = await servingQuery<{ row_json: ServingEvalRecord }>(
    `select row_json from serving_eval_results where analysis_id = $1`,
    [analysisId],
  );
  return unwrap(rows[0]);
}

export async function listServingEvalSummaries(opts: {
  conversationId: string;
  org?: string | null;
  limit: number;
}): Promise<ServingEvalRecord[]> {
  const rows = await servingQuery<{ row_json: ServingEvalRecord }>(
    `
    select row_json from serving_eval_results
    where channel = 'phone'
      and conversation_id = $1
      and ($2::text is null or org is null or org = $2)
      and (purpose is null or purpose <> 'qa_eval')
    order by analyzed_at desc
    limit $3
    `,
    [opts.conversationId, opts.org ?? null, opts.limit],
  );
  return rows.map((r) => unwrap(r)).filter((r): r is ServingEvalRecord => Boolean(r));
}

/** org 일치 또는 org 미기록 행. findLatestServingEval 과 같은 규칙. */
const ORG_MATCH = `channel = 'phone' and ($1::text is null or org is null or org = $1)`;

export async function listServingAnalyzedIds(org: string | null, conversationIds: string[]): Promise<string[]> {
  const ids = [...new Set(conversationIds.map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await servingQuery<{ conversation_id: string }>(
    `
    select distinct conversation_id from serving_eval_results
    where ${ORG_MATCH} and conversation_id = any($2::text[])
    `,
    [org, ids],
  );
  return rows.map((r) => r.conversation_id);
}

export async function listServingRecentAnalyzedIds(org: string | null, limit: number): Promise<string[]> {
  const rows = await servingQuery<{ conversation_id: string }>(
    `
    select conversation_id from (
      select distinct on (conversation_id) conversation_id, analyzed_at
      from serving_eval_results
      where ${ORG_MATCH}
      order by conversation_id, analyzed_at desc
    ) latest
    order by analyzed_at desc
    limit $2
    `,
    [org, limit],
  );
  return rows.map((r) => r.conversation_id);
}

/** conversation별 최신 1건. 조건은 모두 선택. */
export async function listServingLatestRows(opts: {
  org?: string | null;
  conversationIds?: string[] | null;
  purpose?: string | null;
  promptVersionId?: string | null;
}): Promise<ServingEvalRecord[]> {
  const ids = opts.conversationIds ? [...new Set(opts.conversationIds.map((s) => s.trim()).filter(Boolean))] : null;
  if (ids && !ids.length) return [];
  const rows = await servingQuery<{ row_json: ServingEvalRecord }>(
    `
    select distinct on (conversation_id) row_json
    from serving_eval_results
    where ${ORG_MATCH}
      and ($2::text[] is null or conversation_id = any($2::text[]))
      and ($3::text is null or purpose = $3)
      and ($4::text is null or prompt_version_id = $4)
    order by conversation_id, analyzed_at desc
    `,
    [opts.org ?? null, ids, opts.purpose ?? null, opts.promptVersionId ?? null],
  );
  return rows.map((r) => unwrap(r)).filter((r): r is ServingEvalRecord => Boolean(r));
}

export async function listServingPromptVersionCounts(purpose: string): Promise<Array<{ versionId: string; resultCount: number }>> {
  const rows = await servingQuery<{ version_id: string; result_count: string | number }>(
    `
    select prompt_version_id as version_id, count(distinct conversation_id) as result_count
    from serving_eval_results
    where channel = 'phone' and purpose = $1 and prompt_version_id is not null and prompt_version_id <> ''
    group by prompt_version_id
    order by result_count desc
    `,
    [purpose],
  );
  return rows.map((r) => ({ versionId: String(r.version_id), resultCount: Number(r.result_count) || 0 }));
}

export async function listServingTranscriptRows(conversationId: string, limit: number): Promise<ServingEvalRecord[]> {
  const rows = await servingQuery<{ row_json: ServingEvalRecord }>(
    `
    select row_json from serving_eval_results
    where channel = 'phone'
      and conversation_id = $1
      and coalesce(row_json->>'turns_json', row_json->>'transcript_json', '') not in ('', '[]')
    order by analyzed_at desc
    limit $2
    `,
    [conversationId, limit],
  );
  return rows.map((r) => unwrap(r)).filter((r): r is ServingEvalRecord => Boolean(r));
}

/** 채널 원천 항목별 최신 결과. 인앱 문의 등 전화 밖 채널 조회용. */
export async function listServingLatestByItems(
  refs: Array<{ channel: string; sourceSystem: string; sourceId: string }>,
): Promise<ServingEvalRecord[]> {
  if (!refs.length) return [];
  const rows = await servingQuery<{ row_json: ServingEvalRecord }>(
    `
    select distinct on (r.channel, r.source_system, r.conversation_id) r.row_json
    from serving_eval_results r
    join unnest($1::text[], $2::text[], $3::text[]) as k(channel, source_system, source_id)
      on r.channel = k.channel and r.source_system = k.source_system and r.conversation_id = k.source_id
    order by r.channel, r.source_system, r.conversation_id, r.analyzed_at desc
    `,
    [refs.map((r) => r.channel), refs.map((r) => r.sourceSystem), refs.map((r) => r.sourceId)],
  );
  return rows.map((r) => unwrap(r)).filter((r): r is ServingEvalRecord => Boolean(r));
}

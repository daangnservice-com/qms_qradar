import { BigQuery } from "@google-cloud/bigquery";
import type { DamageFeedbackRow, FeedbackStats, FeedbackRating, DamageVerdict, ChatTurnRow, ChatStats } from "./types";

// 사이트 사용량(누가·어떤 페이지를·언제 접속했는지)을 BigQuery에 적재/집계한다.
//
// 대상: striped-option-493506-a7.helpdesk_x.usage_events (Asia-northeast3)
// 인증: GOOGLE_SERVICE_ACCOUNT_JSON(서비스계정 키 JSON) 우선, 없으면 ADC(Application Default Credentials).

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID ?? "striped-option-493506-a7";
const DATASET = process.env.BIGQUERY_DATASET_ID ?? "helpdesk_x";
const LOCATION = process.env.BIGQUERY_LOCATION ?? "asia-northeast3";
const USAGE_TABLE = "usage_events";
const FEEDBACK_TABLE = "damage_feedback";
// 삭제 표시(tombstone). streaming insert 행은 최대 ~90분 DML DELETE가 막히므로,
// 하드 삭제 대신 tombstone을 남기고 조회/집계에서 제외한다(SELECT는 streaming buffer 조회 가능).
const FEEDBACK_DELETED_TABLE = "damage_feedback_deleted";
// 챗봇 트래킹: 질문/답변 턴 + 답변별 평가(둘 다 append-only).
const CHAT_TURN_TABLE = "damage_chat_turns";
const CHAT_RATING_TABLE = "damage_chat_ratings";
const CHAT_DELETED_TABLE = "damage_chat_deleted"; // 챗봇 턴 삭제 표시(tombstone)

const USAGE_SCHEMA = [
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" }, // 접속 시각(UTC)
  { name: "user_email", type: "STRING", mode: "NULLABLE" }, // 접속자
  { name: "path", type: "STRING", mode: "NULLABLE" }, // 조회한 경로
  { name: "event", type: "STRING", mode: "NULLABLE" }, // 이벤트 종류(기본 pageview)
] as const;

// 파손 판별 결과에 대한 좋아요/나빠요 + 코멘트. 프롬프트/모델 개선 리뷰용.
const FEEDBACK_SCHEMA = [
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "feedback_id", type: "STRING", mode: "REQUIRED" }, // GCS 이미지 경로와 연결
  { name: "user_email", type: "STRING", mode: "NULLABLE" },
  { name: "rating", type: "STRING", mode: "NULLABLE" }, // good | bad
  { name: "comment", type: "STRING", mode: "NULLABLE" },
  { name: "verdict", type: "STRING", mode: "NULLABLE" },
  { name: "confidence", type: "FLOAT", mode: "NULLABLE" },
  { name: "comparison", type: "STRING", mode: "NULLABLE" },
  { name: "summary", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  { name: "result_json", type: "STRING", mode: "NULLABLE" }, // 전체 DamageResult
  { name: "claimant_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "respondent_count", type: "INTEGER", mode: "NULLABLE" },
  { name: "image_paths", type: "STRING", mode: "NULLABLE" }, // GCS object 경로 JSON 배열
] as const;

const FEEDBACK_DELETED_SCHEMA = [
  { name: "feedback_id", type: "STRING", mode: "REQUIRED" },
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "deleted_by", type: "STRING", mode: "NULLABLE" },
] as const;

const CHAT_TURN_SCHEMA = [
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "message_id", type: "STRING", mode: "REQUIRED" }, // 답변별 평가와 연결
  { name: "user_email", type: "STRING", mode: "NULLABLE" },
  { name: "question", type: "STRING", mode: "NULLABLE" },
  { name: "answer", type: "STRING", mode: "NULLABLE" },
  { name: "verdict", type: "STRING", mode: "NULLABLE" }, // 대화가 붙은 판정의 verdict(맥락)
  { name: "prompt_version", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
] as const;

const CHAT_RATING_SCHEMA = [
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "message_id", type: "STRING", mode: "REQUIRED" },
  { name: "user_email", type: "STRING", mode: "NULLABLE" },
  { name: "rating", type: "STRING", mode: "NULLABLE" }, // good | bad
] as const;

const CHAT_DELETED_SCHEMA = [
  { name: "message_id", type: "STRING", mode: "REQUIRED" },
  { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "deleted_by", type: "STRING", mode: "NULLABLE" },
] as const;

let _bq: BigQuery | null = null;
export function getBQ(): BigQuery {
  if (!_bq) {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    _bq = new BigQuery({
      projectId: PROJECT_ID,
      // 서비스계정 키가 있으면 사용, 없으면 라이브러리 기본 인증(ADC/GOOGLE_APPLICATION_CREDENTIALS)에 위임.
      ...(saJson ? { credentials: JSON.parse(saJson) } : {}),
    });
  }
  return _bq;
}

// 데이터셋·테이블이 없으면 생성한다(테이블별 최초 1회, 프로세스 수명 동안 캐시).
// ⚠️ 데이터셋에 기본 테이블 만료(defaultTableExpiration)를 설정하지 않는다 —
//    과거 다른 데이터셋의 60일 기본 만료로 데이터가 통째로 자동 삭제된 사고를 반복하지 않기 위함.
// 여러 ensure가 동시에 도는 경우(예: getChatStats가 3개 테이블을 병렬 보장) 새 데이터셋에서
// 둘 다 exists()=false를 보고 둘 다 create()를 호출할 수 있다. 두 번째는 409(Already Exists)를
// 던지는데, 이는 "이미 있음"이므로 성공으로 간주한다.
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
export const ensureFeedbackTable = () => ensureTable(FEEDBACK_TABLE, FEEDBACK_SCHEMA);
export const ensureFeedbackDeletedTable = () => ensureTable(FEEDBACK_DELETED_TABLE, FEEDBACK_DELETED_SCHEMA);
export const ensureChatTurnTable = () => ensureTable(CHAT_TURN_TABLE, CHAT_TURN_SCHEMA);
export const ensureChatRatingTable = () => ensureTable(CHAT_RATING_TABLE, CHAT_RATING_SCHEMA);
export const ensureChatDeletedTable = () => ensureTable(CHAT_DELETED_TABLE, CHAT_DELETED_SCHEMA);

// 조회 이벤트 1건 적재(fire-and-forget). 실패해도 호출부에서 무시한다.
export async function insertUsageEvent(event: { email: string; path: string; type?: string }): Promise<void> {
  await ensureUsageTable();
  await getBQ()
    .dataset(DATASET)
    .table(USAGE_TABLE)
    .insert(
      [
        {
          ts: new Date().toISOString(),
          user_email: String(event.email ?? ""),
          path: String(event.path ?? ""),
          event: String(event.type ?? "pageview"),
        },
      ],
      { skipInvalidRows: true, ignoreUnknownValues: true },
    );
}

export interface UsageStats {
  totalViews: number;
  totalUsers: number;
  totalActions: number;
  daily: { date: string; views: number; users: number }[];
  byPath: { path: string; views: number; users: number }[];
  byAction: { event: string; count: number; users: number }[]; // 기능별 사용 횟수
  byUser: {
    email: string;
    views: number;
    lastSeen: string;
    paths: { path: string; views: number }[]; // 이 사용자의 화면별 사용
    daily: { date: string; views: number }[]; // 이 사용자의 일별 접속
    actions: { event: string; count: number }[]; // 이 사용자의 기능별 사용
  }[];
}

const num = (v: unknown) => Number(v ?? 0);
const tsStr = (v: unknown) =>
  v && typeof v === "object" && "value" in v ? String((v as { value: string }).value) : String(v ?? "");

// 최근 N일 사용량 집계(일별·경로별·사용자별). 대시보드용. 한국시간(Asia/Seoul) 기준 날짜 집계.
export async function getUsageStats(days = 30): Promise<UsageStats> {
  await ensureUsageTable();
  const T = `\`${PROJECT_ID}.${DATASET}.${USAGE_TABLE}\``;
  const period = "ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
  // 페이지 조회(pageview) vs 기능 사용(액션)을 분리 집계. 검증용 행(event='__verify')은 항상 제외.
  const viewWhere = `WHERE ${period} AND COALESCE(event,'pageview') = 'pageview'`;
  const actWhere = `WHERE ${period} AND event NOT IN ('pageview','__verify') AND event IS NOT NULL`;
  const run = (query: string) => getBQ().query({ query, params: { days }, location: LOCATION });

  const [[daily], [byPath], [byUser], [userPaths], [userDaily], [byAction], [userActions]] = await Promise.all([
    run(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(ts,'Asia/Seoul')) AS date, COUNT(*) AS views, COUNT(DISTINCT user_email) AS users FROM ${T} ${viewWhere} GROUP BY date ORDER BY date`),
    run(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT user_email) AS users FROM ${T} ${viewWhere} GROUP BY path ORDER BY views DESC`),
    run(`SELECT user_email AS email, COUNT(*) AS views, MAX(ts) AS last_seen FROM ${T} ${viewWhere} GROUP BY email ORDER BY views DESC`),
    run(`SELECT user_email AS email, path, COUNT(*) AS views FROM ${T} ${viewWhere} GROUP BY email, path`),
    run(`SELECT user_email AS email, FORMAT_DATE('%Y-%m-%d', DATE(ts,'Asia/Seoul')) AS date, COUNT(*) AS views FROM ${T} ${viewWhere} GROUP BY email, date`),
    run(`SELECT event, COUNT(*) AS count, COUNT(DISTINCT user_email) AS users FROM ${T} ${actWhere} GROUP BY event ORDER BY count DESC`),
    run(`SELECT user_email AS email, event, COUNT(*) AS count FROM ${T} ${actWhere} GROUP BY email, event`),
  ]);

  const daily2 = (daily as Record<string, unknown>[]).map((r) => ({ date: String(r.date), views: num(r.views), users: num(r.users) }));
  const byPath2 = (byPath as Record<string, unknown>[]).map((r) => ({ path: String(r.path ?? ""), views: num(r.views), users: num(r.users) }));
  const byAction2 = (byAction as Record<string, unknown>[]).map((r) => ({ event: String(r.event ?? ""), count: num(r.count), users: num(r.users) }));

  // 사용자별 상세(화면·일별·액션)를 이메일 기준으로 묶어 byUser에 붙인다.
  const pathsByEmail = new Map<string, { path: string; views: number }[]>();
  for (const r of userPaths as Record<string, unknown>[]) {
    const e = String(r.email ?? "");
    (pathsByEmail.get(e) ?? pathsByEmail.set(e, []).get(e)!).push({ path: String(r.path ?? ""), views: num(r.views) });
  }
  const dailyByEmail = new Map<string, { date: string; views: number }[]>();
  for (const r of userDaily as Record<string, unknown>[]) {
    const e = String(r.email ?? "");
    (dailyByEmail.get(e) ?? dailyByEmail.set(e, []).get(e)!).push({ date: String(r.date), views: num(r.views) });
  }
  const actionsByEmail = new Map<string, { event: string; count: number }[]>();
  for (const r of userActions as Record<string, unknown>[]) {
    const e = String(r.email ?? "");
    (actionsByEmail.get(e) ?? actionsByEmail.set(e, []).get(e)!).push({ event: String(r.event ?? ""), count: num(r.count) });
  }

  const byUser2 = (byUser as Record<string, unknown>[]).map((r) => {
    const email = String(r.email ?? "");
    return {
      email,
      views: num(r.views),
      lastSeen: tsStr(r.last_seen),
      paths: (pathsByEmail.get(email) ?? []).sort((a, b) => b.views - a.views),
      daily: (dailyByEmail.get(email) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
      actions: (actionsByEmail.get(email) ?? []).sort((a, b) => b.count - a.count),
    };
  });

  return {
    totalViews: byPath2.reduce((s, r) => s + r.views, 0),
    totalUsers: byUser2.length,
    totalActions: byAction2.reduce((s, r) => s + r.count, 0),
    daily: daily2,
    byPath: byPath2,
    byAction: byAction2,
    byUser: byUser2,
  };
}

// ── 파손 판별 피드백 ─────────────────────────────────────────────

export interface DamageFeedbackInsert {
  feedbackId: string;
  email: string;
  rating: FeedbackRating;
  comment: string;
  verdict: string;
  confidence: number;
  comparison: string;
  summary: string;
  promptVersion: string;
  model: string;
  resultJson: string;
  claimantCount: number;
  respondentCount: number;
  imagePaths: string[];
}

// 피드백 1건 적재. 실패는 호출부에서 처리(사용자에게 실패 안내).
export async function insertDamageFeedback(fb: DamageFeedbackInsert): Promise<void> {
  await ensureFeedbackTable();
  await getBQ()
    .dataset(DATASET)
    .table(FEEDBACK_TABLE)
    .insert(
      [
        {
          ts: new Date().toISOString(),
          feedback_id: fb.feedbackId,
          user_email: fb.email,
          rating: fb.rating,
          comment: fb.comment || null,
          verdict: fb.verdict,
          confidence: fb.confidence,
          comparison: fb.comparison || null,
          summary: fb.summary || null,
          prompt_version: fb.promptVersion,
          model: fb.model,
          result_json: fb.resultJson,
          claimant_count: fb.claimantCount,
          respondent_count: fb.respondentCount,
          image_paths: JSON.stringify(fb.imagePaths ?? []),
        },
      ],
      { skipInvalidRows: false, ignoreUnknownValues: true },
    );
}

// 피드백 삭제(soft). tombstone 1건 적재 → 조회/집계에서 즉시 제외된다.
// GCS 이미지 실삭제는 호출부(라우트)에서 별도로 수행.
export async function deleteFeedback(feedbackId: string, deletedBy: string): Promise<void> {
  await ensureFeedbackDeletedTable();
  await getBQ()
    .dataset(DATASET)
    .table(FEEDBACK_DELETED_TABLE)
    .insert([{ feedback_id: feedbackId, ts: new Date().toISOString(), deleted_by: deletedBy }], {
      ignoreUnknownValues: true,
    });
}

function parseImagePaths(v: unknown): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(String(v));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

// 최근 N일 피드백 집계(버전별·판정별 good/bad) + 최근 목록. 관리자 대시보드용.
// 삭제 표시(tombstone)된 항목은 제외.
export async function getFeedbackStats(days = 90, recentLimit = 50): Promise<FeedbackStats> {
  await Promise.all([ensureFeedbackTable(), ensureFeedbackDeletedTable()]);
  const T = `\`${PROJECT_ID}.${DATASET}.${FEEDBACK_TABLE}\``;
  const D = `\`${PROJECT_ID}.${DATASET}.${FEEDBACK_DELETED_TABLE}\``;
  const where =
    "WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY) " +
    `AND feedback_id NOT IN (SELECT feedback_id FROM ${D})`;
  const run = (query: string, extra: Record<string, unknown> = {}) =>
    getBQ().query({ query, params: { days, ...extra }, location: LOCATION });

  const [[totals], [byVersion], [recent]] = await Promise.all([
    run(`SELECT COUNTIF(rating='good') AS good, COUNTIF(rating='bad') AS bad, COUNT(*) AS total FROM ${T} ${where}`),
    run(`SELECT prompt_version, COUNTIF(rating='good') AS good, COUNTIF(rating='bad') AS bad FROM ${T} ${where} GROUP BY prompt_version ORDER BY prompt_version`),
    run(`SELECT * FROM ${T} ${where} ORDER BY ts DESC LIMIT @lim`, { lim: recentLimit }),
  ]);

  const t = (totals as Record<string, unknown>[])[0] ?? {};
  const recentRows: DamageFeedbackRow[] = (recent as Record<string, unknown>[]).map((r) => ({
    ts: tsStr(r.ts),
    feedbackId: String(r.feedback_id ?? ""),
    userEmail: String(r.user_email ?? ""),
    rating: (r.rating === "bad" ? "bad" : "good") as FeedbackRating,
    comment: String(r.comment ?? ""),
    verdict: String(r.verdict ?? "") as DamageVerdict,
    confidence: num(r.confidence),
    comparison: String(r.comparison ?? ""),
    summary: String(r.summary ?? ""),
    promptVersion: String(r.prompt_version ?? ""),
    model: String(r.model ?? ""),
    claimantCount: num(r.claimant_count),
    respondentCount: num(r.respondent_count),
    imagePaths: parseImagePaths(r.image_paths),
  }));

  return {
    total: num(t.total),
    good: num(t.good),
    bad: num(t.bad),
    byVersion: (byVersion as Record<string, unknown>[]).map((r) => ({
      promptVersion: String(r.prompt_version ?? ""),
      good: num(r.good),
      bad: num(r.bad),
    })),
    recent: recentRows,
  };
}

// ── 챗봇 트래킹 ─────────────────────────────────────────────

export async function insertChatTurn(t: {
  messageId: string;
  email: string;
  question: string;
  answer: string;
  verdict: string;
  promptVersion: string;
  model: string;
}): Promise<void> {
  await ensureChatTurnTable();
  await getBQ()
    .dataset(DATASET)
    .table(CHAT_TURN_TABLE)
    .insert(
      [
        {
          ts: new Date().toISOString(),
          message_id: t.messageId,
          user_email: t.email || null,
          question: t.question,
          answer: t.answer,
          verdict: t.verdict || null,
          prompt_version: t.promptVersion || null,
          model: t.model || null,
        },
      ],
      { ignoreUnknownValues: true },
    );
}

export async function insertChatRating(r: { messageId: string; email: string; rating: FeedbackRating }): Promise<void> {
  await ensureChatRatingTable();
  await getBQ()
    .dataset(DATASET)
    .table(CHAT_RATING_TABLE)
    .insert([{ ts: new Date().toISOString(), message_id: r.messageId, user_email: r.email || null, rating: r.rating }], {
      ignoreUnknownValues: true,
    });
}

// 챗봇 턴 삭제(soft). tombstone 1건 적재 → 조회/집계에서 즉시 제외된다.
export async function deleteChatTurn(messageId: string, deletedBy: string): Promise<void> {
  await ensureChatDeletedTable();
  await getBQ()
    .dataset(DATASET)
    .table(CHAT_DELETED_TABLE)
    .insert([{ message_id: messageId, ts: new Date().toISOString(), deleted_by: deletedBy }], {
      ignoreUnknownValues: true,
    });
}

// 최근 N일 챗봇 턴 + 답변별 최신 평가. 관리자 대시보드용. 삭제 표시(tombstone) 제외.
export async function getChatStats(days = 90, recentLimit = 100): Promise<ChatStats> {
  await Promise.all([ensureChatTurnTable(), ensureChatRatingTable(), ensureChatDeletedTable()]);
  const TT = `\`${PROJECT_ID}.${DATASET}.${CHAT_TURN_TABLE}\``;
  const RT = `\`${PROJECT_ID}.${DATASET}.${CHAT_RATING_TABLE}\``;
  const DT = `\`${PROJECT_ID}.${DATASET}.${CHAT_DELETED_TABLE}\``;
  const notDeleted = `message_id NOT IN (SELECT message_id FROM ${DT})`;
  const where = `WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY) AND ${notDeleted}`;
  const run = (query: string, extra: Record<string, unknown> = {}) =>
    getBQ().query({ query, params: { days, ...extra }, location: LOCATION });

  // message_id별 최신 평가(재평가 시 마지막 것)
  const latestRating = `SELECT message_id, ARRAY_AGG(rating ORDER BY ts DESC LIMIT 1)[OFFSET(0)] AS rating FROM ${RT} GROUP BY message_id`;

  const [[totals], [ratingCounts], [recent]] = await Promise.all([
    run(`SELECT COUNT(*) AS total FROM ${TT} ${where}`),
    // 재평가(append-only) 중복 집계 방지 + 삭제/기간 필터를 위해 '턴 ⨝ message당 최신 평가'로 계산.
    // (raw rating 행을 세면 👍→👎 재평가가 둘 다 카운트돼 목록의 최신 뱃지와 어긋난다)
    run(`SELECT COUNTIF(r.rating='good') AS good, COUNTIF(r.rating='bad') AS bad FROM ${TT} t JOIN (${latestRating}) r USING (message_id) ${where}`),
    run(
      `SELECT t.ts AS ts, t.message_id AS message_id, t.user_email AS user_email, t.question AS question, t.answer AS answer, t.verdict AS verdict, t.prompt_version AS prompt_version, r.rating AS rating
       FROM ${TT} t LEFT JOIN (${latestRating}) r USING (message_id)
       ${where} ORDER BY t.ts DESC LIMIT @lim`,
      { lim: recentLimit },
    ),
  ]);

  const t = (totals as Record<string, unknown>[])[0] ?? {};
  const rc = (ratingCounts as Record<string, unknown>[])[0] ?? {};
  const recentRows: ChatTurnRow[] = (recent as Record<string, unknown>[]).map((r) => ({
    ts: tsStr(r.ts),
    messageId: String(r.message_id ?? ""),
    userEmail: String(r.user_email ?? ""),
    question: String(r.question ?? ""),
    answer: String(r.answer ?? ""),
    verdict: String(r.verdict ?? ""),
    promptVersion: String(r.prompt_version ?? ""),
    rating: r.rating === "good" ? "good" : r.rating === "bad" ? "bad" : null,
  }));

  return { totalTurns: num(t.total), good: num(rc.good), bad: num(rc.bad), recent: recentRows };
}

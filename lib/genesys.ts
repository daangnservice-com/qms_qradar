// Genesys Cloud 녹취 다운로드 클라이언트.
// conversation_id → OAuth(client_credentials) → 녹취 목록/상세(단건 직접) → 미디어 URL → 오디오 bytes.
// 참고: github.com/daangnservice-com/genesys_recording_downloader (recording_download_links.py)
//
// 기본은 단건(직접) 흐름: fileState=AVAILABLE 녹취는 실시간 recording API가 수 초 안에 미디어 URL을 준다.
// 배치(/recording/batchrequests)는 available 녹취에도 잡이 ~3분 InProgress로 매우 느려(2026-07 확인)
// 기본 경로에서 뺐다. 아카이브 복원/대량이 필요할 때의 폴백(getConversationAudioUrlViaBatch)으로만 남긴다.

const HOST = process.env.GENESYS_HOST ?? "https://api.apne2.pure.cloud";
const TOKEN_HOST = process.env.GENESYS_TOKEN_HOST ?? "https://login.apne2.pure.cloud";
const DEFAULT_FORMAT_ID = process.env.GENESYS_FORMAT_ID ?? "WEBM";

const POLL_INTERVAL_MS = 2000;
// 미디어 준비/배치 대기 상한. 음수/NaN은 무시하고 기본값으로 클램프(폴링이 통째로 건너뛰어지는 것 방지).
const _maxWaitEnv = Number(process.env.GENESYS_MAX_WAIT_MS);
const MAX_WAIT_MS = Number.isFinite(_maxWaitEnv) && _maxWaitEnv > 0 ? _maxWaitEnv : 180_000;

// 즉시 평가 불가한 파일 상태(복원 필요).
const ARCHIVED_FILE_STATES = new Set(["ARCHIVED", "RESTORING"]);

// 배치(폴백)용 상태 집합.
const DONE_STATUSES = new Set(["COMPLETE", "COMPLETED", "FULFILLED", "SUCCESS", "SUCCEEDED"]);
const FAILED_STATUSES = new Set(["FAILED", "ERROR", "CANCELLED", "CANCELED", "ABORTED", "TIMEDOUT", "TIMEOUT"]);
// 폴링 중 일시적 오류 — 치명적으로 보지 않고 재시도.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
// POST 바디 스키마 거부로 보고 다음 변형을 시도할 상태들.
const RETRYABLE_BODY_STATUSES = new Set([400, 415, 422]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 500);
  } catch {
    return "";
  }
}
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 인증 (client_credentials, 토큰 메모리 캐시)
// ---------------------------------------------------------------------------
let _token: { value: string; expiresAt: number } | null = null;

export async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt) return _token.value;

  const clientId = process.env.GENESYS_CLIENT_ID;
  const clientSecret = process.env.GENESYS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GENESYS_CLIENT_ID / GENESYS_CLIENT_SECRET 미설정");

  const key = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch(`${TOKEN_HOST}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) throw new Error(`Genesys 토큰 발급 실패 (${resp.status}): ${await safeText(resp)}`);

  const data = (await resp.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (data.expires_in ?? 3600) * 1000;
  _token = { value: data.access_token, expiresAt: Date.now() + ttlMs - 60_000 }; // 만료 60초 여유
  return _token.value;
}

async function authHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ---------------------------------------------------------------------------
// 응답에서 다운로드 URL 추출 (_extract_urls_from_entity 이식)
// ---------------------------------------------------------------------------
export function extractUrls(entity: unknown): string[] {
  const urls: string[] = [];
  const visit = (e: unknown) => {
    if (!e || typeof e !== "object") return;
    const o = e as Record<string, unknown>;
    const single = o.resultUrl ?? o.downloadUri ?? o.mediaUri;
    if (typeof single === "string" && single) urls.push(single);

    const mediaUris = o.mediaUris;
    if (Array.isArray(mediaUris)) mediaUris.forEach(visit);
    else if (mediaUris && typeof mediaUris === "object") Object.values(mediaUris).forEach(visit);

    if (o.recording && typeof o.recording === "object") visit(o.recording);
  };
  visit(entity);
  return [...new Set(urls)];
}

// ---------------------------------------------------------------------------
// 단건(직접) Recording 흐름 — 기본 경로
// ---------------------------------------------------------------------------
// 대화의 녹취 목록(메타). download=false로 미디어 생성 트리거 없이 id/fileState 확보. 202/빈응답이면 재시도.
async function listRecordings(cid: string): Promise<Record<string, unknown>[]> {
  const url = `${HOST}/api/v2/conversations/${cid}/recordings?download=false`;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const resp = await fetch(url, { headers: await authHeaders() });
    if (resp.status === 404) return [];
    if (TRANSIENT_STATUSES.has(resp.status)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const text = await resp.text();
    if (resp.status === 202 || !text.trim()) {
      await sleep(POLL_INTERVAL_MS); // 목록 준비 중
      continue;
    }
    if (!resp.ok) throw new Error(`녹취 목록 조회 실패 (${resp.status}): ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as unknown;
    const arr = Array.isArray(data) ? data : (((data as Record<string, unknown>)?.entities as unknown[]) ?? []);
    return (arr as unknown[]).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  }
  return [];
}

// 녹취 상세 → 미디어 다운로드 URL. download=true로 준비 요청, 202면 준비될 때까지 폴링.
async function getRecordingMediaUrl(cid: string, recordingId: string): Promise<string | null> {
  const url = `${HOST}/api/v2/conversations/${cid}/recordings/${recordingId}?formatId=${DEFAULT_FORMAT_ID}&download=true`;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const resp = await fetch(url, { headers: await authHeaders() });
    if (resp.status === 404) return null;
    if (TRANSIENT_STATUSES.has(resp.status)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const text = await resp.text();
    if (resp.status === 202 || !text.trim()) {
      await sleep(POLL_INTERVAL_MS); // 미디어 생성 중
      continue;
    }
    if (!resp.ok) throw new Error(`녹취 상세 조회 실패 (${resp.status}): ${text.slice(0, 300)}`);
    const urls = extractUrls(JSON.parse(text));
    if (urls.length) return urls[0];
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

/** conversation_id → 첫 번째 준비된 녹취의 미디어 URL(단건 직접). 없으면 throw. */
export async function getConversationAudioUrl(conversationId: string): Promise<string> {
  const cid = (conversationId ?? "").trim();
  if (!cid) throw new Error("conversation_id가 비어 있습니다.");

  const recordings = await listRecordings(cid);
  if (!recordings.length) throw new Error(`녹취를 찾을 수 없어요 (conversation ${cid}).`);

  const fileStateOf = (r: Record<string, unknown>) => String(r.fileState ?? "").toUpperCase();
  const available = recordings.filter((r) => !ARCHIVED_FILE_STATES.has(fileStateOf(r)));

  // AVAILABLE 녹취를 단건 직접 API로 확보 — 배치보다 훨씬 빠름.
  for (const rec of available) {
    const rid = rec.id ? String(rec.id) : "";
    if (!rid) continue;
    const url = await getRecordingMediaUrl(cid, rid);
    if (url) return url;
  }

  // 남은 게 아카이브뿐이면 복원이 필요해 즉시 평가 불가.
  if (available.length < recordings.length) {
    throw new Error(`이 통화의 녹취가 아카이브 상태라 즉시 평가할 수 없어요 (복원 필요) — conversation ${cid}.`);
  }
  throw new Error(`녹취 다운로드 URL을 받지 못했어요 (conversation ${cid}).`);
}

// ---------------------------------------------------------------------------
// 배치 잡 응답 파싱(순수 함수) + 배치 흐름 — 폴백(아카이브 복원/대량)
// ---------------------------------------------------------------------------
export function batchStatus(payload: Record<string, unknown>): string {
  const raw = payload.status ?? payload.state ?? payload.processingStatus ?? "";
  return String(raw).toUpperCase();
}

export function batchResultItems(payload: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["results", "entities", "recordings"]) {
    const items = payload[key];
    if (Array.isArray(items)) {
      return items.filter((i): i is Record<string, unknown> => !!i && typeof i === "object");
    }
  }
  return [];
}

function itemErrorMsg(item: Record<string, unknown>): string {
  return typeof item.errorMsg === "string" ? item.errorMsg : "";
}

/** 결과 항목들의 errorMsg 모음(있는 것만). */
export function batchErrorMessages(items: Record<string, unknown>[]): string[] {
  return items.map(itemErrorMsg).filter((m) => m.length > 0);
}

/**
 * 배치 잡이 끝났는지(모든 요청분이 URL 또는 에러로 종결) 판정.
 * 표준 응답엔 top-level status가 없고 resultCount/expectedResultCount로 완료를 알리므로 그걸 주 신호로 쓴다.
 */
export function isBatchComplete(payload: Record<string, unknown>): boolean {
  if (DONE_STATUSES.has(batchStatus(payload))) return true;

  const expected = numOrNull(payload.expectedResultCount);
  const resultCount = numOrNull(payload.resultCount);
  if (expected !== null && resultCount !== null) return resultCount >= expected;

  const items = batchResultItems(payload);
  if (items.length) return items.every((it) => extractUrls(it).length > 0 || itemErrorMsg(it).length > 0);
  return false;
}

// POST /api/v2/recording/batchrequests → job id. 배포/버전별 바디 스키마 차이 대비 표준형부터 순차 시도.
async function createBatchRequest(conversationIds: string[]): Promise<string> {
  const url = `${HOST}/api/v2/recording/batchrequests`;
  const headers = await authHeaders();
  const variants: Record<string, unknown>[] = [
    { batchDownloadRequestList: conversationIds.map((cid) => ({ conversationId: cid })) }, // Genesys 표준
    { requests: conversationIds.map((cid) => ({ conversationId: cid })) },
    { requestList: conversationIds.map((cid) => ({ conversationId: cid })) },
    { conversationIds },
  ];

  let lastSchemaError = "";
  for (const body of variants) {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (RETRYABLE_BODY_STATUSES.has(resp.status)) {
      lastSchemaError = `${resp.status}: ${await safeText(resp)}`;
      continue;
    }
    if (!resp.ok) throw new Error(`배치 요청 실패 (${resp.status}): ${await safeText(resp)}`);
    const data = (await resp.json()) as Record<string, unknown>;
    const id = (data.id ?? data.requestId) as string | number | undefined;
    if (!id) throw new Error(`배치 응답에 job id가 없어요: ${JSON.stringify(data).slice(0, 200)}`);
    return String(id);
  }
  throw new Error(`배치 요청을 서버가 인식하지 못했어요 (마지막 오류: ${lastSchemaError})`);
}

// GET /api/v2/recording/batchrequests/{id} 를 완료까지 폴링.
async function waitForBatch(requestId: string): Promise<Record<string, unknown>> {
  const url = `${HOST}/api/v2/recording/batchrequests/${requestId}`;
  const deadline = Date.now() + MAX_WAIT_MS;
  let last: Record<string, unknown> = {};

  while (Date.now() < deadline) {
    const resp = await fetch(url, { headers: await authHeaders() });
    if (TRANSIENT_STATUSES.has(resp.status)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (!resp.ok) throw new Error(`배치 상태 조회 실패 (${resp.status}): ${await safeText(resp)}`);

    const payload = (await resp.json()) as Record<string, unknown>;
    last = payload;

    if (FAILED_STATUSES.has(batchStatus(payload))) {
      throw new Error(`배치 작업 실패 (${requestId}): status=${batchStatus(payload)}`);
    }
    if (isBatchComplete(payload)) return payload;

    await sleep(POLL_INTERVAL_MS);
  }
  return last; // 시간 초과 — 호출부에서 URL 없으면 안내
}

/**
 * (폴백) 배치 다운로드 방식 — 아카이브 복원/대량용. Genesys 배치 큐 지연으로 수 분 걸릴 수 있어 기본 경로에선 미사용.
 */
export async function getConversationAudioUrlViaBatch(conversationId: string): Promise<string> {
  const cid = (conversationId ?? "").trim();
  if (!cid) throw new Error("conversation_id가 비어 있습니다.");

  const requestId = await createBatchRequest([cid]);
  const payload = await waitForBatch(requestId);
  const items = batchResultItems(payload);

  for (const item of items) {
    const urls = extractUrls(item);
    if (urls.length) return urls[0];
  }

  const errors = batchErrorMessages(items);
  if (errors.length) throw new Error(`녹취를 가져올 수 없어요 (conversation ${cid}, batch ${requestId}): ${errors.join("; ")}`);
  throw new Error(`배치로 녹취 URL을 받지 못했어요 (conversation ${cid}, batch ${requestId}).`);
}

/** 다운로드 URL에서 오디오 bytes를 받아온다. (Genesys가 준 URL은 보통 서명된 URL이라 별도 인증 불필요) */
export async function downloadAudio(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`오디오 다운로드 실패 (${resp.status}).`);
  const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("다운로드한 오디오가 비어 있어요.");
  return { bytes, contentType };
}

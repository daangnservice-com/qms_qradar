// Genesys Cloud 녹취 다운로드 클라이언트.
// conversation_id → OAuth(client_credentials) → recording API → 다운로드 URL → 오디오 bytes.
// 참고: github.com/daangnservice-com/genesys_recording_downloader (recording_download_links.py)의 단건(single) 흐름 이식.
// 대량 배치(/api/v2/recording/batchrequests)는 향후 확장 지점(다음 단계).

const HOST = process.env.GENESYS_HOST ?? "https://api.apne2.pure.cloud";
const TOKEN_HOST = process.env.GENESYS_TOKEN_HOST ?? "https://login.apne2.pure.cloud";

const DEFAULT_FORMAT_ID = "WEBM";
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 500);
  } catch {
    return "";
  }
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
    const single = o.downloadUri ?? o.mediaUri ?? o.resultUrl;
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
// 단건 Recording 흐름
// ---------------------------------------------------------------------------
async function listRecordingIds(conversationId: string): Promise<string[]> {
  const url = `${HOST}/api/v2/conversations/${conversationId}/recordings?formatId=${DEFAULT_FORMAT_ID}&download=true`;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const resp = await fetch(url, { headers: await authHeaders() });
    if (resp.status === 404) return [];
    if (resp.status === 202) {
      await sleep(POLL_INTERVAL_MS); // 미디어 생성 중
      continue;
    }
    if (!resp.ok) throw new Error(`Genesys recordings 조회 실패 (${resp.status}): ${await safeText(resp)}`);
    const data = (await resp.json()) as unknown;
    const list: unknown[] = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>)?.entities as unknown[]) ??
        ((data as Record<string, unknown>)?.recordings as unknown[]) ??
        [];
    const ids = list
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && "id" in r)
      .map((r) => String(r.id));
    if (ids.length) return ids;
    await sleep(POLL_INTERVAL_MS);
  }
  return [];
}

async function waitForRecordingUrl(conversationId: string, recordingId: string): Promise<string | null> {
  const url = `${HOST}/api/v2/conversations/${conversationId}/recordings/${recordingId}?formatId=${DEFAULT_FORMAT_ID}&download=true`;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const resp = await fetch(url, { headers: await authHeaders() });
    if (resp.status === 404) return null;
    if (resp.status === 202) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (!resp.ok) throw new Error(`Genesys recording 상세 조회 실패 (${resp.status}): ${await safeText(resp)}`);
    const data = (await resp.json()) as unknown;
    const urls = extractUrls(data);
    if (urls.length) return urls[0];
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

/** conversation_id → 첫 번째 준비된 녹취의 다운로드 URL. 없으면 throw. */
export async function getConversationAudioUrl(conversationId: string): Promise<string> {
  const cid = (conversationId ?? "").trim();
  if (!cid) throw new Error("conversation_id가 비어 있습니다.");

  const recordingIds = await listRecordingIds(cid);
  if (!recordingIds.length) throw new Error(`녹취를 찾을 수 없어요 (conversation ${cid}).`);

  for (const rid of recordingIds) {
    const url = await waitForRecordingUrl(cid, rid);
    if (url) return url;
  }
  throw new Error(`녹취 미디어가 아직 준비되지 않았어요 (conversation ${cid}).`);
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

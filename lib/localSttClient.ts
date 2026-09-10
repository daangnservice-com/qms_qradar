import { readFile } from "node:fs/promises";
import type { SttSegment } from "./stt";
import type { TranscriptSegment } from "./types";

/**
 * 로컬 STT 배치 서버 클라이언트.
 * 계약: integrations/INTEGRATION.md
 *
 * 동기 API가 아니다. 업로드는 job_id만 즉시 반환하고, 전사는 유휴(오프피크) 때 끝난다.
 * HTTP 핸들러 안에서 결과를 기다리지 말 것.
 */
const TERMINAL = new Set(["done", "failed", "canceled"]);

export function localSttBaseUrl(): string | null {
  const v = (process.env.LOCAL_STT_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return v || null;
}

export function localSttConfigured(): boolean {
  return localSttBaseUrl() != null;
}

/** Node fetch는 메시지가 "fetch failed"만 주고, ETIMEDOUT 등은 cause에 있다. */
export function formatFetchError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur != null; i++) {
    if (cur instanceof Error) {
      const code = (cur as Error & { code?: string }).code;
      const bit = [cur.name !== "Error" ? cur.name : null, cur.message, code]
        .filter(Boolean)
        .join(" ");
      if (bit && !parts.includes(bit)) parts.push(bit);
      cur = cur.cause;
    } else {
      const s = String(cur);
      if (s && !parts.includes(s)) parts.push(s);
      break;
    }
  }
  return parts.join(" ← ") || "unknown error";
}

function healthPath(): string {
  return process.env.LOCAL_STT_HEALTH_PATH?.trim() || "/v1/health";
}
function jobsPath(): string {
  return (process.env.LOCAL_STT_JOB_PATH?.trim() || process.env.LOCAL_STT_ENQUEUE_PATH?.trim() || "/v1/jobs").replace(
    /\/+$/,
    "",
  );
}
function controlPath(): string {
  return process.env.LOCAL_STT_CONTROL_PATH?.trim() || "/v1/control";
}

function apiKey(): string {
  return (
    process.env.LOCAL_STT_API_KEY?.trim() ||
    process.env.STT_API_KEY?.trim() ||
    process.env.LOCAL_STT_TOKEN?.trim() ||
    ""
  );
}

function authHeaders(): Record<string, string> {
  const key = apiKey();
  return key ? { "X-API-Key": key } : {};
}

function joinUrl(base: string, p: string): string {
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${base}${path}`;
}

async function readJson(resp: Response): Promise<Record<string, unknown> | null> {
  const text = await resp.text();
  if (!text.trim()) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 로컬 서버는 language "ko". GCP STT_LANGUAGE(ko-KR)를 그대로 넣으면 안 된다. */
export function localSttLanguage(): string {
  const raw = (process.env.LOCAL_STT_LANGUAGE ?? "").trim();
  if (raw) return raw;
  const gcp = (process.env.STT_LANGUAGE ?? "ko").trim();
  return gcp.split("-")[0]?.toLowerCase() || "ko";
}

export function localSttCallbackUrl(): string | null {
  const explicit = (process.env.LOCAL_STT_CALLBACK_URL ?? "").trim();
  if (explicit) return explicit;
  return null;
}

export function localSttCallbackSecret(): string {
  return (process.env.LOCAL_STT_CALLBACK_SECRET ?? "").trim();
}

export type LocalSttGate = {
  acceptingWork: boolean | null;
  reason: string | null;
  windowOpen: boolean | null;
  nextWindowAt: string | null;
  paused: boolean | null;
  overrideUntil: string | null;
  windows: string[] | null;
};

export type LocalSttHealth = {
  ok: boolean;
  queueDepth: number | null;
  busy: boolean | null;
  acceptingWork: boolean | null;
  reason: string | null;
  windowOpen: boolean | null;
  nextWindowAt: string | null;
  paused: boolean | null;
  overrideUntil: string | null;
  gpuUtilPct: number | null;
  gpuMemoryFreeMb: number | null;
  currentJobId: string | null;
  error: string | null;
  gate: LocalSttGate | null;
};

export function parseLocalSttGate(raw: unknown): LocalSttGate | null {
  const g = obj(raw);
  if (!g) return null;
  const windows = Array.isArray(g.windows) ? g.windows.map((w) => String(w)) : null;
  return {
    acceptingWork: bool(g.accepting_work),
    reason: str(g.reason),
    windowOpen: bool(g.window_open),
    nextWindowAt: str(g.next_window_at),
    paused: bool(g.paused),
    overrideUntil: str(g.override_until),
    windows,
  };
}

export function parseLocalSttHealth(body: Record<string, unknown> | null, httpOk: boolean): LocalSttHealth {
  const gate = parseLocalSttGate(body?.gate);
  const gpu = obj(body?.gpu);
  const queue = obj(body?.queue);
  const current = obj(body?.current_job);
  const queueDepth = num(queue?.queued ?? body?.queue_depth ?? body?.queueDepth ?? body?.queued);
  const ok = httpOk && (body?.status === "ok" || body?.ok === true || httpOk);
  const busy = current != null || bool(body?.busy) === true;
  return {
    ok,
    queueDepth,
    busy,
    acceptingWork: gate?.acceptingWork ?? bool(body?.accepting_work),
    reason: gate?.reason ?? str(body?.reason),
    windowOpen: gate?.windowOpen ?? null,
    nextWindowAt: gate?.nextWindowAt ?? str(body?.next_window_at),
    paused: gate?.paused ?? bool(body?.paused),
    overrideUntil: gate?.overrideUntil ?? null,
    gpuUtilPct: num(gpu?.utilization_pct),
    gpuMemoryFreeMb: num(gpu?.memory_free_mb),
    currentJobId: str(current?.id) ?? str(body?.current_job),
    error: httpOk ? null : str(body?.error ?? body?.detail) ?? "HTTP error",
    gate,
  };
}

export async function getLocalSttHealth(): Promise<LocalSttHealth> {
  const base = localSttBaseUrl();
  if (!base) {
    return {
      ok: false,
      queueDepth: null,
      busy: null,
      acceptingWork: null,
      reason: null,
      windowOpen: null,
      nextWindowAt: null,
      paused: null,
      overrideUntil: null,
      gpuUtilPct: null,
      gpuMemoryFreeMb: null,
      currentJobId: null,
      error: "LOCAL_STT_BASE_URL 미설정",
      gate: null,
    };
  }
  try {
    const resp = await fetch(joinUrl(base, healthPath()), {
      headers: { Accept: "application/json", ...authHeaders() },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const body = await readJson(resp);
    if (!resp.ok) {
      const parsed = parseLocalSttHealth(body, false);
      return { ...parsed, ok: false, error: parsed.error ?? `HTTP ${resp.status}` };
    }
    return parseLocalSttHealth(body, true);
  } catch (e) {
    return {
      ok: false,
      queueDepth: null,
      busy: null,
      acceptingWork: null,
      reason: null,
      windowOpen: null,
      nextWindowAt: null,
      paused: null,
      overrideUntil: null,
      gpuUtilPct: null,
      gpuMemoryFreeMb: null,
      currentJobId: null,
      error: formatFetchError(e),
      gate: null,
    };
  }
}

export type LocalSttEnqueueResult = {
  remoteJobId: string;
  status: string;
};

function enqueueCallbackUrl(): string | null {
  const url = localSttCallbackUrl();
  const secret = localSttCallbackSecret();
  if (!url || !secret) return null;
  const u = new URL(url);
  u.searchParams.set("secret", secret);
  return u.toString();
}

export async function enqueueLocalSttJob(input: {
  conversationId: string;
  audioPath: string;
  priority?: number;
}): Promise<LocalSttEnqueueResult> {
  const base = localSttBaseUrl();
  if (!base) throw new Error("LOCAL_STT_BASE_URL 미설정");

  const bytes = await readFile(input.audioPath);
  const options: Record<string, unknown> = {
    language: localSttLanguage(),
    channel_names: ["customer", "agent"],
    initial_prompt: "당근서비스 고객센터. 상담원과 고객의 통화 녹취입니다.",
  };

  const form = new FormData();
  const file = new File([new Uint8Array(bytes)], `${input.conversationId}.wav`, { type: "audio/wav" });
  form.append("file", file);
  form.append("options", JSON.stringify(options));
  form.append("client_ref", input.conversationId);
  form.append("priority", String(input.priority ?? 0));
  const callback = enqueueCallbackUrl();
  if (callback) form.append("callback_url", callback);

  const resp = await fetch(joinUrl(base, jobsPath()), {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const body = await readJson(resp);
  if (!resp.ok) {
    const msg = str(body?.error ?? body?.detail ?? body?.message) ?? `HTTP ${resp.status}`;
    throw new Error(`로컬 STT enqueue 실패: ${msg}`);
  }
  const remoteJobId = str(body?.id) ?? str(body?.job_id);
  if (!remoteJobId) throw new Error("로컬 STT가 job id를 반환하지 않았습니다");
  return {
    remoteJobId,
    status: str(body?.status) ?? "queued",
  };
}

/** 다시 올리지 않고 붙일 수 있는 원격 상태. failed·canceled·canceling은 재시도 대상이라 뺀다. */
const REUSABLE_REMOTE = ["done", "running", "queued"];

/**
 * 같은 conversation으로 로컬 STT에 이미 살아 있거나 끝난 잡이 있으면 그 id를 돌려준다.
 * 오디오를 다시 받고 올리는 비용을 아끼고, 같은 콜을 두 번 전사하지 않게 한다.
 */
export async function findReusableLocalSttJob(conversationId: string): Promise<LocalSttEnqueueResult | null> {
  const base = localSttBaseUrl();
  const cid = conversationId.trim();
  if (!base || !cid) return null;
  const url = `${joinUrl(base, jobsPath())}?client_ref=${encodeURIComponent(cid)}&limit=20`;
  const resp = await fetch(url, { headers: { ...authHeaders() }, signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) return null;
  return pickReusableLocalSttJob(await readJson(resp), cid);
}

/**
 * 목록 응답에서 재사용할 잡을 고른다. 끝난 잡 > 도는 잡 > 대기 잡.
 * client_ref 필터를 모르는 구버전 서버가 전체 목록을 줘도 안전하도록 client_ref를 다시 확인한다.
 */
export function pickReusableLocalSttJob(
  body: Record<string, unknown> | null,
  conversationId: string,
): LocalSttEnqueueResult | null {
  const list = body && Array.isArray(body.jobs) ? (body.jobs as unknown[]) : [];
  let best: { rank: number; id: string; status: string } | null = null;
  for (const raw of list) {
    const j = obj(raw);
    if (!j || str(j.client_ref) !== conversationId) continue;
    const id = str(j.id) ?? str(j.job_id);
    const status = (str(j.status) ?? "").toLowerCase();
    const rank = REUSABLE_REMOTE.indexOf(status);
    if (!id || rank < 0) continue;
    if (!best || rank < best.rank) best = { rank, id, status };
  }
  return best ? { remoteJobId: best.id, status: best.status } : null;
}

export type LocalSttRemoteStatus = "queued" | "running" | "done" | "failed" | "canceled" | "unknown";

export type LocalSttJobView = {
  status: LocalSttRemoteStatus;
  progress: number | null;
  stage: string | null;
  error: string | null;
  resultUrl: string | null;
  durationSec: number | null;
};

export function parseLocalSttJobStatus(raw: string | null): LocalSttRemoteStatus {
  const s = (raw ?? "queued").toLowerCase();
  if (s === "done" || s === "completed" || s === "succeeded") return "done";
  if (s === "failed" || s === "error") return "failed";
  if (s === "canceled" || s === "cancelled") return "canceled";
  if (s === "running" || s === "processing" || s === "canceling") return "running";
  if (s === "queued" || s === "pending") return "queued";
  return "unknown";
}

export function parseLocalSttJobView(body: Record<string, unknown> | null): LocalSttJobView {
  return {
    status: parseLocalSttJobStatus(str(body?.status)),
    progress: num(body?.progress),
    stage: str(body?.stage),
    error: str(body?.error),
    resultUrl: str(body?.result_url),
    durationSec: num(body?.duration_sec),
  };
}

export async function cancelLocalSttJob(remoteJobId: string): Promise<void> {
  const base = localSttBaseUrl();
  if (!base) throw new Error("LOCAL_STT_BASE_URL 미설정");
  const id = remoteJobId.trim();
  if (!id) return;
  const resp = await fetch(joinUrl(base, `${jobsPath()}/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: { Accept: "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(15_000),
  });
  if (resp.ok || resp.status === 404) return;
  const body = await readJson(resp);
  const msg = str(body?.error ?? body?.detail ?? body?.message) ?? `HTTP ${resp.status}`;
  throw new Error(`로컬 STT 취소 실패: ${msg}`);
}

export async function listLocalSttJobIds(status: string): Promise<string[]> {
  const base = localSttBaseUrl();
  if (!base) throw new Error("LOCAL_STT_BASE_URL 미설정");
  const ids: string[] = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const q = `?status=${encodeURIComponent(status)}&limit=${limit}&offset=${offset}`;
    const resp = await fetch(joinUrl(base, `${jobsPath()}${q}`), {
      headers: { Accept: "application/json", ...authHeaders() },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readJson(resp);
    if (!resp.ok) break;
    const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
    for (const item of jobs) {
      const o = obj(item);
      const id = str(o?.id) ?? str(o?.job_id);
      if (id) ids.push(id);
    }
    if (jobs.length < limit) break;
    offset += jobs.length;
    if (offset > 5000) break;
  }
  return ids;
}

export async function getLocalSttJob(remoteJobId: string): Promise<LocalSttJobView> {
  const base = localSttBaseUrl();
  if (!base) throw new Error("LOCAL_STT_BASE_URL 미설정");
  const resp = await fetch(joinUrl(base, `${jobsPath()}/${encodeURIComponent(remoteJobId)}`), {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readJson(resp);
  if (!resp.ok) {
    return {
      status: resp.status === 404 ? "unknown" : "failed",
      progress: null,
      stage: null,
      error: str(body?.error ?? body?.detail ?? body?.message) ?? `HTTP ${resp.status}`,
      resultUrl: null,
      durationSec: null,
    };
  }
  return parseLocalSttJobView(body);
}

export type LocalSttResult = {
  segments: SttSegment[];
  transcript: TranscriptSegment[];
  durationSec: number;
  language: string | null;
};

/** agent=상담원(tag 1), customer=고객(tag 2). 이름 없으면 enqueue channel_names 순서(ch0=customer, ch1=agent). */
export function speakerToTag(speaker: string, channel: number): number {
  const s = speaker.trim().toLowerCase();
  if (s === "agent" || s === "상담원") return 1;
  if (s === "customer" || s === "고객") return 2;
  return channel === 0 ? 2 : 1;
}

export function speakerToLabel(speaker: string, channel: number): string {
  const tag = speakerToTag(speaker, channel);
  return tag === 1 ? "상담원" : tag === 2 ? "고객" : `화자 ${tag}`;
}

export function parseLocalSttResult(body: Record<string, unknown> | null): LocalSttResult {
  const durationSec = num(obj(body?.audio)?.duration_sec) ?? num(body?.duration_sec) ?? 0;
  const language = str(body?.language);
  const rawSegs = Array.isArray(body?.segments) ? body.segments : [];
  const segments: SttSegment[] = [];
  const transcript: TranscriptSegment[] = [];
  for (const item of rawSegs) {
    const o = obj(item);
    if (!o) continue;
    const text = str(o.text) ?? "";
    if (!text) continue;
    const atSec = num(o.start) ?? 0;
    const endSec = num(o.end) ?? atSec;
    const channel = num(o.channel) ?? 0;
    const speaker = str(o.speaker) ?? "";
    const speakerTag = speakerToTag(speaker, channel);
    segments.push({ atSec, endSec, speakerTag, text });
    transcript.push({ atSec, speaker: speakerToLabel(speaker, channel), text });
  }
  segments.sort((a, b) => a.atSec - b.atSec);
  transcript.sort((a, b) => a.atSec - b.atSec);
  return { segments, transcript, durationSec, language };
}

export function isTerminalSttStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export async function getLocalSttResult(remoteJobId: string): Promise<LocalSttResult> {
  const base = localSttBaseUrl();
  if (!base) throw new Error("LOCAL_STT_BASE_URL 미설정");
  const resp = await fetch(joinUrl(base, `${jobsPath()}/${encodeURIComponent(remoteJobId)}/result`), {
    headers: { Accept: "application/json", ...authHeaders() },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(resp);
  if (resp.status === 409) {
    throw new Error("STT 결과가 아직 준비되지 않았습니다");
  }
  if (resp.status === 410) {
    throw new Error("STT 결과 파일이 삭제되었습니다. 재제출이 필요합니다");
  }
  if (!resp.ok) {
    const msg = str(body?.error ?? body?.detail ?? body?.message) ?? `HTTP ${resp.status}`;
    throw new Error(`로컬 STT 결과 조회 실패: ${msg}`);
  }
  return parseLocalSttResult(body);
}

export async function controlLocalStt(input: {
  overrideMinutes?: number;
  pause?: boolean;
}): Promise<LocalSttGate> {
  const base = localSttBaseUrl();
  if (!base) throw new Error("LOCAL_STT_BASE_URL 미설정");
  const payload: Record<string, unknown> = {};
  if (input.overrideMinutes != null) payload.override_minutes = input.overrideMinutes;
  if (input.pause != null) payload.pause = input.pause;
  const resp = await fetch(joinUrl(base, controlPath()), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await readJson(resp);
  if (!resp.ok) {
    const msg = str(body?.error ?? body?.detail ?? body?.message) ?? `HTTP ${resp.status}`;
    throw new Error(`로컬 STT control 실패: ${msg}`);
  }
  return parseLocalSttGate(body) ?? parseLocalSttGate(body?.gate) ?? {
    acceptingWork: bool(body?.accepting_work),
    reason: str(body?.reason),
    windowOpen: bool(body?.window_open),
    nextWindowAt: str(body?.next_window_at),
    paused: bool(body?.paused),
    overrideUntil: str(body?.override_until),
    windows: null,
  };
}

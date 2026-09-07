/**
 * 배치 로컬 STT vs 기존 GCP Speech 파이프라인 비교.
 * 배치가 끝난 콜의 오디오를 GCP STT에 다시 넣어 같은 콜을 맞춘다.
 *
 * Usage: npx tsx scripts/compare-stt-pipelines.ts [--limit 30] [--concurrency 2]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const OUT_DIR = resolve(process.cwd(), ".data", "stt-compare");
const GCP_DIR = resolve(OUT_DIR, "gcp");
const REPORT_PATH = resolve(OUT_DIR, "report.json");

type Seg = { atSec: number; speaker: string; text: string };

function argNum(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeText(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[.,!?~…·\-–—'"`“”‘’()[\]{}<>]/g, "")
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function cer(hyp: string, ref: string): number | null {
  const h = normalizeText(hyp);
  const r = normalizeText(ref);
  if (!r.length && !h.length) return 0;
  if (!r.length) return 1;
  return levenshtein(h, r) / r.length;
}

function joinText(segs: Seg[]): string {
  return segs.map((s) => s.text).join(" ");
}

function joinSpeaker(segs: Seg[], speaker: string): string {
  return segs
    .filter((s) => s.speaker === speaker)
    .map((s) => s.text)
    .join(" ");
}

function swapSpeaker(speaker: string): string {
  if (speaker === "상담원") return "고객";
  if (speaker === "고객") return "상담원";
  return speaker;
}

function swapped(segs: Seg[]): Seg[] {
  return segs.map((s) => ({ ...s, speaker: swapSpeaker(s.speaker) }));
}

function speakerShare(segs: Seg[]): { agent: number; customer: number } {
  let agent = 0;
  let customer = 0;
  for (const s of segs) {
    const n = s.text.length;
    if (s.speaker === "상담원") agent += n;
    else if (s.speaker === "고객") customer += n;
  }
  const tot = agent + customer || 1;
  return { agent: agent / tot, customer: customer / tot };
}

function overlapSec(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function speakerAgreePct(local: Seg[], gcp: Seg[]): number | null {
  if (!local.length || !gcp.length) return null;
  const localEnds = local.map((s, i) => {
    const next = local[i + 1]?.atSec;
    const guessed = s.atSec + Math.max(0.4, (s.text.length || 0) * 0.08);
    return next != null && next > s.atSec ? next : guessed;
  });
  const gcpEnds = gcp.map((s, i) => {
    const next = gcp[i + 1]?.atSec;
    const guessed = s.atSec + Math.max(0.4, (s.text.length || 0) * 0.08);
    return next != null && next > s.atSec ? next : guessed;
  });
  let overlap = 0;
  let agree = 0;
  for (let i = 0; i < local.length; i++) {
    for (let j = 0; j < gcp.length; j++) {
      const o = overlapSec(local[i].atSec, localEnds[i], gcp[j].atSec, gcpEnds[j]);
      if (o <= 0) continue;
      overlap += o;
      if (local[i].speaker && gcp[j].speaker && local[i].speaker === gcp[j].speaker) agree += o;
    }
  }
  if (overlap <= 0) return null;
  return agree / overlap;
}

function excerpt(segs: Seg[], n = 3): string {
  return segs
    .slice(0, n)
    .map((s) => `[${s.speaker} ${s.atSec.toFixed(1)}s] ${s.text}`)
    .join(" / ");
}

function listBatchTranscriptIds(): string[] {
  const dir = resolve(process.cwd(), ".data", "stt-batch", "transcripts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

type GcpCache = {
  conversationId: string;
  durationSec: number;
  model: string;
  language: string;
  transcribedAt: string;
  transcript: Seg[];
};

type Row = {
  conversationId: string;
  durationSec: number;
  localSegs: number;
  gcpSegs: number;
  localChars: number;
  gcpChars: number;
  cer: number | null;
  cerSwapped: number | null;
  bestCer: number | null;
  speakerSwapBetter: boolean;
  speakerAgree: number | null;
  speakerAgreeSwapped: number | null;
  agentShareLocal: number;
  agentShareGcp: number;
  gcpSource: "cache" | "fresh" | "bq";
  gcpModel: string;
  localExcerpt: string;
  gcpExcerpt: string;
  error?: string;
};

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const limit = argNum("--limit", 30);
  const concurrency = argNum("--concurrency", 2);
  const waitMs = argNum("--wait-ms", 20 * 60_000);
  mkdirSync(GCP_DIR, { recursive: true });

  const { harvestSttBatchJobs } = await import("../lib/sttBatchRunner");
  const { getLatestBatchTranscript } = await import("../lib/sttBatchStore");
  const { getLatestStoredTranscript } = await import("../lib/evalResultStore");
  const { transcribeCall, mapSpeaker } = await import("../lib/stt");
  const { ensureLocalQaAudio, removeLocalQaAudio, cleanupPaths } = await import("../lib/qaAudio");

  const rowsById = new Map<string, Row>();
  if (existsSync(REPORT_PATH)) {
    try {
      const prev = readJson<{ rows?: Row[] }>(REPORT_PATH);
      for (const r of prev.rows ?? []) {
        if (!r.error) rowsById.set(r.conversationId, r);
      }
    } catch {
      /* ignore */
    }
  }

  const bqHits: string[] = [];

  async function gcpTranscript(cid: string): Promise<{ segs: Seg[]; model: string; source: Row["gcpSource"] }> {
    const cachePath = resolve(GCP_DIR, `${cid}.json`);
    if (existsSync(cachePath)) {
      const cached = readJson<GcpCache>(cachePath);
      return { segs: cached.transcript, model: cached.model, source: "cache" };
    }

    let stored: Awaited<ReturnType<typeof getLatestStoredTranscript>> = null;
    try {
      stored = await getLatestStoredTranscript(cid);
    } catch (e) {
      console.warn(`[compare] BQ lookup ${cid}:`, e instanceof Error ? e.message : e);
    }
    if (stored?.transcript.length) bqHits.push(cid);

    const audio = await ensureLocalQaAudio(cid);
    try {
      const out = await transcribeCall(audio.wavPath);
      const diarized = new Set(out.segments.map((s) => s.speakerTag)).size > 1;
      const transcript: Seg[] = out.segments.map((s) => ({
        atSec: s.atSec,
        speaker: diarized ? mapSpeaker(s.speakerTag, 1) : "",
        text: s.text,
      }));
      const payload: GcpCache = {
        conversationId: cid,
        durationSec: out.durationSec,
        model: out.model,
        language: out.language,
        transcribedAt: new Date().toISOString(),
        transcript,
      };
      writeFileSync(cachePath, JSON.stringify(payload), "utf8");
      return { segs: transcript, model: out.model, source: "fresh" };
    } finally {
      await removeLocalQaAudio(cid);
      await cleanupPaths(audio.tempPaths);
    }
  }

  async function compareOne(cid: string): Promise<void> {
    if (rowsById.has(cid)) {
      console.log(`[compare] skip cached ${cid}`);
      return;
    }
    const t0 = Date.now();
    console.log(`[compare] start ${cid}`);
    try {
      const local = await getLatestBatchTranscript(cid);
      if (!local?.transcript.length) throw new Error("배치 transcript 없음");
      const gcp = await gcpTranscript(cid);
      const localSegs = local.transcript;
      const gcpSegs = gcp.segs;
      const cerPlain = cer(joinText(localSegs), joinText(gcpSegs));
      const localSwap = swapped(localSegs);
      const cerAgent = cer(joinSpeaker(localSegs, "상담원"), joinSpeaker(gcpSegs, "상담원"));
      const cerAgentSwap = cer(joinSpeaker(localSwap, "상담원"), joinSpeaker(gcpSegs, "상담원"));
      const swapBetter =
        cerAgentSwap != null && (cerAgent == null || cerAgentSwap + 0.02 < cerAgent);
      const agree = speakerAgreePct(localSegs, gcpSegs);
      const agreeSwap = speakerAgreePct(localSwap, gcpSegs);
      const shareL = speakerShare(localSegs);
      const shareG = speakerShare(gcpSegs);
      const row: Row = {
        conversationId: cid,
        durationSec: local.durationSec,
        localSegs: localSegs.length,
        gcpSegs: gcpSegs.length,
        localChars: joinText(localSegs).length,
        gcpChars: joinText(gcpSegs).length,
        cer: cerPlain,
        cerSwapped: cer(joinText(localSwap), joinText(gcpSegs)),
        bestCer: cerPlain,
        speakerSwapBetter: swapBetter || (agreeSwap != null && agree != null && agreeSwap > agree + 0.1),
        speakerAgree: agree,
        speakerAgreeSwapped: agreeSwap,
        agentShareLocal: shareL.agent,
        agentShareGcp: shareG.agent,
        gcpSource: gcp.source,
        gcpModel: gcp.model,
        localExcerpt: excerpt(localSegs),
        gcpExcerpt: excerpt(gcpSegs),
      };
      rowsById.set(cid, row);
      console.log(
        `[compare] done ${cid} ${((Date.now() - t0) / 1000).toFixed(0)}s cer=${cerPlain?.toFixed(3)} swapSpeak=${row.speakerSwapBetter} segs=${localSegs.length}/${gcpSegs.length}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rowsById.set(cid, {
        conversationId: cid,
        durationSec: 0,
        localSegs: 0,
        gcpSegs: 0,
        localChars: 0,
        gcpChars: 0,
        cer: null,
        cerSwapped: null,
        bestCer: null,
        speakerSwapBetter: false,
        speakerAgree: null,
        speakerAgreeSwapped: null,
        agentShareLocal: 0,
        agentShareGcp: 0,
        gcpSource: "fresh",
        gcpModel: "",
        localExcerpt: "",
        gcpExcerpt: "",
        error: msg,
      });
      console.warn(`[compare] fail ${cid}:`, msg);
    }
  }

  const started = Date.now();
  while (true) {
    await harvestSttBatchJobs().catch(() => 0);
    const ids = listBatchTranscriptIds();
    const pending = ids.filter((id) => !rowsById.has(id)).slice(0, Math.max(0, limit - [...rowsById.values()].filter((r) => !r.error).length));
    const okCount = [...rowsById.values()].filter((r) => !r.error).length;
    console.log(`[compare] transcripts=${ids.length} comparedOk=${okCount} pendingThisRound=${pending.length}`);
    if (pending.length) await mapPool(pending, concurrency, compareOne);

    const report = buildReport([...rowsById.values()], { limit, bqHits, gcpModelHint: process.env.STT_MODEL ?? "latest_long" });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

    const ok = [...rowsById.values()].filter((r) => !r.error).length;
    if (ok >= limit) break;
    if (Date.now() - started > waitMs && ids.length > 0 && pending.length === 0) {
      console.warn(`[compare] wait timeout with ${ok} ok rows (target ${limit})`);
      break;
    }
    if (Date.now() - started > waitMs + 10 * 60_000) break;
    await sleep(20_000);
  }

  const report = buildReport([...rowsById.values()], { limit, bqHits, gcpModelHint: process.env.STT_MODEL ?? "latest_long" });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`[compare] wrote ${REPORT_PATH} ok=${report.okCount} fail=${report.failCount} meanCer=${report.meanCer}`);
}

function mean(xs: Array<number | null | undefined>): number | null {
  const v = xs.filter((n): n is number => n != null && Number.isFinite(n));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function buildReport(all: Row[], meta: { limit: number; bqHits: string[]; gcpModelHint: string }) {
  const ok = all.filter((r) => !r.error);
  const fail = all.filter((r) => r.error);
  const swapN = ok.filter((r) => r.speakerSwapBetter).length;
  const sorted = [...ok].sort((a, b) => (a.cer ?? 1) - (b.cer ?? 1));
  return {
    generatedAt: new Date().toISOString(),
    limit: meta.limit,
    okCount: ok.length,
    failCount: fail.length,
    bqOverlapCount: meta.bqHits.length,
    gcpModel: meta.gcpModelHint,
    meanCer: mean(ok.map((r) => r.cer)),
    meanSpeakerAgree: mean(ok.map((r) => r.speakerAgree)),
    meanSpeakerAgreeSwapped: mean(ok.map((r) => r.speakerAgreeSwapped)),
    speakerSwapBetterPct: ok.length ? swapN / ok.length : 0,
    meanLocalSegs: mean(ok.map((r) => r.localSegs)),
    meanGcpSegs: mean(ok.map((r) => r.gcpSegs)),
    meanDurationSec: mean(ok.map((r) => r.durationSec)),
    meanCharRatio: mean(ok.filter((r) => r.gcpChars > 0).map((r) => r.localChars / r.gcpChars)),
    best: sorted.slice(0, 3).map(summarizeRow),
    worst: sorted.slice(-3).reverse().map(summarizeRow),
    rows: all,
  };
}

function summarizeRow(r: Row) {
  return {
    conversationId: r.conversationId,
    durationSec: r.durationSec,
    cer: r.cer,
    speakerAgree: r.speakerAgree,
    speakerAgreeSwapped: r.speakerAgreeSwapped,
    speakerSwapBetter: r.speakerSwapBetter,
    localSegs: r.localSegs,
    gcpSegs: r.gcpSegs,
    localExcerpt: r.localExcerpt,
    gcpExcerpt: r.gcpExcerpt,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from "node:fs";

const p = ".data/stt-batch/state.json";
const raw = readFileSync(p, "utf8");
console.log("len", raw.length);
console.log("start", JSON.stringify(raw.slice(0, 60)));
console.log("end", JSON.stringify(raw.slice(-60)));

let depth = 0;
let inStr = false;
let esc = false;
let firstEnd = -1;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (inStr) {
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') {
    inStr = true;
    continue;
  }
  if (c === "{") depth++;
  if (c === "}") {
    depth--;
    if (depth === 0) {
      firstEnd = i;
      break;
    }
  }
}
console.log("firstEnd", firstEnd);
if (firstEnd < 0) throw new Error("no complete json object");

function summarize(label: string, a: { schedules?: unknown[]; jobs?: { status: string }[]; runs?: { callDate: string; status: string; selectedCount: number }[] }) {
  const by: Record<string, number> = {};
  for (const j of a.jobs ?? []) by[j.status] = (by[j.status] ?? 0) + 1;
  console.log(label, {
    schedules: (a.schedules ?? []).length,
    jobs: (a.jobs ?? []).length,
    runs: (a.runs ?? []).length,
    jobStatus: by,
    runsSummary: (a.runs ?? []).map((r) => `${r.callDate}:${r.status}:sel${r.selectedCount}`),
  });
}

const first = JSON.parse(raw.slice(0, firstEnd + 1));
summarize("first", first);

const rest = raw.slice(firstEnd + 1).replace(/^\uFEFF/, "").trim();
console.log("restLen", rest.length, "restStart", JSON.stringify(rest.slice(0, 40)));

let second: typeof first | null = null;
if (rest.startsWith("{")) {
  try {
    second = JSON.parse(rest);
    summarize("second", second);
  } catch (e) {
    console.log("second parse fail", e instanceof Error ? e.message.slice(0, 180) : e);
  }
}

const tdir = ".data/stt-batch/transcripts";
const tcount = existsSync(tdir) ? readdirSync(tdir).filter((f) => f.endsWith(".json")).length : 0;
console.log("transcriptFiles", tcount);

const best = [first, second].filter(Boolean).sort((a, b) => (b!.jobs?.length ?? 0) - (a!.jobs?.length ?? 0))[0];
if (!best) throw new Error("nothing to restore");
copyFileSync(p, `.data/stt-batch/state.corrupt.${Date.now()}.json`);
writeFileSync(p, JSON.stringify(best, null, 2), "utf8");
summarize("restored", best);

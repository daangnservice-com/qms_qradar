/**
 * GAS qa_distribution 스프레드시트 → ds_qradar_{dev|prod} 테이블 적재.
 *
 * Spreadsheet:
 *   https://docs.google.com/spreadsheets/d/1zVtfyduiNpZ0Ro3ZLiDRw4662IxXOufDESFrTHvyAxw
 *
 * Usage:
 *   # 1) Sheets 스코프 포함 ADC (최초 1회, 브라우저 로그인)
 *   gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets.readonly,https://www.googleapis.com/auth/drive.readonly
 *
 *   # 2) dry-run (탭·행수만)
 *   npx tsx scripts/migrate-dist-sheets-to-bq.ts --target=dev --dry-run
 *
 *   # 3) 적재 (테이블 WRITE_TRUNCATE)
 *   npx tsx scripts/migrate-dist-sheets-to-bq.ts --target=dev
 *   npx tsx scripts/migrate-dist-sheets-to-bq.ts --target=dev --only=평가대상자,history
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { BigQuery } from "@google-cloud/bigquery";
import { GoogleAuth } from "google-auth-library";

const SPREADSHEET_ID = "1zVtfyduiNpZ0Ro3ZLiDRw4662IxXOufDESFrTHvyAxw";

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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

function argFlag(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

const dryRun = process.argv.includes("--dry-run");
const targetArg = (argFlag("target") ?? process.env.BQ_TARGET ?? "dev").toLowerCase();
const target = targetArg === "prod" ? "prod" : "dev";
process.env.BQ_TARGET = target;
delete process.env.QRADAR_DATASET;

const onlyArg = argFlag("only");
const onlySet = onlyArg
  ? new Set(
      onlyArg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

/** 시트 헤더(한글/영문) → BQ 컬럼명 */
const HEADER_MAP: Record<string, Record<string, string>> = {
  config: { "": "key" }, // special: col0=key, col1=value — handled below
  aqt: { 채널: "channel", 기준AQT: "aqt_minutes" },
  teams: {
    팀ID: "team_id",
    팀ON: "team_on",
    팀명: "team_name",
    담당평가자: "evaluator_name",
    인원: "headcount",
    CS모드: "cs_mode",
    난이도: "difficulty",
    "COLD%": "cold_pct",
    채널명: "channel_name",
    채널ON: "channel_on",
    AQT: "aqt",
    "직무to-be": "job_to_be",
    "CSto-be": "cs_to_be",
    비고: "note",
  },
  gps: {
    평가자명: "evaluator_name",
    일가용h: "avail_hours",
    "버퍼%": "buffer_pct",
    CS참여: "cs_participate",
    "배분비율%": "ratio_pct",
    비율고정: "ratio_locked",
  },
  history: {
    평가월: "eval_month",
    월: "eval_month",
    확정자: "confirmed_by",
    확정시각: "confirmed_at",
    CS총건수: "total_cs",
    전월중복: "prev_repeats",
    /** 시트 오타(전원중복) — 의미는 전월 중복 */
    전원중복: "prev_repeats",
    "±5충족": "within_pm5",
    "±5%p충족": "within_pm5",
    result: "result_json",
    결과JSON: "result_json",
    ratios: "ratios_json",
    비율JSON: "ratios_json",
    이력ID: "history_id",
    meta: "meta_json",
  },
  history_detail: {
    평가월: "eval_month",
    월: "eval_month",
    GP: "evaluator_name",
    평가자: "evaluator_name",
    팀: "team_name",
    팀명: "team_name",
    채널: "channel",
    CS: "cs",
    CS건수: "cs",
    구분: "unit_type",
    유형: "unit_type",
    전화여부: "is_phone",
    전월중복: "is_repeat",
    이력ID: "history_id",
    사번: "member_id",
    영문명: "member_name",
  },
  eval_items: { 항목: "item" },
  월확정: {
    평가월: "eval_month",
    확정자: "confirmed_by",
    확정시각: "confirmed_at",
  },
  평가대상자: {
    평가월: "eval_month",
    사번: "employee_id",
    영문명: "name_en",
    팀: "team_name",
    파트: "part",
    레벨: "level",
    고용구분: "employment_type",
    재직상태: "status",
    입사일: "hire_date",
    계약전환일: "convert_date",
    퇴사일: "exit_date",
    자동판정: "auto_judge",
    수동조정: "manual_judge",
    최종판정: "final_judge",
    "비고(자동)": "auto_note",
    "메모(수기)": "memo",
    수정자: "edited_by",
    수정시각: "edited_at",
    평가항목: "eval_items",
  },
  평가대상자_이력: {
    평가월: "eval_month",
    사번: "employee_id",
    영문명: "name_en",
    팀: "team_name",
    파트: "part",
    레벨: "level",
    최종판정: "final_judge",
    자동판정: "auto_judge",
    수동조정: "manual_judge",
    비고: "auto_note",
    메모: "memo",
    평가항목: "eval_items",
    수정자: "edited_by",
    수정시각: "edited_at",
    확정자: "confirmed_by",
    확정시각: "confirmed_at",
  },
  재직자_RAW: {
    사번: "employee_id",
    이름: "name_ko",
    영문명: "name_en",
    팀: "team_name",
    파트: "part",
    레벨: "level",
    고용구분: "employment_type",
    재직상태: "status",
    근속기간: "tenure",
    입사일: "hire_date",
    계약전환일: "convert_date",
    퇴사일: "exit_date",
    계약만료일: "contract_end_date",
  },
  "팀별 COLD Count": {
    년월: "eval_month",
    팀명: "team_name",
    평가모수: "eval_count",
    COLD건수: "cold_count",
    "COLD 건수": "cold_count",
  },
};

const SNAPSHOT_COLS = [
  "eval_month",
  "employee_id",
  "name_en",
  "team_name",
  "part",
  "level",
  "final_judge",
  "auto_judge",
  "manual_judge",
  "auto_note",
  "memo",
  "eval_items",
  "edited_by",
  "edited_at",
  "confirmed_by",
  "confirmed_at",
] as const;

const HISTORY_DETAIL_COLS = [
  "eval_month",
  "evaluator_name",
  "team_name",
  "channel",
  "cs",
  "unit_type",
  "is_phone",
  "is_repeat",
  "history_id",
  "member_id",
  "member_name",
] as const;

function toSnakeField(raw: string, idx: number): string {
  const trimmed = String(raw ?? "").trim();
  // Keep ASCII identifiers; korean/symbols → positional fallback to avoid `c___`
  const ascii = trimmed
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (ascii && /^[a-z]/.test(ascii)) return ascii;
  return `col_${idx}`;
}

function mapHeaders(sheetName: string, headers: string[]): string[] {
  const map =
    HEADER_MAP[sheetName] ??
    (sheetName === "재직자_RAW" || sheetName === "재직자_raw" || sheetName === "재직자 RAW"
      ? HEADER_MAP["재직자_RAW"]
      : {}) ??
    {};
  if (sheetName === "config") return ["key", "value"];
  return headers.map((h, i) => {
    const key = String(h).trim();
    return map[key] ?? toSnakeField(key, i);
  });
}

async function getSheetsToken(): Promise<string> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/cloud-platform",
  ];
  const auth = new GoogleAuth({
    credentials: saJson ? (JSON.parse(saJson) as object) : undefined,
    scopes,
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("no access token for Sheets");
  return token.token;
}

async function sheetsGet(path: string, token: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`;
  const quotaProject =
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT?.trim() ||
    process.env.GROWTH_CULTURE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() ||
    "data-proj-470202";
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": quotaProject,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 403 && text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
        ? "\n→ Re-login ADC with Sheets scopes (see script header comment)."
        : res.status === 403 && text.includes("quota project")
          ? "\n→ Set quota project: gcloud auth application-default set-quota-project data-proj-470202"
          : "";
    throw new Error(`${res.status} ${path}: ${text.slice(0, 400)}${hint}`);
  }
  return JSON.parse(text) as unknown;
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

async function loadSheetValues(sheetName: string, token: string): Promise<string[][]> {
  const enc = encodeURIComponent(`'${sheetName}'`);
  const data = (await sheetsGet(`/values/${enc}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, token)) as {
    values?: unknown[][];
  };
  return (data.values ?? []).map((row) => row.map(cellStr));
}

async function main() {
  const { gcpClientAuth } = await import("../lib/gcpCredentials");
  const { distBq, DIST_SHEET_TO_TABLE, bqRefsSummary } = await import("../lib/bqRefs");

  console.log(bqRefsSummary());
  console.log(`migrate dist sheets → ${distBq.dataset} dryRun=${dryRun}`);

  const token = await getSheetsToken();
  const meta = (await sheetsGet("?fields=properties.title,sheets.properties.title", token)) as {
    properties: { title: string };
    sheets: Array<{ properties: { title: string } }>;
  };
  console.log("spreadsheet:", meta.properties.title);
  const titles = new Set(meta.sheets.map((s) => s.properties.title));

  const bq = new BigQuery({
    projectId: distBq.projectId,
    ...gcpClientAuth(),
  });
  const location = distBq.location || "US";
  const ingestedAt = new Date().toISOString();

  for (const [sheetName, tableKey] of Object.entries(DIST_SHEET_TO_TABLE)) {
    if (onlySet && !onlySet.has(sheetName)) continue;
    const tableName = distBq.tables[tableKey];
    if (!titles.has(sheetName)) {
      console.warn(`SKIP missing sheet: ${sheetName}`);
      continue;
    }

    const values = await loadSheetValues(sheetName, token);
    if (!values.length) {
      console.warn(`SKIP empty: ${sheetName}`);
      continue;
    }

    let headers: string[];
    let body: string[][];
    if (sheetName === "history_detail") {
      const h0 = String(values[0]?.[0] ?? "").trim();
      const looksHeader =
        h0 === "평가월" ||
        h0 === "월" ||
        /^eval[_ ]?month$/i.test(h0) ||
        h0 === "GP" ||
        h0 === "평가자";
      if (looksHeader) {
        headers = mapHeaders(sheetName, values[0].map(String));
        body = values.slice(1);
      } else {
        // GAS appendRow legacy (11 cols, no header)
        headers = [...HISTORY_DETAIL_COLS];
        body = values;
      }
    } else if (sheetName === "config") {
      // config sheet has no header row — first row is already key/value
      headers = ["key", "value"];
      body = values.map((r) => [cellStr(r[0]), cellStr(r[1])]).filter((r) => r[0]);
    } else if (sheetName === "평가대상자_이력") {
      const h0 = (values[0] ?? []).map((c) => String(c).trim());
      if (h0.includes("평가항목")) {
        headers = mapHeaders(sheetName, values[0].map(String));
        body = values.slice(1);
      } else {
        // 헤더에 평가항목이 없으면 GAS 16열 positional (평가항목이 수정자 자리로 밀림)
        headers = [...SNAPSHOT_COLS];
        body = values.slice(1);
      }
    } else if (sheetName === "평가대상자") {
      headers = mapHeaders(sheetName, values[0].map(String));
      if (!headers.includes("eval_items")) headers = [...headers, "eval_items"];
      body = values.slice(1);
    } else {
      headers = mapHeaders(sheetName, values[0].map(String));
      body = values.slice(1);
    }

    // dedupe header names
    const seen = new Map<string, number>();
    headers = headers.map((h) => {
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      return n === 1 ? h : `${h}_${n}`;
    });

    const rows = body
      .filter((r) => r.some((c) => String(c).trim() !== ""))
      .map((r) => {
        const obj: Record<string, string> = { _ingested_at: ingestedAt, _source_sheet: sheetName };
        headers.forEach((h, i) => {
          obj[h] = cellStr(r[i] ?? "");
        });
        return obj;
      });

    console.log(
      `${dryRun ? "[dry-run] " : ""}[${sheetName}] → ${distBq.dataset}.${tableName} rows=${rows.length} cols=${headers.length}`,
    );
    console.log(`  cols: ${headers.join(", ")}`);

    if (dryRun) continue;

    const schema = [
      ...headers.map((name) => ({ name, type: "STRING" as const })),
      { name: "_ingested_at", type: "TIMESTAMP" as const },
      { name: "_source_sheet", type: "STRING" as const },
    ];

    const dataset = bq.dataset(distBq.dataset);
    const table = dataset.table(tableName);
    const tmpDir = mkdtempSync(join(tmpdir(), "dist-bq-"));
    const ndjsonPath = join(tmpDir, `${tableName}.ndjson`);
    try {
      writeFileSync(ndjsonPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
      const [job] = await table.load(ndjsonPath, {
        sourceFormat: "NEWLINE_DELIMITED_JSON",
        writeDisposition: "WRITE_TRUNCATE",
        autodetect: false,
        schema: { fields: schema },
        location,
      });
      // @google-cloud/bigquery: load() may return a Job; wait if needed
      const jobAny = job as {
        promise?: () => Promise<unknown>;
        getMetadata?: () => Promise<[{ status?: { state?: string; errorResult?: unknown }; statistics?: { load?: { outputRows?: string } } }]>;
        id?: string;
      };
      const maybePromise = jobAny.promise;
      if (typeof maybePromise === "function") {
        await maybePromise.call(job);
      } else if (typeof jobAny.getMetadata === "function") {
        for (let i = 0; i < 60; i++) {
          const [meta] = await jobAny.getMetadata();
          const state = meta.status?.state;
          if (state === "DONE") {
            if (meta.status?.errorResult) {
              throw new Error(`load failed: ${JSON.stringify(meta.status.errorResult)}`);
            }
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      const doneMeta =
        typeof jobAny.getMetadata === "function"
          ? (await jobAny.getMetadata())[0]
          : ((job as { metadata?: { statistics?: { load?: { outputRows?: string } } } }).metadata ?? {});
      console.log(
        `  loaded ${doneMeta.statistics?.load?.outputRows ?? rows.length} rows (job ${jobAny.id ?? "?"})`,
      );
    } finally {
      try {
        unlinkSync(ndjsonPath);
      } catch {
        /* ignore */
      }
    }
  }

  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

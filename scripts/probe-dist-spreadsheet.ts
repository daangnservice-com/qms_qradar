/**
 * List sheet tabs + row counts from the distribution spreadsheet.
 * Requires SA to have at least Viewer on the sheet.
 *
 * Usage: npx tsx scripts/probe-dist-spreadsheet.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { GoogleAuth } from "google-auth-library";

const SPREADSHEET_ID = "1zVtfyduiNpZ0Ro3ZLiDRw4662IxXOufDESFrTHvyAxw";

/** Sheets the GAS code actually reads */
const EXPECTED_SHEETS = [
  "config",
  "aqt",
  "teams",
  "gps",
  "history",
  "history_detail",
  "eval_items",
  "월확정",
  "평가대상자",
  "평가대상자_이력",
  "재직자 RAW",
  "재직자_raw",
  "팀별 COLD Count",
];

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

async function getAccessToken(): Promise<string> {
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
  if (saJson) {
    const credentials = JSON.parse(saJson) as { client_email?: string; type?: string };
    console.log("auth:", credentials.type, credentials.client_email);
  } else {
    console.log("auth: ADC (application-default)");
  }
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("no access token");
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
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as unknown;
}

async function main() {
  const token = await getAccessToken();
  const meta = (await sheetsGet("?fields=properties.title,sheets.properties", token)) as {
    properties: { title: string };
    sheets: Array<{ properties: { title: string; sheetId: number; gridProperties?: { rowCount: number; columnCount: number } } }>;
  };
  console.log("title:", meta.properties.title);
  console.log("\n=== tabs ===");
  const titles = meta.sheets.map((s) => s.properties.title);
  for (const s of meta.sheets) {
    const g = s.properties.gridProperties;
    console.log(
      `- ${s.properties.title} (id=${s.properties.sheetId}, grid=${g?.rowCount ?? "?"}x${g?.columnCount ?? "?"})`,
    );
  }

  console.log("\n=== expected vs actual ===");
  for (const name of EXPECTED_SHEETS) {
    console.log(`${titles.includes(name) ? "OK" : "MISSING"}\t${name}`);
  }
  for (const t of titles) {
    if (!EXPECTED_SHEETS.includes(t)) console.log(`EXTRA\t${t}`);
  }

  // header + approximate used rows for expected sheets that exist
  console.log("\n=== headers / used rows (value range) ===");
  for (const name of EXPECTED_SHEETS.filter((n) => titles.includes(n))) {
    const enc = encodeURIComponent(`'${name}'`);
    try {
      const data = (await sheetsGet(`/values/${enc}?majorDimension=ROWS`, token)) as {
        values?: string[][];
      };
      const values = data.values ?? [];
      const header = (values[0] ?? []).map((c) => String(c));
      console.log(`\n[${name}] rows=${values.length} cols=${header.length}`);
      console.log("  header:", header.join(" | "));
      if (values.length > 1) {
        console.log("  sample:", JSON.stringify(values[1]).slice(0, 200));
      }
    } catch (e) {
      console.log(`\n[${name}] ERROR`, e instanceof Error ? e.message : e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

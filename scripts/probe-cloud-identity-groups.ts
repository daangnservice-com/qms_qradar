/**
 * One-off probe: Cloud Identity Groups API with local sa/*.json
 *   npx tsx scripts/probe-cloud-identity-groups.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GoogleAuth } from "google-auth-library";

function loadEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function loadSa(): { client_email?: string; private_key?: string; type?: string } {
  const explicit = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  if (explicit) {
    return JSON.parse(readFileSync(resolve(process.cwd(), explicit), "utf8"));
  }
  const dir = resolve(process.cwd(), "sa");
  const file = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort()[0];
  if (!file) throw new Error("sa/*.json not found");
  return JSON.parse(readFileSync(resolve(dir, file), "utf8"));
}

const CI_SCOPE = "https://www.googleapis.com/auth/cloud-identity.groups.readonly";
const DIR_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member.readonly";
const GROUP = "ds-sr-cx-professional-l4@daangnservice.com";

async function getToken(sa: object, scopes: string[], subject?: string) {
  const auth = new GoogleAuth({
    credentials: sa,
    scopes,
    ...(subject ? { clientOptions: { subject } } : {}),
  });
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  if (!tok.token) throw new Error("no access token");
  return tok.token;
}

async function httpGet(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, data };
}

async function tryCloudIdentity(label: string, sa: object, opts: { subject?: string; member: string }) {
  try {
    const token = await getToken(sa, [CI_SCOPE], opts.subject);
    const lookupUrl =
      "https://cloudidentity.googleapis.com/v1/groups:lookup?" +
      new URLSearchParams({ "groupKey.id": GROUP }).toString();
    const lookup = await httpGet(lookupUrl, token);
    if (lookup.status !== 200) {
      console.log(JSON.stringify({ label, step: "lookup", ok: false, ...lookup }, null, 2));
      return;
    }
    const name = (lookup.data as { name?: string })?.name;
    if (!name) {
      console.log(JSON.stringify({ label, step: "lookup", ok: false, data: lookup.data }, null, 2));
      return;
    }
    const checkUrl =
      `https://cloudidentity.googleapis.com/v1/${name}/memberships:checkTransitiveMembership?` +
      new URLSearchParams({ query: `member_key_id == '${opts.member}'` }).toString();
    const check = await httpGet(checkUrl, token);
    console.log(
      JSON.stringify(
        {
          label,
          step: "checkTransitiveMembership",
          ok: check.status === 200,
          status: check.status,
          groupName: name,
          member: opts.member,
          data: check.data,
        },
        null,
        2,
      ),
    );
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number; data?: unknown } };
    console.log(
      JSON.stringify(
        {
          label,
          ok: false,
          status: e.response?.status,
          error: e.response?.data ?? e.message,
        },
        null,
        2,
      ),
    );
  }
}

async function tryDirectory(label: string, sa: object, opts: { subject?: string; member: string }) {
  try {
    const token = await getToken(sa, [DIR_SCOPE], opts.subject);
    const url =
      `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(GROUP)}/hasMember/${encodeURIComponent(opts.member)}`;
    const res = await httpGet(url, token);
    console.log(
      JSON.stringify(
        {
          label,
          step: "directory.hasMember",
          ok: res.status === 200,
          status: res.status,
          data: res.data,
        },
        null,
        2,
      ),
    );
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number; data?: unknown } };
    console.log(
      JSON.stringify(
        {
          label,
          ok: false,
          status: e.response?.status,
          error: e.response?.data ?? e.message,
        },
        null,
        2,
      ),
    );
  }
}

async function main() {
  loadEnvLocal();
  const sa = loadSa();
  const subject = process.env.GOOGLE_WORKSPACE_IMPERSONATE_EMAIL?.trim();
  const member = subject || "amir@daangnservice.com";

  console.log(
    JSON.stringify(
      {
        sa: sa.client_email,
        subject: subject || null,
        group: GROUP,
        member,
      },
      null,
      2,
    ),
  );

  console.log("\n--- Cloud Identity ---");
  if (subject) await tryCloudIdentity("CI: SA + impersonate", sa, { subject, member });
  await tryCloudIdentity("CI: SA only", sa, { member });

  console.log("\n--- Directory (비교) ---");
  if (subject) await tryDirectory("DIR: SA + impersonate", sa, { subject, member });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

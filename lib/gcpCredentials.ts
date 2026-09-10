// GCP 인증.
//
// ⚠️ 서비스계정 키·OAuth 토큰은 레포에 두지 않는다.
//    배포: 호스트/시크릿 매니저의 환경변수
//    로컬: .env.local 또는 `gcloud auth application-default login`(ADC)
//
// 클라이언트별:
//   BigQuery / Speech — ADC 우선. Compute SA에는 교차 프로젝트 BQ·Speech 권한이 없을 수 있다.
//   GCS               — GOOGLE_SERVICE_ACCOUNT_JSON 있으면 그 SA, 없으면 ADC.
//   Groups            — 사용자 ADC면 직접 Directory 호출, SA면 DWD+impersonate.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function extractJsonObject(text: string, fromIdx: number): string | null {
  const start = text.indexOf("{", fromIdx);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
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
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseSa(raw: string | undefined | null): object | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  try {
    const obj = JSON.parse(v) as { type?: string };
    if (obj && typeof obj === "object" && (obj.type === "service_account" || "client_email" in obj)) {
      return obj;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function fromEnvFile(): object | undefined {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const marker = text.search(/GOOGLE_SERVICE_ACCOUNT_JSON\s*=/);
  if (marker < 0) return undefined;
  const json = extractJsonObject(text, marker);
  return json ? parseSa(json) : undefined;
}

let _cached: object | undefined | null = null;

/** SA 키 객체가 있으면 반환, 없으면 undefined(→ ADC 위임). */
export function gcpCredentials(): object | undefined {
  if (_cached !== null) return _cached ?? undefined;
  const fromEnv = parseSa(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (fromEnv) {
    _cached = fromEnv;
    return fromEnv;
  }
  const fromFile = fromEnvFile();
  if (fromFile) {
    _cached = fromFile;
    return fromFile;
  }
  _cached = undefined;
  return undefined;
}

/** GCS 클라이언트에 펼쳐 넣을 옵션 조각. SA JSON 있으면 그걸 씀. */
export function gcpClientAuth(): { credentials: object } | Record<string, never> {
  const credentials = gcpCredentials();
  return credentials ? { credentials } : {};
}

function adcWellKnownPath(): string {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  }
  const gcloud = process.platform === "win32"
    ? resolve(process.env.APPDATA ?? resolve(process.env.USERPROFILE ?? ".", "AppData", "Roaming"), "gcloud")
    : resolve(process.env.HOME ?? ".", ".config", "gcloud");
  return resolve(gcloud, "application_default_credentials.json");
}

/** ADC JSON peek — `authorized_user` | `service_account` 등. 없으면 undefined. */
export function peekAdcCredentials(): { type?: string } | undefined {
  const path = adcWellKnownPath();
  if (!existsSync(path)) return undefined;
  try {
    const obj = JSON.parse(readFileSync(path, "utf8")) as { type?: string };
    return obj && typeof obj === "object" ? obj : undefined;
  } catch {
    return undefined;
  }
}

/**
 * BigQuery/Speech용. ADC 파일이 있으면 SA JSON을 넣지 않는다.
 * ADC가 없는 배포 호스트는 SA JSON으로 폴백.
 */
export function gcpAdcPreferredAuth(): { credentials: object } | Record<string, never> {
  if (existsSync(adcWellKnownPath())) return {};
  return gcpClientAuth();
}

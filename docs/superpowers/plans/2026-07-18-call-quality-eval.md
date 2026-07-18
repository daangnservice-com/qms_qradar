# 통화 품질 평가 테스트 사이트 (1단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** m4a 통화 녹음을 업로드하면 ffmpeg로 무음(공백) 구간을 초 단위로 측정하고 Gemini로 상담 품질(태도/해결력/흐름)을 평가해 한 화면에 보여주는, AWS 없는 Next.js 단독 앱(1단계)을 만든다.

**Architecture:** Next.js(App Router) 단일 앱. `POST /api/evaluate`가 multipart로 파일을 받아 순수 모듈(`lib/silence.ts`·`lib/gemini.ts`·`lib/evaluate.ts`)을 동기로 호출한다. 무음은 ffmpeg 신호 기반(신뢰 소스), 평가는 Gemini가 무음 데이터를 프롬프트로 받아 수행한다. 처리 로직은 HTTP에 의존하지 않게 격리하여 2단계 AWS Lambda 이식을 대비한다. 구글 SSO(@daangnservice.com)로 접근을 제한한다.

**Tech Stack:** Next.js(App Router) · TypeScript · Tailwind CSS v4 · NextAuth v4(Google) · ffmpeg-static · @google/generative-ai(gemini-2.5-flash) · Vitest

## Global Constraints

- 언어: TypeScript, Next.js App Router.
- 스타일: Tailwind CSS v4, CSS-first(`@theme {}`). 별도 `tailwind.config.js` 없이 `app/globals.css`에서 `@import "tailwindcss";`.
- 처리 로직(`lib/silence.ts`·`lib/gemini.ts`·`lib/evaluate.ts`·`lib/audio.ts`·`lib/types.ts`)은 **Next/HTTP API에 의존 금지**(2단계 Lambda 이식 대상).
- 무음 기본값: `minSilenceSec=3`(범위 1~10), `noiseDb=-30`(`SILENCE_NOISE_DB`).
- 점수 척도: 각 항목 정수 1~5.
- 파일: `.m4a`만 허용, 최대 200MB(`MAX_UPLOAD_MB`).
- 모델: `gemini-2.5-flash`(`GEMINI_MODEL`).
- 인증 도메인: `ALLOWED_EMAIL_DOMAIN=daangnservice.com`.
- 테스트: Vitest. 처리 모듈은 TDD, 외부(ffmpeg/Gemini)는 목 또는 fixture.
- 커밋: 각 Task 끝에서 커밋. (실제 `git push`는 사용자가 직접 수행.)

---

## 파일 구조

```
call-quality-eval/
  app/
    globals.css                         # Tailwind v4 진입
    layout.tsx
    page.tsx                            # 업로드/로딩/결과 (client)
    providers.tsx                       # SessionProvider 래퍼
    api/
      auth/[...nextauth]/route.ts       # NextAuth 핸들러
      evaluate/route.ts                 # 평가 API (HTTP 껍데기)
  components/
    UploadForm.tsx
    ThresholdSlider.tsx
    ResultView.tsx
    ScoreCard.tsx
    ReportView.tsx
    SilenceTimeline.tsx
  lib/
    types.ts                           # 공용 타입
    format.ts                          # mm:ss 등 포맷 유틸
    auth.ts                            # NextAuth 옵션 + 도메인 검증
    audio.ts                           # 임시파일 저장/정리
    silence.ts                         # ffmpeg silencedetect + 파서
    gemini.ts                          # 프롬프트 + Gemini 호출 + 파싱
    evaluate.ts                        # 파이프라인 조립
  middleware.ts                        # 인증 게이트
  test/
    fixtures/silencedetect.stderr.txt  # ffmpeg stderr 샘플
    fixtures/gemini-response.json      # Gemini 응답 샘플
  .env.local.example
  vitest.config.ts
```

---

## Task 0: 프로젝트 스캐폴딩 + 테스트 러너

**Files:**
- Create: 프로젝트 전체(`package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `vitest.config.ts`, `.env.local.example`)

**Interfaces:**
- Consumes: 없음
- Produces: 빌드 가능한 Next.js 앱, `npm test`로 Vitest 실행 가능.

- [ ] **Step 1: Next.js 앱 생성 (기존 디렉토리에 초기화)**

기존 `call-quality-eval/`에는 이미 `README.md`, `docs/`, `.git`이 있으므로 현재 디렉토리에 스캐폴딩한다.

```bash
cd call-quality-eval
npx create-next-app@latest . \
  --typescript --app --tailwind --eslint \
  --src-dir=false --import-alias "@/*" --no-turbopack --use-npm
# 기존 파일 유지 여부를 물으면 유지(overwrite 하지 않음)
```

- [ ] **Step 2: 처리/인증/테스트 의존성 설치**

```bash
npm install next-auth@^4 @google/generative-ai ffmpeg-static lucide-react
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Vitest 설정 작성**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx", "app/**/*.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

`package.json`의 `scripts`에 추가:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Tailwind v4 CSS-first 진입 확인**

`app/globals.css` 상단이 아래로 시작하는지 확인(create-next-app v4 기본). 아니면 교체:

```css
@import "tailwindcss";

@theme {
  --color-brand: #ff6f0f;
}
```

- [ ] **Step 5: 환경변수 예시 파일 작성**

`.env.local.example`:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
ALLOWED_EMAIL_DOMAIN=daangnservice.com

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# 처리 설정
SILENCE_NOISE_DB=-30
MAX_UPLOAD_MB=200
```

- [ ] **Step 6: 스모크 — 빌드/테스트 러너 동작 확인**

Run: `npm run build` → Expected: 빌드 성공
Run: `npm test` → Expected: "No test files found" 또는 0 tests (에러 없이 종료)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with vitest and env example"
```

---

## Task 1: 공용 타입 + 시간 포맷 유틸

**Files:**
- Create: `lib/types.ts`, `lib/format.ts`, `lib/format.test.ts`

**Interfaces:**
- Produces:
  - `interface Silence { startSec: number; endSec: number; durationSec: number }`
  - `interface SilenceSummary { count: number; totalSec: number; longestSec: number; silenceRatio: number }`
  - `interface Threshold { minSilenceSec: number; noiseDb: number }`
  - `interface ScoreDetail { score: number; comment: string }`
  - `interface Evaluation { scores: { attitude: ScoreDetail; resolution: ScoreDetail; flow: ScoreDetail }; overallSummary: string; silenceComments: { atSec: number; note: string }[]; error: string | null }`
  - `interface EvaluationResult { durationSec: number; threshold: Threshold; silences: Silence[]; silenceSummary: SilenceSummary; evaluation: Evaluation }`
  - `formatClock(sec: number): string` — 초 → `mm:ss`(반올림)

- [ ] **Step 1: 실패 테스트 작성**

`lib/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatClock } from "./format";

describe("formatClock", () => {
  it("formats seconds into mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(75)).toBe("01:15");
    expect(formatClock(135.2)).toBe("02:15");
    expect(formatClock(3599)).toBe("59:59");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL ("formatClock" is not a function / module not found)

- [ ] **Step 3: 타입 + 구현 작성**

`lib/types.ts`:

```ts
export interface Silence { startSec: number; endSec: number; durationSec: number; }
export interface SilenceSummary { count: number; totalSec: number; longestSec: number; silenceRatio: number; }
export interface Threshold { minSilenceSec: number; noiseDb: number; }
export interface ScoreDetail { score: number; comment: string; }
export interface Evaluation {
  scores: { attitude: ScoreDetail; resolution: ScoreDetail; flow: ScoreDetail };
  overallSummary: string;
  silenceComments: { atSec: number; note: string }[];
  error: string | null;
}
export interface EvaluationResult {
  durationSec: number;
  threshold: Threshold;
  silences: Silence[];
  silenceSummary: SilenceSummary;
  evaluation: Evaluation;
}
```

`lib/format.ts`:

```ts
export function formatClock(sec: number): string {
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/format.ts lib/format.test.ts
git commit -m "feat: add shared types and clock formatter"
```

---

## Task 2: 무음 파서 (`lib/silence.ts`)

**Files:**
- Create: `lib/silence.ts`, `lib/silence.test.ts`, `test/fixtures/silencedetect.stderr.txt`

**Interfaces:**
- Consumes: `Silence`, `SilenceSummary`, `Threshold` (`lib/types.ts`)
- Produces:
  - `parseInputDuration(stderr: string): number` — `Duration: HH:MM:SS.ss` → 초
  - `parseSilenceEvents(stderr: string): { start: number; end: number; durationSec: number }[]`
  - `summarizeSilences(events, minSilenceSec, totalDurationSec): { silences: Silence[]; summary: SilenceSummary }`
  - `runSilenceDetection(filePath: string, opts: { minSilenceSec: number; noiseDb: number }): Promise<{ durationSec: number; silences: Silence[]; summary: SilenceSummary }>`

- [ ] **Step 1: fixture 작성**

`test/fixtures/silencedetect.stderr.txt`:

```
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/call.m4a':
  Duration: 00:20:34.56, start: 0.000000, bitrate: 128 kb/s
[silencedetect @ 0x55e] silence_start: 135.2
[silencedetect @ 0x55e] silence_end: 160.4 | silence_duration: 25.2
[silencedetect @ 0x55e] silence_start: 300.0
[silencedetect @ 0x55e] silence_end: 304.5 | silence_duration: 4.5
[silencedetect @ 0x55e] silence_start: 500.1
[silencedetect @ 0x55e] silence_end: 502.0 | silence_duration: 1.9
size=N/A time=00:20:34.56 bitrate=N/A speed=120x
```

- [ ] **Step 2: 실패 테스트 작성**

`lib/silence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseInputDuration, parseSilenceEvents, summarizeSilences } from "./silence";

const stderr = readFileSync(path.resolve(__dirname, "../test/fixtures/silencedetect.stderr.txt"), "utf8");

describe("parseInputDuration", () => {
  it("parses Duration line into seconds", () => {
    expect(parseInputDuration(stderr)).toBeCloseTo(1234.56, 2);
  });
});

describe("parseSilenceEvents", () => {
  it("extracts start/end/duration triples", () => {
    const events = parseSilenceEvents(stderr);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ start: 135.2, end: 160.4, durationSec: 25.2 });
  });
});

describe("summarizeSilences", () => {
  it("filters by minSilenceSec and summarizes", () => {
    const events = parseSilenceEvents(stderr);
    const { silences, summary } = summarizeSilences(events, 3, 1234.56);
    // 1.9초짜리는 제외, 25.2초/4.5초만 남음
    expect(silences.map((s) => s.durationSec)).toEqual([25.2, 4.5]);
    expect(summary.count).toBe(2);
    expect(summary.totalSec).toBeCloseTo(29.7, 5);
    expect(summary.longestSec).toBe(25.2);
    expect(summary.silenceRatio).toBeCloseTo(29.7 / 1234.56, 5);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run lib/silence.test.ts`
Expected: FAIL (functions not defined)

- [ ] **Step 4: 구현 작성**

`lib/silence.ts`:

```ts
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import type { Silence, SilenceSummary } from "./types";

export function parseInputDuration(stderr: string): number {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

export function parseSilenceEvents(stderr: string): { start: number; end: number; durationSec: number }[] {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((m) => ({ end: Number(m[1]), durationSec: Number(m[2]) }));
  const events: { start: number; end: number; durationSec: number }[] = [];
  for (let i = 0; i < starts.length; i++) {
    const e = ends[i];
    if (!e) break; // 미완결(EOF) 이벤트는 무시
    events.push({ start: starts[i], end: e.end, durationSec: e.durationSec });
  }
  return events;
}

export function summarizeSilences(
  events: { start: number; end: number; durationSec: number }[],
  minSilenceSec: number,
  totalDurationSec: number,
): { silences: Silence[]; summary: SilenceSummary } {
  const silences: Silence[] = events
    .filter((e) => e.durationSec >= minSilenceSec)
    .map((e) => ({ startSec: e.start, endSec: e.end, durationSec: e.durationSec }));
  const totalSec = silences.reduce((a, s) => a + s.durationSec, 0);
  const longestSec = silences.reduce((a, s) => Math.max(a, s.durationSec), 0);
  const summary: SilenceSummary = {
    count: silences.length,
    totalSec,
    longestSec,
    silenceRatio: totalDurationSec > 0 ? totalSec / totalDurationSec : 0,
  };
  return { silences, summary };
}

export async function runSilenceDetection(
  filePath: string,
  opts: { minSilenceSec: number; noiseDb: number },
): Promise<{ durationSec: number; silences: Silence[]; summary: SilenceSummary }> {
  const args = ["-i", filePath, "-af", `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minSilenceSec}`, "-f", "null", "-"];
  const stderr = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const proc = spawn(ffmpegPath as string, args);
    proc.stderr.on("data", (d) => (buf += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(buf) : reject(new Error(`ffmpeg exited ${code}: ${buf.slice(-500)}`))));
  });
  const durationSec = parseInputDuration(stderr);
  const events = parseSilenceEvents(stderr);
  const { silences, summary } = summarizeSilences(events, opts.minSilenceSec, durationSec);
  return { durationSec, silences, summary };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run lib/silence.test.ts`
Expected: PASS (3 파일의 describe 모두 통과)

- [ ] **Step 6: Commit**

```bash
git add lib/silence.ts lib/silence.test.ts test/fixtures/silencedetect.stderr.txt
git commit -m "feat: add ffmpeg silence detection with tested parser"
```

---

## Task 3: 임시파일 유틸 (`lib/audio.ts`)

**Files:**
- Create: `lib/audio.ts`, `lib/audio.test.ts`

**Interfaces:**
- Produces:
  - `saveTempFile(bytes: Uint8Array, ext: string): Promise<string>` — OS temp에 저장 후 경로 반환
  - `cleanupTempFile(filePath: string): Promise<void>` — 존재 시 삭제(없어도 무에러)

- [ ] **Step 1: 실패 테스트 작성**

`lib/audio.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { saveTempFile, cleanupTempFile } from "./audio";

describe("saveTempFile / cleanupTempFile", () => {
  it("writes bytes to a temp file then removes it", async () => {
    const bytes = new TextEncoder().encode("hello");
    const p = await saveTempFile(bytes, ".m4a");
    expect(existsSync(p)).toBe(true);
    expect(p.endsWith(".m4a")).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("hello");
    await cleanupTempFile(p);
    expect(existsSync(p)).toBe(false);
  });

  it("cleanup does not throw when file is missing", async () => {
    await expect(cleanupTempFile("/tmp/does-not-exist-xyz.m4a")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/audio.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 작성**

`lib/audio.ts`:

```ts
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function saveTempFile(bytes: Uint8Array, ext: string): Promise<string> {
  const name = `cqe-${process.pid}-${Date.now()}-${Math.floor(performance.now() * 1000)}${ext}`;
  const filePath = path.join(tmpdir(), name);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // 이미 없으면 무시
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/audio.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/audio.ts lib/audio.test.ts
git commit -m "feat: add temp file save/cleanup util"
```

---

## Task 4: Gemini 평가 (`lib/gemini.ts`)

**Files:**
- Create: `lib/gemini.ts`, `lib/gemini.test.ts`, `test/fixtures/gemini-response.json`

**Interfaces:**
- Consumes: `Silence`, `SilenceSummary`, `Evaluation` (`lib/types.ts`), `formatClock` (`lib/format.ts`)
- Produces:
  - `buildEvaluationPrompt(silences: Silence[], summary: SilenceSummary): string`
  - `parseEvaluation(jsonText: string): Evaluation` — Gemini JSON 문자열 → `Evaluation`(누락 필드 방어)
  - `runGeminiEvaluation(filePath: string, silences: Silence[], summary: SilenceSummary): Promise<Evaluation>`

- [ ] **Step 1: fixture 작성**

`test/fixtures/gemini-response.json`:

```json
{
  "scores": {
    "attitude": { "score": 4, "comment": "전반적으로 친절하고 공감 표현이 있음" },
    "resolution": { "score": 3, "comment": "문의는 해결했으나 안내가 다소 장황" },
    "flow": { "score": 2, "comment": "검색성 공백이 길어 흐름이 끊김" }
  },
  "overallSummary": "친절하나 검색 대기 시간이 길어 개선 필요",
  "silenceComments": [
    { "atSec": 135.2, "note": "02:15 지점 25초 공백으로 고객 대기 발생" }
  ]
}
```

- [ ] **Step 2: 실패 테스트 작성**

`lib/gemini.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildEvaluationPrompt, parseEvaluation } from "./gemini";
import type { Silence, SilenceSummary } from "./types";

const silences: Silence[] = [{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }];
const summary: SilenceSummary = { count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.02 };

describe("buildEvaluationPrompt", () => {
  it("includes criteria and silence timestamps in mm:ss", () => {
    const p = buildEvaluationPrompt(silences, summary);
    expect(p).toContain("응대 태도");
    expect(p).toContain("문제 해결력");
    expect(p).toContain("대화 흐름");
    expect(p).toContain("02:15"); // 135.2s
    expect(p).toContain("25.2");
  });
});

describe("parseEvaluation", () => {
  it("parses a well-formed Gemini JSON response", () => {
    const raw = readFileSync(path.resolve(__dirname, "../test/fixtures/gemini-response.json"), "utf8");
    const ev = parseEvaluation(raw);
    expect(ev.scores.attitude.score).toBe(4);
    expect(ev.scores.flow.comment).toContain("흐름");
    expect(ev.overallSummary).toContain("개선");
    expect(ev.silenceComments[0].atSec).toBe(135.2);
    expect(ev.error).toBeNull();
  });

  it("tolerates code-fenced JSON", () => {
    const ev = parseEvaluation('```json\n{"scores":{"attitude":{"score":5,"comment":"a"},"resolution":{"score":5,"comment":"b"},"flow":{"score":5,"comment":"c"}},"overallSummary":"s","silenceComments":[]}\n```');
    expect(ev.scores.attitude.score).toBe(5);
    expect(ev.silenceComments).toEqual([]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run lib/gemini.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현 작성**

`lib/gemini.ts`:

```ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { formatClock } from "./format";
import type { Silence, SilenceSummary, Evaluation } from "./types";

export function buildEvaluationPrompt(silences: Silence[], summary: SilenceSummary): string {
  const lines = silences
    .map((s) => `- ${formatClock(s.startSec)}~${formatClock(s.endSec)} (${s.durationSec.toFixed(1)}초)`)
    .join("\n") || "- (기준 이상 공백 없음)";
  return [
    "당신은 고객 상담(CS) 콜 품질 평가자입니다. 첨부된 통화 녹음을 듣고 아래 3개 항목을 각각 1~5점(정수)으로 평가하세요.",
    "",
    "평가 항목:",
    "1) 응대 태도 (attitude): 친절함, 공감, 말투",
    "2) 문제 해결력 (resolution): 고객 문의를 실제로 해결했는지",
    "3) 대화 흐름 (flow): 침묵/공백/어색한 끊김이 흐름에 준 영향",
    "",
    "신호 분석으로 측정된 공백(무음) 구간 — 상담원이 어드민에서 검색하느라 비운 시간일 수 있음:",
    lines,
    `요약: 공백 ${summary.count}회, 총 ${summary.totalSec.toFixed(1)}초, 최장 ${summary.longestSec.toFixed(1)}초.`,
    "",
    "위 공백 구간을 근거로 flow를 평가하고, 주요 공백에 대해 silenceComments에 코멘트를 남기세요.",
    "반드시 지정된 JSON 스키마로만 응답하세요.",
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: {
        attitude: { type: "object", properties: { score: { type: "integer" }, comment: { type: "string" } }, required: ["score", "comment"] },
        resolution: { type: "object", properties: { score: { type: "integer" }, comment: { type: "string" } }, required: ["score", "comment"] },
        flow: { type: "object", properties: { score: { type: "integer" }, comment: { type: "string" } }, required: ["score", "comment"] },
      },
      required: ["attitude", "resolution", "flow"],
    },
    overallSummary: { type: "string" },
    silenceComments: {
      type: "array",
      items: { type: "object", properties: { atSec: { type: "number" }, note: { type: "string" } }, required: ["atSec", "note"] },
    },
  },
  required: ["scores", "overallSummary", "silenceComments"],
} as const;

export function parseEvaluation(jsonText: string): Evaluation {
  const cleaned = jsonText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const o = JSON.parse(cleaned);
  return {
    scores: {
      attitude: { score: Number(o.scores.attitude.score), comment: String(o.scores.attitude.comment) },
      resolution: { score: Number(o.scores.resolution.score), comment: String(o.scores.resolution.comment) },
      flow: { score: Number(o.scores.flow.score), comment: String(o.scores.flow.comment) },
    },
    overallSummary: String(o.overallSummary ?? ""),
    silenceComments: Array.isArray(o.silenceComments)
      ? o.silenceComments.map((c: { atSec: number; note: string }) => ({ atSec: Number(c.atSec), note: String(c.note) }))
      : [],
    error: null,
  };
}

export async function runGeminiEvaluation(filePath: string, silences: Silence[], summary: SilenceSummary): Promise<Evaluation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const fileManager = new GoogleAIFileManager(apiKey);
  const uploaded = await fileManager.uploadFile(filePath, { mimeType: "audio/mp4", displayName: "call.m4a" });

  // 파일이 ACTIVE 될 때까지 대기
  let file = await fileManager.getFile(uploaded.file.name);
  while (file.state === FileState.PROCESSING) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await fileManager.getFile(uploaded.file.name);
  }
  if (file.state === FileState.FAILED) throw new Error("Gemini 파일 처리 실패");

  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({
    model,
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA as object },
  });
  const result = await gm.generateContent([
    { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
    { text: buildEvaluationPrompt(silences, summary) },
  ]);
  return parseEvaluation(result.response.text());
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run lib/gemini.test.ts`
Expected: PASS (buildEvaluationPrompt, parseEvaluation. `runGeminiEvaluation`은 실제 API라 여기서 테스트하지 않음)

- [ ] **Step 6: Commit**

```bash
git add lib/gemini.ts lib/gemini.test.ts test/fixtures/gemini-response.json
git commit -m "feat: add Gemini evaluation prompt/parse and File API call"
```

---

## Task 5: 파이프라인 조립 (`lib/evaluate.ts`)

**Files:**
- Create: `lib/evaluate.ts`, `lib/evaluate.test.ts`

**Interfaces:**
- Consumes: `runSilenceDetection` (`lib/silence.ts`), `runGeminiEvaluation` (`lib/gemini.ts`), `EvaluationResult` (`lib/types.ts`)
- Produces:
  - `evaluateFile(filePath: string, opts: { minSilenceSec: number; noiseDb: number }): Promise<EvaluationResult>`
  - Gemini 실패 시 공백 결과는 유지하고 `evaluation.error`에 사유를 담아 반환.

- [ ] **Step 1: 실패 테스트 작성 (silence/gemini 모듈 목)**

`lib/evaluate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./silence", () => ({
  runSilenceDetection: vi.fn(),
}));
vi.mock("./gemini", () => ({
  runGeminiEvaluation: vi.fn(),
}));

import { runSilenceDetection } from "./silence";
import { runGeminiEvaluation } from "./gemini";
import { evaluateFile } from "./evaluate";

const silencePayload = {
  durationSec: 1000,
  silences: [{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }],
  summary: { count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.025 },
};

beforeEach(() => vi.clearAllMocks());

describe("evaluateFile", () => {
  it("merges silence + gemini results", async () => {
    (runSilenceDetection as any).mockResolvedValue(silencePayload);
    (runGeminiEvaluation as any).mockResolvedValue({
      scores: { attitude: { score: 4, comment: "a" }, resolution: { score: 3, comment: "b" }, flow: { score: 2, comment: "c" } },
      overallSummary: "s", silenceComments: [], error: null,
    });
    const r = await evaluateFile("/tmp/x.m4a", { minSilenceSec: 3, noiseDb: -30 });
    expect(r.durationSec).toBe(1000);
    expect(r.silences).toHaveLength(1);
    expect(r.silenceSummary.count).toBe(1);
    expect(r.evaluation.scores.attitude.score).toBe(4);
    expect(r.threshold).toEqual({ minSilenceSec: 3, noiseDb: -30 });
  });

  it("keeps silence results when Gemini fails", async () => {
    (runSilenceDetection as any).mockResolvedValue(silencePayload);
    (runGeminiEvaluation as any).mockRejectedValue(new Error("rate limit"));
    const r = await evaluateFile("/tmp/x.m4a", { minSilenceSec: 3, noiseDb: -30 });
    expect(r.silences).toHaveLength(1);
    expect(r.evaluation.error).toContain("rate limit");
    expect(r.evaluation.scores.attitude.score).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/evaluate.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 작성**

`lib/evaluate.ts`:

```ts
import { runSilenceDetection } from "./silence";
import { runGeminiEvaluation } from "./gemini";
import type { Evaluation, EvaluationResult } from "./types";

function emptyEvaluation(error: string): Evaluation {
  return {
    scores: {
      attitude: { score: 0, comment: "" },
      resolution: { score: 0, comment: "" },
      flow: { score: 0, comment: "" },
    },
    overallSummary: "",
    silenceComments: [],
    error,
  };
}

export async function evaluateFile(
  filePath: string,
  opts: { minSilenceSec: number; noiseDb: number },
): Promise<EvaluationResult> {
  const { durationSec, silences, summary } = await runSilenceDetection(filePath, opts);

  let evaluation: Evaluation;
  try {
    evaluation = await runGeminiEvaluation(filePath, silences, summary);
  } catch (e) {
    evaluation = emptyEvaluation(e instanceof Error ? e.message : String(e));
  }

  return {
    durationSec,
    threshold: { minSilenceSec: opts.minSilenceSec, noiseDb: opts.noiseDb },
    silences,
    silenceSummary: summary,
    evaluation,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/evaluate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/evaluate.ts lib/evaluate.test.ts
git commit -m "feat: assemble silence+gemini pipeline with graceful AI fallback"
```

---

## Task 6: 인증 (NextAuth + 도메인 제한)

**Files:**
- Create: `lib/auth.ts`, `lib/auth.test.ts`, `app/api/auth/[...nextauth]/route.ts`, `middleware.ts`, `app/providers.tsx`
- Modify: `app/layout.tsx` (providers 래핑)

**Interfaces:**
- Produces:
  - `isAllowedEmail(email: string | null | undefined, domain: string): boolean`
  - `authOptions: NextAuthOptions` — Google provider + signIn 콜백
- Consumes: `evaluateFile`는 다음 Task에서 사용.

- [ ] **Step 1: 실패 테스트 작성 (도메인 검증 순수 함수)**

`lib/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "./auth";

describe("isAllowedEmail", () => {
  it("allows exact domain match (case-insensitive)", () => {
    expect(isAllowedEmail("karla@daangnservice.com", "daangnservice.com")).toBe(true);
    expect(isAllowedEmail("Karla@Daangnservice.com", "daangnservice.com")).toBe(true);
  });
  it("rejects other domains and empty", () => {
    expect(isAllowedEmail("a@gmail.com", "daangnservice.com")).toBe(false);
    expect(isAllowedEmail("", "daangnservice.com")).toBe(false);
    expect(isAllowedEmail(null, "daangnservice.com")).toBe(false);
    expect(isAllowedEmail("a@evil-daangnservice.com", "daangnservice.com")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 작성**

`lib/auth.ts`:

```ts
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export function isAllowedEmail(email: string | null | undefined, domain: string): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return isAllowedEmail(user.email, process.env.ALLOWED_EMAIL_DOMAIN ?? "daangnservice.com");
    },
  },
};
```

`app/api/auth/[...nextauth]/route.ts`:

```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

`middleware.ts`:

```ts
export { default } from "next-auth/middleware";

export const config = {
  // 로그인/정적 리소스 제외 전 경로 보호
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
```

`app/providers.tsx`:

```tsx
"use client";
import { SessionProvider } from "next-auth/react";
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

`app/layout.tsx` — `<body>` 안을 Providers로 감싼다:

```tsx
import Providers from "./providers";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: 통과 확인 + 빌드**

Run: `npx vitest run lib/auth.test.ts` → Expected: PASS
Run: `npm run build` → Expected: 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts app/api/auth app/providers.tsx app/layout.tsx middleware.ts
git commit -m "feat: add Google SSO with domain restriction and route guard"
```

---

## Task 7: 평가 API 라우트 (`app/api/evaluate/route.ts`)

**Files:**
- Create: `app/api/evaluate/route.ts`, `app/api/evaluate/route.test.ts`

**Interfaces:**
- Consumes: `evaluateFile` (`lib/evaluate.ts`), `saveTempFile`/`cleanupTempFile` (`lib/audio.ts`)
- Produces: `POST(req: Request): Promise<Response>` — `multipart/form-data`(`file`, `minSilenceSec`) → `EvaluationResult` JSON. 검증 실패 400, 처리 실패 500.

- [ ] **Step 1: 실패 테스트 작성 (evaluate/audio 목)**

`app/api/evaluate/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/evaluate", () => ({ evaluateFile: vi.fn() }));
vi.mock("@/lib/audio", () => ({ saveTempFile: vi.fn(), cleanupTempFile: vi.fn() }));

import { evaluateFile } from "@/lib/evaluate";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { POST } from "./route";

function form(fields: Record<string, string>, file?: { name: string; type: string; body: string }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set("file", new File([file.body], file.name, { type: file.type }));
  return new Request("http://localhost/api/evaluate", { method: "POST", body: fd });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/evaluate", () => {
  it("rejects non-m4a with 400", async () => {
    const res = await POST(form({ minSilenceSec: "3" }, { name: "a.mp3", type: "audio/mpeg", body: "x" }));
    expect(res.status).toBe(400);
  });

  it("returns evaluation result on success", async () => {
    (saveTempFile as any).mockResolvedValue("/tmp/x.m4a");
    (evaluateFile as any).mockResolvedValue({ durationSec: 10, threshold: { minSilenceSec: 3, noiseDb: -30 }, silences: [], silenceSummary: { count: 0, totalSec: 0, longestSec: 0, silenceRatio: 0 }, evaluation: { scores: { attitude: { score: 1, comment: "" }, resolution: { score: 1, comment: "" }, flow: { score: 1, comment: "" } }, overallSummary: "", silenceComments: [], error: null } });
    const res = await POST(form({ minSilenceSec: "3" }, { name: "a.m4a", type: "audio/mp4", body: "x" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.durationSec).toBe(10);
    expect(cleanupTempFile).toHaveBeenCalledWith("/tmp/x.m4a");
    expect((evaluateFile as any).mock.calls[0][1]).toEqual({ minSilenceSec: 3, noiseDb: -30 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run app/api/evaluate/route.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 작성**

`app/api/evaluate/route.ts`:

```ts
import { NextResponse } from "next/server";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { evaluateFile } from "@/lib/evaluate";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel 배포 시 상한(로컬은 무제한)

export async function POST(req: Request): Promise<Response> {
  let tempPath: string | null = null;
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".m4a")) {
      return NextResponse.json({ error: "m4a 파일만 지원합니다." }, { status: 400 });
    }
    const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 200);
    if (file.size > maxMb * 1024 * 1024) {
      return NextResponse.json({ error: `최대 ${maxMb}MB까지 업로드할 수 있습니다.` }, { status: 400 });
    }

    const raw = Number(fd.get("minSilenceSec") ?? 3);
    const minSilenceSec = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 3));
    const noiseDb = Number(process.env.SILENCE_NOISE_DB ?? -30);

    const bytes = new Uint8Array(await file.arrayBuffer());
    tempPath = await saveTempFile(bytes, ".m4a");

    const result = await evaluateFile(tempPath, { minSilenceSec, noiseDb });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "처리 중 오류" }, { status: 500 });
  } finally {
    if (tempPath) await cleanupTempFile(tempPath);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run app/api/evaluate/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/evaluate/route.ts app/api/evaluate/route.test.ts
git commit -m "feat: add /api/evaluate multipart route with validation"
```

---

## Task 8: 프론트 UI (업로드/로딩/결과)

**Files:**
- Create: `components/ThresholdSlider.tsx`, `components/UploadForm.tsx`, `components/ScoreCard.tsx`, `components/ReportView.tsx`, `components/SilenceTimeline.tsx`, `components/ResultView.tsx`, `components/SilenceTimeline.test.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `EvaluationResult`, `Silence` (`lib/types.ts`), `formatClock` (`lib/format.ts`)
- Produces: 로그인 후 업로드 → `POST /api/evaluate` → 결과 렌더 흐름.

- [ ] **Step 1: 실패 테스트 작성 (타임라인 렌더)**

`components/SilenceTimeline.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SilenceTimeline from "./SilenceTimeline";

describe("SilenceTimeline", () => {
  it("renders each silence as mm:ss~mm:ss with duration", () => {
    render(
      <SilenceTimeline
        durationSec={1000}
        silences={[{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }]}
        summary={{ count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.025 }}
        comments={[]}
      />,
    );
    expect(screen.getByText(/02:15/)).toBeDefined();
    expect(screen.getByText(/02:40/)).toBeDefined();
    expect(screen.getByText(/25.2/)).toBeDefined();
  });
});
```

Note: `vitest.config.ts`의 `environment`를 이 파일에서 jsdom으로 쓰기 위해 파일 상단에 `// @vitest-environment jsdom` 주석을 추가한다.

`components/SilenceTimeline.test.tsx` 최상단:

```tsx
// @vitest-environment jsdom
```

또한 `test/setup.ts`를 만들어 `import "@testing-library/jest-dom";` 하고 `vitest.config.ts`의 `test`에 `setupFiles: ["./test/setup.ts"]`를 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run components/SilenceTimeline.test.tsx`
Expected: FAIL

- [ ] **Step 3: 컴포넌트 구현**

`components/ThresholdSlider.tsx`:

```tsx
"use client";
export default function ThresholdSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm">공백 최소 길이: <b>{value}초</b> 이상</span>
      <input type="range" min={1} max={10} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}
```

`components/ScoreCard.tsx`:

```tsx
import type { ScoreDetail } from "@/lib/types";
export default function ScoreCard({ title, detail }: { title: string; detail: ScoreDetail }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-2xl font-bold">{detail.score}<span className="text-sm text-gray-400">/5</span></span>
      </div>
      <p className="mt-2 text-sm text-gray-600">{detail.comment}</p>
    </div>
  );
}
```

`components/ReportView.tsx`:

```tsx
export default function ReportView({ summary, error }: { summary: string; error: string | null }) {
  if (error) return <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">AI 평가 실패: {error} (공백 측정 결과는 아래 유지)</div>;
  return <div className="rounded-lg border p-4"><h3 className="font-semibold">총평</h3><p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{summary}</p></div>;
}
```

`components/SilenceTimeline.tsx`:

```tsx
import { formatClock } from "@/lib/format";
import type { Silence, SilenceSummary } from "@/lib/types";

export default function SilenceTimeline({
  durationSec, silences, summary, comments,
}: {
  durationSec: number;
  silences: Silence[];
  summary: SilenceSummary;
  comments: { atSec: number; note: string }[];
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">공백 타임라인</h3>
        <span className="text-sm text-gray-500">
          {summary.count}회 · 총 {summary.totalSec.toFixed(1)}초 · 최장 {summary.longestSec.toFixed(1)}초 · {(summary.silenceRatio * 100).toFixed(1)}%
        </span>
      </div>
      <div className="relative mt-3 h-3 w-full rounded bg-gray-100">
        {silences.map((s, i) => (
          <div key={i} className="absolute h-3 rounded bg-red-400"
            style={{ left: `${(s.startSec / durationSec) * 100}%`, width: `${((s.endSec - s.startSec) / durationSec) * 100}%` }}
            title={`${formatClock(s.startSec)}~${formatClock(s.endSec)} (${s.durationSec.toFixed(1)}초)`} />
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {silences.map((s, i) => {
          const c = comments.find((c) => Math.abs(c.atSec - s.startSec) < 0.5);
          return (
            <li key={i} className="flex gap-2">
              <span className="font-mono">{formatClock(s.startSec)}~{formatClock(s.endSec)} ({s.durationSec.toFixed(1)}초)</span>
              {c && <span className="text-gray-500">— {c.note}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

`components/ResultView.tsx`:

```tsx
import type { EvaluationResult } from "@/lib/types";
import ScoreCard from "./ScoreCard";
import ReportView from "./ReportView";
import SilenceTimeline from "./SilenceTimeline";

export default function ResultView({ result }: { result: EvaluationResult }) {
  const { evaluation: e } = result;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <ScoreCard title="응대 태도" detail={e.scores.attitude} />
        <ScoreCard title="문제 해결력" detail={e.scores.resolution} />
        <ScoreCard title="대화 흐름·공백" detail={e.scores.flow} />
      </div>
      <ReportView summary={e.overallSummary} error={e.error} />
      <SilenceTimeline durationSec={result.durationSec} silences={result.silences} summary={result.silenceSummary} comments={e.silenceComments} />
    </div>
  );
}
```

`components/UploadForm.tsx`:

```tsx
"use client";
import { useState } from "react";
import type { EvaluationResult } from "@/lib/types";
import ThresholdSlider from "./ThresholdSlider";

export default function UploadForm({ onResult }: { onResult: (r: EvaluationResult) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [minSilenceSec, setMinSilenceSec] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("minSilenceSec", String(minSilenceSec));
      const res = await fetch("/api/evaluate", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "실패");
      onResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="file" accept=".m4a,audio/mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <ThresholdSlider value={minSilenceSec} onChange={setMinSilenceSec} />
      <button type="submit" disabled={!file || loading} className="rounded bg-brand px-4 py-2 text-white disabled:opacity-50">
        {loading ? "평가 중…" : "품질 평가 시작"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
```

`app/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import type { EvaluationResult } from "@/lib/types";
import UploadForm from "@/components/UploadForm";
import ResultView from "@/components/ResultView";

export default function Home() {
  const { data: session, status } = useSession();
  const [result, setResult] = useState<EvaluationResult | null>(null);

  if (status === "loading") return <main className="p-8">불러오는 중…</main>;
  if (!session) return (
    <main className="p-8">
      <button onClick={() => signIn("google")} className="rounded bg-brand px-4 py-2 text-white">구글로 로그인</button>
    </main>
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">통화 품질 평가</h1>
        <button onClick={() => signOut()} className="text-sm text-gray-500">{session.user?.email} · 로그아웃</button>
      </header>
      <UploadForm onResult={setResult} />
      {result && <ResultView result={result} />}
    </main>
  );
}
```

- [ ] **Step 4: 통과 확인 + 빌드**

Run: `npx vitest run components/SilenceTimeline.test.tsx` → Expected: PASS
Run: `npm run build` → Expected: 빌드 성공

- [ ] **Step 5: Commit**

```bash
git add components app/page.tsx test/setup.ts vitest.config.ts
git commit -m "feat: add upload/result UI with silence timeline"
```

---

## Task 9: 통합 스모크 (수동) + 문서

**Files:**
- Modify: `README.md` (실행 방법)

**Interfaces:** 없음(수동 검증)

- [ ] **Step 1: 환경변수 준비**

`.env.local` 생성(예시 복사 후 값 채움): Google OAuth 클라이언트(Google Cloud Console에서 발급, redirect `http://localhost:3000/api/auth/callback/google`), `NEXTAUTH_SECRET`(`openssl rand -base64 32`), `GEMINI_API_KEY`.

- [ ] **Step 2: 전체 테스트**

Run: `npm test`
Expected: 전 파일 PASS

- [ ] **Step 3: 로컬 실행 + 수동 검증**

Run: `npm run dev`
1. `http://localhost:3000` 접속 → 구글 로그인(@daangnservice.com 계정) → 통과 확인, 타 도메인은 거부 확인.
2. 무음이 포함된 짧은 샘플 m4a 업로드 → 점수 3종 + 총평 + 공백 타임라인이 표시되는지 확인.
3. 슬라이더 값을 바꿔 다시 업로드 → 공백 개수/구간이 임계값에 따라 달라지는지 확인.

- [ ] **Step 4: README 실행 섹션 갱신**

`README.md`에 "로컬 실행"(의존성, `.env.local`, `npm run dev`)과 "2단계(AWS 이전) 예정" 메모 추가.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add local run instructions"
```

---

## Self-Review (계획 검토 결과)

- **스펙 커버리지**: 구글 SSO(Task 6) · m4a 업로드/검증(Task 7) · ffmpeg 무음 초단위(Task 2) · Gemini 3항목 평가(Task 4) · 공백 데이터 프롬프트 동봉(Task 4 `buildEvaluationPrompt`) · 병합/AI 실패 폴백(Task 5) · 점수+총평+타임라인 UI(Task 8) · 임계값 슬라이더(Task 8) · 순수모듈 격리(lib/*, 2단계 대비) — 스펙 §2~§13 항목 모두 대응.
- **플레이스홀더**: 없음(모든 코드 스텝에 실제 코드 포함).
- **타입 일관성**: `EvaluationResult`/`Evaluation`/`Silence`/`SilenceSummary`/`Threshold`/`ScoreDetail`는 Task 1 정의를 Task 2·4·5·7·8이 동일 시그니처로 사용. `evaluateFile(filePath, {minSilenceSec, noiseDb})` 시그니처가 Task 5 정의와 Task 7 호출에서 일치.
- **알려진 한계(문서화됨)**: Vercel 배포 시 4.5MB/60초 제한 → 긴 파일은 2단계(S3+Lambda)에서 해소. 1단계는 로컬 검증이 주.

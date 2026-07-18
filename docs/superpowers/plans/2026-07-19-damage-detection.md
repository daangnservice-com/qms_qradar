# 파손 판별 (Vision AI) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `call-quality-eval` 앱에 두 번째 탭 `/damage`를 추가해, 상품 사진 여러 장(1장 이상)을 올리면 Gemini 비전이 파손 여부(파손됨/정상/불확실)·신뢰도·부위/유형·사진별 코멘트를 판정해 보여준다.

**Architecture:** `POST /api/damage`가 멀티파트로 이미지들을 받아 임시 저장 후 `lib/vision.ts`(HTTP 비의존 순수 모듈)를 동기로 호출한다. 각 이미지를 Gemini File API로 업로드(원본 해상도)해 한 번의 호출로 전부 참조하여 판정한다. 사이드바는 실제 라우팅(`/` 콜 품질 평가, `/damage` 파손 판별)으로 전환하고 공통 셸을 `app/layout.tsx`로 올린다.

**Tech Stack:** Next.js 15 · TypeScript · Tailwind v4 · `@google/generative-ai`(gemini-2.5-flash, File API) · Vitest. **새 의존성 없음.**

## Global Constraints

- 기존 앱에 추가. 새 npm 의존성 도입 금지(모두 설치돼 있음).
- `lib/vision.ts`는 `next`/HTTP API 비의존(2단계 이식 대상). 타입은 `lib/types.ts`에 추가.
- 임시파일은 기존 `lib/audio.ts`의 `saveTempFile(bytes, ext)` / `cleanupTempFile(path)` 재사용. env 파싱은 기존 `lib/env.ts`의 `numEnv(name, fallback)` 재사용.
- Gemini: `GEMINI_API_KEY`, 모델 `GEMINI_MODEL` 기본 `gemini-2.5-flash`. 이미지는 **File API 업로드 후 참조**, 판정 후 삭제.
- 입력: `.jpg/.jpeg/.png/.webp`만, 최대 `MAX_IMAGES`(기본 8)장, 각 `MAX_IMAGE_MB`(기본 10)MB. 최소 1장.
- 판정 verdict enum: **"파손됨" | "정상" | "불확실"** (정확히 이 3개 문자열). `정상`이면 findings 빈 배열.
- 모든 AI 출력 텍스트는 한국어.
- 커밋 메시지는 한국어. `git push`는 하지 않음(사용자가 직접).
- 테스트: Vitest. 순수 함수 TDD, 외부(Gemini)는 목/미테스트.

---

## 파일 구조

```
lib/
  types.ts            (수정) DamageVerdict·DamageFinding·PerPhotoNote·DamageResult 추가
  vision.ts           (신규) buildDamagePrompt · parseDamageResult · runDamageDetection
app/
  layout.tsx          (수정) 공통 셸(Sidebar + main)로 전환
  page.tsx            (수정) 콜 품질 평가 '본문만' (셸 제거)
  damage/page.tsx     (신규) 파손 판별 화면
  api/damage/route.ts (신규) 멀티파트 파싱·검증·호출
components/
  Sidebar.tsx         (수정) 네비 2개 + usePathname 활성
  damage/DamageUpload.tsx     (신규) 다중 이미지 드롭존 + 썸네일
  damage/VerdictBadge.tsx     (신규) 판정 배지
  damage/DamageResultView.tsx (신규) 결과 렌더
test/fixtures/damage-response.json (신규) Gemini 응답 샘플
```

---

## Task 1: 파손 타입 + Gemini 비전 모듈

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/vision.ts`, `lib/vision.test.ts`, `test/fixtures/damage-response.json`

**Interfaces:**
- Produces:
  - `type DamageVerdict = "파손됨" | "정상" | "불확실"`
  - `interface DamageFinding { location: string; type: string; description: string }`
  - `interface PerPhotoNote { index: number; note: string }`
  - `interface DamageResult { verdict: DamageVerdict; confidence: number; summary: string; findings: DamageFinding[]; perPhoto: PerPhotoNote[] }`
  - `buildDamagePrompt(imageCount: number): string`
  - `parseDamageResult(jsonText: string): DamageResult`
  - `runDamageDetection(images: { path: string; mimeType: string }[]): Promise<DamageResult>`

- [ ] **Step 1: 타입 추가**

`lib/types.ts` 끝에 추가:

```ts
export type DamageVerdict = "파손됨" | "정상" | "불확실";
export interface DamageFinding { location: string; type: string; description: string; }
export interface PerPhotoNote { index: number; note: string; }
export interface DamageResult {
  verdict: DamageVerdict;
  confidence: number;
  summary: string;
  findings: DamageFinding[];
  perPhoto: PerPhotoNote[];
}
```

- [ ] **Step 2: fixture 작성**

`test/fixtures/damage-response.json`:

```json
{
  "verdict": "파손됨",
  "confidence": 0.87,
  "summary": "후면 우측 하단 모서리에 긁힘이 확인됨",
  "findings": [
    { "location": "우측 하단 모서리", "type": "긁힘", "description": "3cm 가량 긁힌 자국" }
  ],
  "perPhoto": [
    { "index": 0, "note": "정면 — 특이사항 없음" },
    { "index": 1, "note": "후면 — 모서리 파손 확인" }
  ]
}
```

- [ ] **Step 3: 실패 테스트 작성**

`lib/vision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDamagePrompt, parseDamageResult } from "./vision";

describe("buildDamagePrompt", () => {
  it("includes verdict rules, 불확실 case, and Korean instruction", () => {
    const p = buildDamagePrompt(3);
    expect(p).toContain("3장");
    expect(p).toContain("파손됨");
    expect(p).toContain("정상");
    expect(p).toContain("불확실");
    expect(p).toContain("여러 각도");
    expect(p).toContain("한국어");
  });
});

describe("parseDamageResult", () => {
  it("parses a well-formed response", () => {
    const raw = readFileSync(path.resolve(__dirname, "../test/fixtures/damage-response.json"), "utf8");
    const r = parseDamageResult(raw);
    expect(r.verdict).toBe("파손됨");
    expect(r.confidence).toBeCloseTo(0.87, 2);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].type).toBe("긁힘");
    expect(r.perPhoto[1].note).toContain("후면");
  });

  it("tolerates code fences and defaults missing arrays", () => {
    const r = parseDamageResult('```json\n{"verdict":"정상","confidence":0.9,"summary":"이상 없음"}\n```');
    expect(r.verdict).toBe("정상");
    expect(r.findings).toEqual([]);
    expect(r.perPhoto).toEqual([]);
  });

  it("falls back to 불확실 for an unknown verdict", () => {
    const r = parseDamageResult('{"verdict":"몰라요","confidence":0.1,"summary":"","findings":[],"perPhoto":[]}');
    expect(r.verdict).toBe("불확실");
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run lib/vision.test.ts`
Expected: FAIL (함수 미정의)

- [ ] **Step 5: 구현 작성**

`lib/vision.ts`:

```ts
import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import type { DamageResult, DamageVerdict } from "./types";

const VERDICTS: DamageVerdict[] = ["파손됨", "정상", "불확실"];

export function buildDamagePrompt(imageCount: number): string {
  return [
    `당신은 중고거래 반품/분쟁을 돕는 상품 파손 판정 전문가입니다. 첨부된 사진 ${imageCount}장은 하나의 상품을 여러 각도에서 찍은 것입니다.`,
    "사물 종류와 무관하게 물리적 손상(긁힘/찍힘/파열·찢어짐/깨짐/오염/변형/부품 누락 등)이 있는지 종합적으로 판정하세요.",
    "",
    "판정 규칙:",
    "- verdict: 파손이 명확하면 '파손됨', 손상이 없으면 '정상', 사진이 불충분하거나 애매하면 '불확실'.",
    "- confidence: 0.0~1.0 확신도.",
    "- summary: 한 줄 종합 소견. '불확실'이면 어떤 사진/각도가 더 필요한지 적으세요.",
    "- findings: 파손 근거 목록(부위 location · 유형 type · 설명 description). '정상'이면 빈 배열.",
    "- perPhoto: 각 사진(index는 0부터)마다 코멘트(note).",
    "",
    "모든 텍스트는 한국어로. 반드시 지정된 JSON 스키마로만 응답하세요.",
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["파손됨", "정상", "불확실"] },
    confidence: { type: "number" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { location: { type: "string" }, type: { type: "string" }, description: { type: "string" } },
        required: ["location", "type", "description"],
      },
    },
    perPhoto: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, note: { type: "string" } },
        required: ["index", "note"],
      },
    },
  },
  required: ["verdict", "confidence", "summary", "findings", "perPhoto"],
} as const;

export function parseDamageResult(jsonText: string): DamageResult {
  const cleaned = jsonText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const o = JSON.parse(cleaned);
  const verdict: DamageVerdict = VERDICTS.includes(o.verdict) ? o.verdict : "불확실";
  return {
    verdict,
    confidence: Number(o.confidence ?? 0),
    summary: String(o.summary ?? ""),
    findings: Array.isArray(o.findings)
      ? o.findings.map((f: { location: string; type: string; description: string }) => ({
          location: String(f.location),
          type: String(f.type),
          description: String(f.description),
        }))
      : [],
    perPhoto: Array.isArray(o.perPhoto)
      ? o.perPhoto.map((p: { index: number; note: string }) => ({ index: Number(p.index), note: String(p.note) }))
      : [],
  };
}

export async function runDamageDetection(
  images: { path: string; mimeType: string }[],
): Promise<DamageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const fileManager = new GoogleAIFileManager(apiKey);
  const uploadedNames: string[] = [];

  try {
    const parts: { fileData: { fileUri: string; mimeType: string } }[] = [];
    for (let i = 0; i < images.length; i++) {
      const up = await fileManager.uploadFile(images[i].path, {
        mimeType: images[i].mimeType,
        displayName: `img-${i}`,
      });
      uploadedNames.push(up.file.name);
      let file = await fileManager.getFile(up.file.name);
      let attempts = 0;
      while (file.state === FileState.PROCESSING) {
        if (attempts >= 30) throw new Error("Gemini 이미지 처리 시간 초과");
        await new Promise((r) => setTimeout(r, 1000));
        file = await fileManager.getFile(up.file.name);
        attempts++;
      }
      if (file.state === FileState.FAILED) throw new Error("Gemini 이미지 처리 실패");
      parts.push({ fileData: { fileUri: file.uri, mimeType: file.mimeType } });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({
      model,
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA as unknown as Schema },
    });
    const result = await gm.generateContent([...parts, { text: buildDamagePrompt(images.length) }]);
    return parseDamageResult(result.response.text());
  } finally {
    await Promise.all(uploadedNames.map((n) => fileManager.deleteFile(n).catch(() => {})));
  }
}
```

- [ ] **Step 6: 통과 확인 + 타입 체크**

Run: `npx vitest run lib/vision.test.ts` → Expected: PASS (3 describe 블록)
Run: `npx tsc --noEmit` → Expected: 에러 없음

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/vision.ts lib/vision.test.ts test/fixtures/damage-response.json
git commit -m "feat: 파손 판별 타입 및 Gemini 비전 모듈 추가"
```

---

## Task 2: /api/damage 라우트

**Files:**
- Create: `app/api/damage/route.ts`, `app/api/damage/route.test.ts`

**Interfaces:**
- Consumes: `runDamageDetection` (`lib/vision.ts`), `saveTempFile`/`cleanupTempFile` (`lib/audio.ts`), `numEnv` (`lib/env.ts`)
- Produces: `POST(req: Request): Promise<Response>` — `multipart/form-data`의 `images`(다중) → `DamageResult` JSON. 검증 실패 400, 처리 실패 500.

- [ ] **Step 1: 실패 테스트 작성 (vision/audio 목)**

`app/api/damage/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/vision", () => ({ runDamageDetection: vi.fn() }));
vi.mock("@/lib/audio", () => ({ saveTempFile: vi.fn(), cleanupTempFile: vi.fn() }));

import { runDamageDetection } from "@/lib/vision";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { POST } from "./route";

function form(files: { name: string; type: string; body: string }[]) {
  const fd = new FormData();
  for (const f of files) fd.append("images", new File([f.body], f.name, { type: f.type }));
  return new Request("http://localhost/api/damage", { method: "POST", body: fd });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/damage", () => {
  it("rejects zero images with 400", async () => {
    const res = await POST(new Request("http://localhost/api/damage", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported format with 400", async () => {
    const res = await POST(form([{ name: "a.gif", type: "image/gif", body: "x" }]));
    expect(res.status).toBe(400);
  });

  it("returns the damage result on success", async () => {
    (saveTempFile as any).mockResolvedValue("/tmp/x.jpg");
    (runDamageDetection as any).mockResolvedValue({
      verdict: "정상", confidence: 0.9, summary: "이상 없음", findings: [], perPhoto: [{ index: 0, note: "정면" }],
    });
    const res = await POST(form([{ name: "a.jpg", type: "image/jpeg", body: "x" }]));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verdict).toBe("정상");
    expect(cleanupTempFile).toHaveBeenCalledWith("/tmp/x.jpg");
    expect((runDamageDetection as any).mock.calls[0][0]).toEqual([{ path: "/tmp/x.jpg", mimeType: "image/jpeg" }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run app/api/damage/route.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 작성**

`app/api/damage/route.ts`:

```ts
import { NextResponse } from "next/server";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { runDamageDetection } from "@/lib/vision";
import { numEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel 배포 시 상한(로컬은 무제한)

const ALLOWED = new Map<string, string>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

export async function POST(req: Request): Promise<Response> {
  const temp: string[] = [];
  try {
    const fd = await req.formData();
    const files = fd.getAll("images").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "이미지를 1장 이상 올려주세요." }, { status: 400 });
    }
    const maxImages = numEnv("MAX_IMAGES", 8);
    if (files.length > maxImages) {
      return NextResponse.json({ error: `이미지는 최대 ${maxImages}장까지 올릴 수 있어요.` }, { status: 400 });
    }
    const maxMb = numEnv("MAX_IMAGE_MB", 10);

    const images: { path: string; mimeType: string }[] = [];
    for (const f of files) {
      const mime = ALLOWED.get(extOf(f.name));
      if (!mime) {
        return NextResponse.json({ error: `${f.name} — jpg/png/webp만 지원합니다.` }, { status: 400 });
      }
      if (f.size > maxMb * 1024 * 1024) {
        return NextResponse.json({ error: `${f.name} — 최대 ${maxMb}MB까지 가능합니다.` }, { status: 400 });
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const p = await saveTempFile(bytes, extOf(f.name));
      temp.push(p);
      images.push({ path: p, mimeType: mime });
    }

    const result = await runDamageDetection(images);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "처리 중 오류" }, { status: 500 });
  } finally {
    await Promise.all(temp.map(cleanupTempFile));
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run app/api/damage/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/damage/route.ts app/api/damage/route.test.ts
git commit -m "feat: /api/damage 멀티파트 라우트 및 검증 추가"
```

---

## Task 3: 사이드바 라우팅 전환 + 공통 셸

**Files:**
- Modify: `app/layout.tsx`, `app/page.tsx`, `components/Sidebar.tsx`

**Interfaces:**
- Produces: `/`(콜 품질 평가)와 `/damage`가 공통 셸(사이드바) 아래 렌더. Sidebar는 `usePathname()` 기준 활성 표시.
- 이 Task는 구조 변경이라 단위테스트 없이 **기존 테스트 통과 + 빌드 + 렌더 스모크**로 검증한다(콜 툴 회귀 확인 포함).

- [ ] **Step 1: 공통 셸로 layout 전환**

`app/layout.tsx` 전체 교체:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "X팀 · 콜 품질 평가 / 파손 판별",
  description: "CS 콜 품질 평가와 상품 파손 판별 테스트 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="flex min-h-screen bg-white">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 콜 품질 페이지를 본문만 남기기**

`app/page.tsx` 전체 교체(기존 셸/사이드바 제거, 내용 동일):

```tsx
"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import UploadForm from "@/components/UploadForm";
import ResultView from "@/components/ResultView";

export default function Home() {
  const [result, setResult] = useState<EvaluationResult | null>(null);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <header className="border-b border-gray-100 pb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <Phone className="h-5 w-5 text-navy" />
          콜 품질 평가
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          상담 통화 녹음을 업로드하면 AI가 품질을 평가하고 공백(검색 대기) 구간을 초 단위로 분석해요
        </p>
      </header>
      <div className="mt-8">
        <UploadForm onResult={setResult} />
        {result && <ResultView result={result} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar를 실제 라우팅으로 교체**

`components/Sidebar.tsx` 전체 교체:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, PanelLeftClose, PanelLeftOpen, Phone, ScanSearch, type LucideIcon } from "lucide-react";

type NavItem = { label: string; href: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { label: "콜 품질 평가", href: "/", icon: Phone },
  { label: "파손 판별", href: "/damage", icon: ScanSearch },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={`${collapsed ? "w-16" : "w-64"} shrink-0 border-r border-gray-200 bg-surface flex flex-col transition-[width] duration-200`}
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <BookOpen className="h-5 w-5 shrink-0 text-brand" strokeWidth={2.2} />
        {!collapsed && <span className="truncate text-[15px] font-bold tracking-tight text-gray-900">X팀</span>}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className="ml-auto rounded-md p-1.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-navy"
        >
          {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                active ? "bg-navy font-semibold text-white shadow-sm" : "font-medium text-gray-600 hover:bg-gray-200/70 hover:text-gray-900"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.9} />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && <div className="px-4 py-4 text-[11px] leading-relaxed text-gray-400">X팀 · 테스트 도구</div>}
    </aside>
  );
}
```

- [ ] **Step 4: 기존 테스트 + 빌드 + 스모크**

Run: `npx vitest run` → Expected: 기존 테스트 전부 PASS(회귀 없음)
Run: `npm run build` → Expected: 성공
Run(스모크): `npm run dev` 후
```bash
curl -s http://localhost:3000/ | grep -q "콜 품질 평가" && echo "홈 OK"
curl -s http://localhost:3000/ | grep -q "파손 판별" && echo "사이드바에 파손 판별 탭 OK"
```
Expected: 둘 다 출력. (dev 서버 종료 잊지 말 것)

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/page.tsx components/Sidebar.tsx
git commit -m "refactor: 사이드바 실제 라우팅 전환 및 공통 셸 도입"
```

---

## Task 4: 파손 판별 UI

**Files:**
- Create: `components/damage/VerdictBadge.tsx`, `components/damage/VerdictBadge.test.tsx`, `components/damage/DamageUpload.tsx`, `components/damage/DamageResultView.tsx`, `app/damage/page.tsx`

**Interfaces:**
- Consumes: `DamageResult`, `DamageVerdict` (`lib/types.ts`)
- Produces: `/damage` 화면 — 다중 이미지 업로드 → `POST /api/damage` → 결과 렌더.

- [ ] **Step 1: 실패 테스트 작성 (VerdictBadge)**

`components/damage/VerdictBadge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VerdictBadge from "./VerdictBadge";

describe("VerdictBadge", () => {
  it("renders each verdict label with confidence", () => {
    const { rerender } = render(<VerdictBadge verdict="파손됨" confidence={0.87} />);
    expect(screen.getByText("파손됨")).toBeDefined();
    expect(screen.getByText(/87%/)).toBeDefined();
    rerender(<VerdictBadge verdict="정상" confidence={0.5} />);
    expect(screen.getByText("정상")).toBeDefined();
    rerender(<VerdictBadge verdict="불확실" confidence={0.2} />);
    expect(screen.getByText("불확실")).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run components/damage/VerdictBadge.test.tsx`
Expected: FAIL

- [ ] **Step 3: VerdictBadge 구현**

`components/damage/VerdictBadge.tsx`:

```tsx
import type { DamageVerdict } from "@/lib/types";

const STYLE: Record<DamageVerdict, string> = {
  파손됨: "bg-gap/10 text-gap ring-gap/30",
  정상: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  불확실: "bg-amber-50 text-amber-700 ring-amber-200",
};

export default function VerdictBadge({ verdict, confidence }: { verdict: DamageVerdict; confidence: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ring-1 ring-inset ${STYLE[verdict]}`}>
        {verdict}
      </span>
      <span className="text-sm text-gray-500">신뢰도 {Math.round(confidence * 100)}%</span>
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run components/damage/VerdictBadge.test.tsx`
Expected: PASS

- [ ] **Step 5: 업로드/결과/페이지 구현**

`components/damage/DamageUpload.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

function isAllowed(f: File): boolean {
  return /\.(jpe?g|png|webp)$/i.test(f.name);
}

export default function DamageUpload({
  files,
  onFiles,
  disabled,
  max = 8,
}: {
  files: File[];
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function add(incoming: FileList | null) {
    if (!incoming) return;
    const picked = Array.from(incoming);
    const ok = picked.filter(isAllowed);
    if (ok.length < picked.length) setMsg("jpg/png/webp만 추가돼요.");
    else setMsg(null);
    const merged = [...files, ...ok].slice(0, max);
    onFiles(merged);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) add(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        } ${dragging ? "border-navy bg-navy/[0.04]" : "border-gray-300 bg-surface/60 hover:border-navy/50 hover:bg-surface"} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy`}
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-navy shadow-sm ring-1 ring-gray-200">
          <ImagePlus className="h-6 w-6" strokeWidth={1.8} />
        </div>
        <p className="text-[15px] font-semibold text-gray-800">상품 사진을 드래그하거나 클릭해서 추가</p>
        <p className="mt-1.5 text-[13px] text-gray-400">jpg · png · webp / 최대 {max}장 (여러 각도 권장)</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          disabled={disabled}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-hover disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" />
          사진 선택
        </button>
      </div>

      {msg && <p className="mt-3 text-sm text-gap">{msg}</p>}

      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((f, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt={`업로드 ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
                disabled={disabled}
                aria-label="사진 제거"
                className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => add(e.target.files)}
      />
    </div>
  );
}
```

`components/damage/DamageResultView.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { ClipboardList, Images } from "lucide-react";
import type { DamageResult } from "@/lib/types";
import VerdictBadge from "./VerdictBadge";

export default function DamageResultView({ result, files }: { result: DamageResult; files: File[] }) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold tracking-tight text-gray-900">판정 결과</h2>
        <span className="h-px flex-1 bg-gray-100" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <VerdictBadge verdict={result.verdict} confidence={result.confidence} />
        <p className="mt-3 text-sm leading-relaxed text-gray-700">{result.summary}</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <ClipboardList className="h-4 w-4 text-navy" />
          파손 근거
        </h3>
        {result.findings.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">발견된 파손 없음</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {result.findings.map((f, i) => (
              <li key={i} className="text-sm text-gray-700">
                <span className="font-semibold text-gray-900">{f.location}</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span className="inline-block rounded-md bg-gap/10 px-1.5 py-0.5 text-xs font-medium text-gap">{f.type}</span>
                <span className="ml-2">{f.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {urls.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Images className="h-4 w-4 text-navy" />
            사진별 코멘트
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {urls.map((url, i) => {
              const note = result.perPhoto.find((p) => p.index === i)?.note;
              return (
                <div key={i} className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`사진 ${i + 1}`} className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
                  <p className="text-sm text-gray-600">{note ?? "코멘트 없음"}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
```

`app/damage/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ScanSearch, Loader2, AlertCircle } from "lucide-react";
import type { DamageResult } from "@/lib/types";
import DamageUpload from "@/components/damage/DamageUpload";
import DamageResultView from "@/components/damage/DamageResultView";

export default function DamagePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<DamageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      const res = await fetch("/api/damage", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "판별에 실패했어요");
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "판별에 실패했어요");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <header className="border-b border-gray-100 pb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <ScanSearch className="h-5 w-5 text-navy" />
          파손 판별
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          상품 사진을 여러 각도로 올리면 AI가 파손 여부·부위·유형을 판정해요 (중고거래 반품/분쟁용)
        </p>
      </header>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <DamageUpload files={files} onFiles={setFiles} disabled={loading} />
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={files.length === 0 || loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              판별 중…
            </>
          ) : (
            <>
              <ScanSearch className="h-4 w-4" />
              파손 판별 시작
            </>
          )}
        </button>
      </form>

      {result && <DamageResultView result={result} files={files} />}
    </div>
  );
}
```

- [ ] **Step 6: 통과 확인 + 빌드**

Run: `npx vitest run` → Expected: 전체 PASS
Run: `npx tsc --noEmit` → Expected: 에러 없음
Run: `npm run build` → Expected: 성공(`/damage` 라우트 생성 확인)

- [ ] **Step 7: Commit**

```bash
git add components/damage app/damage/page.tsx
git commit -m "feat: 파손 판별 UI(다중 업로드·판정 배지·결과) 추가"
```

---

## Task 5: 통합 스모크 + 문서

**Files:**
- Modify: `README.md`

**Interfaces:** 없음(수동 검증)

- [ ] **Step 1: 전체 테스트/빌드**

Run: `npm test` → Expected: 전 파일 PASS
Run: `npm run build` → Expected: 성공

- [ ] **Step 2: 로컬 수동 검증**

Run: `npm run dev`
1. `http://localhost:3000/damage` 접속 → 사이드바 "파손 판별" 활성 확인.
2. 상품 사진 2~3장(jpg/png/webp) 업로드 → 썸네일 표시 확인 → "파손 판별 시작".
3. 판정 배지(파손됨/정상/불확실) + 신뢰도 + 파손 근거 + 사진별 코멘트 표시 확인.
4. 콜 품질 평가 탭(`/`)도 정상 동작하는지 회귀 확인.
5. 지원 안 되는 포맷(gif 등) 업로드 시 거부 메시지 확인.

- [ ] **Step 3: README 갱신**

`README.md`에 "파손 판별" 탭 소개(입력 jpg/png/webp·최대 8장, 판정 파손됨/정상/불확실, Gemini File API) 및 관련 문서 링크 추가.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: 파손 판별 탭 README 반영"
```

---

## Self-Review (계획 검토 결과)

- **스펙 커버리지**: 다중 이미지 업로드/썸네일(Task 4) · Gemini 비전 판정(Task 1) · File API 업로드+삭제(Task 1 `runDamageDetection`) · 판정 3종+신뢰도+부위/유형+사진별(Task 1 타입·Task 4 UI) · 검증(포맷/장수/용량/0장, Task 2) · 사이드바 2탭 라우팅(Task 3) · 한 상품 여러 각도 종합판정(Task 1 프롬프트) — 스펙 §3~§11 대응.
- **플레이스홀더**: 없음(모든 코드 스텝에 실제 코드).
- **타입 일관성**: `DamageResult`/`DamageVerdict`/`DamageFinding`/`PerPhotoNote`는 Task 1 정의를 Task 2·4가 동일 사용. `runDamageDetection(images: {path, mimeType}[])` 시그니처가 Task 1 정의와 Task 2 호출에서 일치. `saveTempFile`/`cleanupTempFile`/`numEnv`는 기존 모듈 시그니처 그대로 사용.
- **회귀 주의(문서화됨)**: Task 3가 기존 콜 툴의 셸을 옮기므로, 기존 Vitest 전체 + 빌드 + `/` 스모크로 회귀 확인.
- **알려진 한계**: HEIC 미지원(1단계), Vercel 배포 시 총 업로드 4.5MB 제한 → 2단계(S3)에서 해소.

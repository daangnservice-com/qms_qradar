# call-quality-eval

X팀 **내부 테스트용 사이트**. 구글 SSO 로그인 뒤에서 동작하며, 사이드바 **2탭**으로 구성돼 있습니다.

| 탭 | 하는 일 |
|----|---------|
| **콜 품질 평가** | CS 콜 녹음(m4a)을 올리면 AI가 품질을 평가하고 공백(무음)을 초 단위로 측정 + 전체 대화 스크립트 |
| **파손 판별 (Vision AI)** | 상품 사진을 여러 장 올리면 AI가 파손 여부·부위·유형을 판정하고 **사진 위에 빨간 박스로 표시**(중고거래 반품/분쟁용) |

- 배포: **Vercel** (프로덕션: `https://call-quality-eval-theta.vercel.app`)
- 접근: **@daangnservice.com 구글 계정만** 로그인 가능. 외부 검색엔진에는 **노출 안 됨(noindex + robots 차단)**.

> **단계**: 지금은 **1단계 — AWS 없이 Next.js 단독 동기 처리**. 대용량 업로드·장시간 처리(S3+Lambda 비동기)는 인프라실 협의 후 **2단계**.

---

## 접근 / 로그인 (SSO)

- **NextAuth v4 + Google OAuth**. `lib/auth.ts`의 `signIn` 콜백에서 이메일 도메인을 검증해 `@daangnservice.com`이 아니면 거부.
- `middleware.ts`가 `/login`·`/api/auth`·정적 리소스·`robots.txt`를 제외한 **모든 경로를 보호** → 미로그인 시 `/login`으로 리다이렉트. 두 탭 공통.
- 로그인 화면(`/login`)은 사이드바 없이, "X팀이 현재 개발중인 테스트 페이지입니다." 안내 + 구글 로그인 버튼.
- 사이드바 하단에 로그인 이메일 + 로그아웃.

> ⚠️ **OAuth 값이 없으면 로컬에서도 로그인 불가**(→ /login으로 튕김). 아래 "환경변수"·"배포" 참고.

---

## 탭 1 — 콜 품질 평가

**입력**: 통화 녹음 `.m4a` (10~30분+), 한 번에 한 개 (드래그앤드롭 또는 파일 선택)
**평가 항목**: 응대 태도 / 문제 해결력 / 대화 흐름·공백 (각 1~5점)
**결과**: 항목별 점수 카드 + 총평 + **초 단위 공백 타임라인** + **전체 대화 스크립트**(화자·타임스탬프)
**공백 기준**: 기본 3초 이상(화면 슬라이더로 1~10초 조절)

**아키텍처 (이중 파이프라인)**
1. **ffmpeg `silencedetect`** — 신호 기반으로 무음 구간을 초 단위로 정확히 추출 (신뢰 소스)
2. **Gemini 2.5 Flash** — 오디오를 직접 평가(태도/해결력/흐름) + **전체 전사**. 1번의 공백 데이터를 프롬프트에 동봉해 근거 있는 코멘트 생성. AI가 실패해도 공백 결과는 유지.

> 공백 타임라인은 ffmpeg 신호 기반이라 초 단위로 정확, 전사 타임스탬프는 Gemini 추정치라 근사값.

---

## 탭 2 — 파손 판별 (Vision AI)

**입력**: 상품 사진 `.jpg/.jpeg/.png/.webp`, 1~8장 (각 ≤10MB)
**판정**: **파손됨 / 정상 / 불확실** + 신뢰도(%)
**결과**: 판정 배지 + 종합 소견 + 파손 근거(부위·유형·설명, 번호 매김) + **사진별 오버레이**
**용도**: 중고거래 반품/분쟁 판정 근거

**동작**
- 여러 사진을 **한 번의 Gemini 호출**에 함께 넣어 종합 판정. 사물 종류와 무관하게 물리적 손상(긁힘/찍힘/파열/깨짐/오염/변형/부품 누락 등) 판별.
- 이미지는 **Gemini File API 업로드**(원본 해상도 유지 → 미세 손상까지). 판정 후 업로드 파일 정리.

**파손 부위 시각화 (박스 오버레이)**
- 각 파손 근거에 `photoIndex` + 바운딩 박스(`{ymin,xmin,ymax,xmax}` 0~1000 정규화)를 받아, 원본 사진 위에 **빨간 사각형 + 번호(①②③)**로 표시. 근거 리스트와 번호가 매칭되고, 항목에 마우스를 올리면 해당 박스가 강조.
- **정확도 튜닝(A)**: `temperature=0`, "손·배경이 아니라 실제 손상 지점만 타이트하게", "확실치 않으면 박스 없음(null)" 지시로 엉뚱한 박스를 줄임.
- 박스는 Gemini **근사값**(픽셀 정확 X). 더 필요하면 후속 레버 — B(부위별 집중 재검출), C(`gemini-2.5-pro`).

> **HEIC 미지원(1단계)**: 아이폰 기본 HEIC는 Gemini가 직접 못 받아 제외. jpg/png/webp로 올려주세요.

---

## 기술 스택

- **Next.js 15 (App Router)** / TypeScript / **Tailwind CSS v4** (CSS-first, `@theme`)
- **인증**: NextAuth v4 (Google OAuth, `@daangnservice.com` 도메인 제한)
- **AI**: Google `gemini-2.5-flash` (`@google/generative-ai`) — 오디오·이미지 **File API**
- **무음 감지**: `ffmpeg-static`
- **모니터링**: `@vercel/analytics`
- **테스트**: Vitest (+ @testing-library/react)
- **아이콘**: lucide-react

---

## 프로젝트 구조

```
app/
  layout.tsx              # 최소 루트: SessionProvider + SEO 차단 메타 + <Analytics/>
  login/page.tsx          # 로그인 화면 (사이드바 없음)
  robots.ts               # /robots.txt (전체 Disallow)
  (main)/                 # 로그인 뒤 영역 (사이드바 셸)
    layout.tsx            #   사이드바 + 메인
    page.tsx              #   콜 품질 평가 (/)
    damage/page.tsx       #   파손 판별 (/damage)
  api/
    auth/[...nextauth]/   # NextAuth 핸들러
    evaluate/route.ts     # 콜 평가 API
    damage/route.ts       # 파손 판별 API
lib/                      # HTTP 비의존 순수 모듈 (2단계 Lambda 이식 대비)
  auth.ts  types.ts  format.ts  env.ts  audio.ts
  silence.ts  gemini.ts  evaluate.ts        # 콜 품질
  vision.ts                                 # 파손 판별
components/               # Sidebar, 콜/파손 UI 컴포넌트
middleware.ts             # 인증 게이트 (미로그인 → /login)
```

- `lib/*` 처리 모듈은 `next`/HTTP에 의존하지 않아 그대로 테스트·이식 가능.

---

## 환경변수

`.env.local`(로컬)과 Vercel 프로젝트 환경변수(배포) 양쪽에 설정합니다.

| 변수 | 용도 | 예시 / 기본값 |
|------|------|---------------|
| `GEMINI_API_KEY` | Gemini 호출 키 (**필수**) | — |
| `GEMINI_MODEL` | 모델명 | `gemini-2.5-flash` |
| `GOOGLE_CLIENT_ID` | 구글 OAuth 클라이언트 ID (**필수**) | — |
| `GOOGLE_CLIENT_SECRET` | 구글 OAuth 시크릿 (**필수**) | — |
| `NEXTAUTH_SECRET` | 세션 서명 키 (**필수**) | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | 서비스 URL | 로컬 `http://localhost:3000` / 배포 시 배포 도메인 |
| `ALLOWED_EMAIL_DOMAIN` | 로그인 허용 도메인 | `daangnservice.com` |
| `SILENCE_NOISE_DB` | 무음 감지 dB 임계 | `-30` |
| `MAX_UPLOAD_MB` | 콜 녹음 최대 크기 | `200` |
| `MAX_IMAGES` | 파손 판별 최대 장수 | `8` |
| `MAX_IMAGE_MB` | 파손 이미지 장당 최대 | `10` |

> 참고: 저장소의 예시 파일명은 `.env.local copy.example` 입니다.

---

## 로컬 실행

```bash
# 1) 의존성
npm install                 # .npmrc(legacy-peer-deps=true) 포함

# 2) .env.local 작성 (위 표 참고). SSO 값이 없으면 로그인 화면에서 못 넘어갑니다.
#    - GEMINI_API_KEY
#    - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  (구글 클라우드 콘솔 발급)
#    - NEXTAUTH_SECRET (openssl rand -base64 32) / NEXTAUTH_URL=http://localhost:3000
#    - ALLOWED_EMAIL_DOMAIN=daangnservice.com

# 3) 개발 서버
npm run dev                 # http://localhost:3000 → 구글 로그인 → 사용

# 테스트 / 빌드
npm test
npm run build
```

**구글 OAuth 클라이언트 발급 (로컬)**
1. [Google Cloud Console](https://console.cloud.google.com) → OAuth 동의 화면(내부/Internal 권장) → 사용자 인증 정보 → **OAuth 클라이언트 ID(웹)**
2. **승인된 자바스크립트 원본**: `http://localhost:3000`
3. **승인된 리디렉션 URI**: `http://localhost:3000/api/auth/callback/google`
4. 발급된 ID/시크릿을 `.env.local`에

> 로컬 `next dev`는 요청 크기/시간 제한이 없어 30분 파일도 동작. Vercel(Hobby)은 요청 본문 4.5MB·실행 60초 제한이 있어 **긴 파일/대용량 업로드는 실패 가능** → 2단계(S3+Lambda)에서 해소.

---

## 배포 (Vercel)

1. **Vercel 프로젝트 환경변수**에 위 표의 변수를 모두 등록. `NEXTAUTH_URL`은 **배포 도메인**으로:
   ```
   NEXTAUTH_URL = https://call-quality-eval-theta.vercel.app
   ```
2. **구글 OAuth 클라이언트에 배포 도메인 추가** (localhost는 그대로 두고 추가):
   - 자바스크립트 원본: `https://call-quality-eval-theta.vercel.app`
   - 리디렉션 URI: `https://call-quality-eval-theta.vercel.app/api/auth/callback/google`
3. 환경변수/설정 변경 후 **재배포**해야 반영.

- **SEO**: 루트 메타 `noindex, nofollow` + `/robots.txt` 전체 Disallow → 외부 검색 노출 안 됨.
- **Analytics**: `<Analytics/>`가 루트 레이아웃에 있어 배포 시 자동 수집(로컬은 no-op). Vercel 대시보드 Analytics 탭에서 확인.
- 프리뷰 배포(커밋별 URL)는 리디렉션 URI에 없어 로그인 불가 — 프로덕션 도메인에서만 로그인됩니다.

---

## 상태 / 로드맵

- **1단계 (완료)**: 두 탭(콜 품질 평가·파손 판별) + 파손 박스 오버레이 + **구글 SSO** + **외부 검색 차단** + **Vercel Analytics**. AWS 없이 동기 처리.
- **2단계 (예정, 인프라 협의 후)**: S3 presigned 업로드 + AWS Lambda 비동기 처리(대용량·장시간 대응).
- **후속 개선**: 파손 박스 정확도 B(부위별 재검출)/C(pro 모델), 필요 시 HEIC 지원.

---

## 문서

**콜 품질 평가**
- 기술 명세서: [`docs/superpowers/specs/2026-07-18-call-quality-eval-design.md`](docs/superpowers/specs/2026-07-18-call-quality-eval-design.md)
- 구현 계획서: [`docs/superpowers/plans/2026-07-18-call-quality-eval.md`](docs/superpowers/plans/2026-07-18-call-quality-eval.md)

**파손 판별**
- 기술 명세서: [`docs/superpowers/specs/2026-07-19-damage-detection-design.md`](docs/superpowers/specs/2026-07-19-damage-detection-design.md)
- 구현 계획서: [`docs/superpowers/plans/2026-07-19-damage-detection.md`](docs/superpowers/plans/2026-07-19-damage-detection.md)

**개발일지**
- [`docs/devlog/2026-07-18_개발일지.md`](docs/devlog/2026-07-18_개발일지.md) — 콜 품질 평가
- [`docs/devlog/2026-07-19_개발일지.md`](docs/devlog/2026-07-19_개발일지.md) — 파손 판별 + 박스 오버레이

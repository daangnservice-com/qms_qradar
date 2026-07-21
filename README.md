# call-quality-eval (X팀 헬프데스크)

X팀 **내부 테스트용 사이트**(브라우저 탭 제목: **X팀 헬프데스크**). 구글 SSO 로그인 뒤에서 동작하며, 사이드바 탭(관리자는 **4탭**, 일반은 2탭)으로 구성돼 있습니다.

| 탭 | 하는 일 |
|----|---------|
| **콜 품질 평가** | CS 콜 녹음(m4a)을 올리면 AI가 품질을 평가하고 공백(무음)을 초 단위로 측정 + 전체 대화 스크립트 |
| **파손 판별 (Vision AI)** | 신청인·피신청인이 제출한 사진을 각각 올리면 AI가 **양측을 비교**해 파손 여부·부위·유형을 판정하고 **사진 위에 빨간 박스로 표시**(분쟁조정용). 결과에 **👍/👎 피드백** 수집 |
| **피드백** (관리자 전용) | 파손 판별 결과의 좋아요/나빠요 + 코멘트를 BigQuery(`damage_feedback`)에 적재. **프롬프트 버전별 만족도**·나쁜 사례 사진 리뷰로 프롬프트/모델 개선. `ADMIN_EMAILS`만 노출 |
| **사용량** (관리자 전용) | 누가·어떤 화면을·언제 접속했는지 BigQuery에 적재해 대시보드로 집계. `ADMIN_EMAILS`에만 탭·API 노출 |

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

**입력**: **신청인·피신청인** 사진을 각각 업로드 `.jpg/.jpeg/.png/.webp`, **파당 최대 5장**(각 ≤10MB). 한쪽만 올려도 판정 가능.
**판정**: **파손됨 / 정상 / 불확실** + 신뢰도(%)
**결과**: 판정 배지 + 종합 소견 + **양측 비교 소견** + 파손 근거(부위·유형·설명·**제출 측**, 번호 매김) + **사진별 오버레이(신청인/피신청인 분리)**
**용도**: 분쟁조정 — 양측이 제출한 증거 사진 비교 판정

**동작**
- 양측 사진을 **한 번의 Gemini 호출**에 함께 넣어 종합 판정. **통합 순서(신청인 사진 먼저, 그 뒤 피신청인)**로 `photoIndex`를 부여하고, `claimantCount`로 각 사진·근거의 제출 측(party)을 역산.
- `comparison` 필드로 **양측 사진 간 파손 표현의 차이·불일치**(한쪽엔 보이나 다른 쪽엔 안 보임, 각도/조명 차이, 동일 상품 의심 등)를 짚음.
- 사물 종류와 무관하게 물리적 손상(긁힘/찍힘/파열/깨짐/오염/변형/부품 누락 등) 판별.
- 이미지는 **Gemini File API 업로드**(원본 해상도 유지 → 미세 손상까지). 판정 후 업로드 파일 정리.
- 프롬프트/판정 로직 버전 `DAMAGE_PROMPT_VERSION`(현재 `v1`) — 피드백과 짝지어 버전별 품질 비교(Phase 2).

**판정에 대해 물어보기 (챗봇)**
- 결과 하단에 멀티턴 챗봇. "왜 이렇게 판단했어?" 등 질문 시 **원본 사진을 매 요청 재첨부**해 Gemini가 시각적으로 다시 살펴보고 답함(`lib/damageChat.ts`, `/api/damage/chat`).
- 서버 stateless → 대화 히스토리(최근 20턴)와 판정 결과 JSON을 함께 보내 문맥 유지. 응답 후 업로드 파일 정리.

**파손 부위 시각화 (박스 오버레이)**
- 각 파손 근거에 `photoIndex` + 바운딩 박스(`{ymin,xmin,ymax,xmax}` 0~1000 정규화)를 받아, 원본 사진 위에 **빨간 사각형 + 번호(①②③)**로 표시. 근거 리스트와 번호가 매칭되고, 항목에 마우스를 올리면 해당 박스가 강조.
- **정확도 튜닝(A)**: `temperature=0`, "손·배경이 아니라 실제 손상 지점만 타이트하게", "확실치 않으면 박스 없음(null)" 지시로 엉뚱한 박스를 줄임.
- 박스는 Gemini **근사값**(픽셀 정확 X). 더 필요하면 후속 레버 — B(부위별 집중 재검출), C(`gemini-2.5-pro`).

> **HEIC 미지원(1단계)**: 아이폰 기본 HEIC는 Gemini가 직접 못 받아 제외. jpg/png/webp로 올려주세요.

---

## 탭 3 — 사용량 (관리자 전용)

**목적**: 내부 테스트 단계에서 **누가·어떤 화면을·언제** 접속했는지 파악.
**접근 제한**: `lib/adminEmails.ts`의 `ADMIN_EMAILS`(현재 `karla@daangnservice.com`)에게만 사이드바 탭·`/usage`·`/api/stats/usage`가 열립니다. 그 외 로그인 사용자는 탭 자체가 안 보이고, API도 **403**.
**대시보드**: 총 조회수 / 접속 사용자 수 / 일별 접속량(경량 SVG 막대) / 화면별 접속 / 사용자별 접속(펼치면 화면별·마지막 접속). 기간 7·30·90일 토글.

**수집 동작**
- 라우트가 바뀔 때마다 `UsageTracker`가 현재 경로를 `navigator.sendBeacon`(폴백 `fetch keepalive`)으로 `POST /api/track`에 비차단 전송. 실패해도 UX 영향 없음(fire-and-forget).
- 서버는 세션 쿠키로 사용자를 식별해 BigQuery `usage_events`에 1건 적재. **비로그인·`/api`·`/_next`·`/login`은 집계 제외**, 항상 204 응답.
- 집계는 **한국시간(Asia/Seoul)** 기준 날짜로 묶고, 검증용 행(`event='__verify'`)은 제외.

**BigQuery**
- 대상: `striped-option-493506-a7.helpdesk_x.usage_events` (`asia-northeast3`). 데이터셋·테이블이 없으면 최초 1회 자동 생성.
- 인증: `GOOGLE_SERVICE_ACCOUNT_JSON`(서비스계정 키 JSON) 우선, 없으면 ADC(`GOOGLE_APPLICATION_CREDENTIALS`).

> 개인별 접속기록(개인정보)이 포함되므로 조회 권한을 `ADMIN_EMAILS`로 한정합니다. 관리자를 늘리려면 이 배열에 이메일 추가.

---

## 기술 스택

- **Next.js 15 (App Router)** / TypeScript / **Tailwind CSS v4** (CSS-first, `@theme`)
- **인증**: NextAuth v4 (Google OAuth, `@daangnservice.com` 도메인 제한)
- **AI**: Google `gemini-2.5-flash` (`@google/generative-ai`) — 오디오·이미지 **File API**
- **무음 감지**: `ffmpeg-static`
- **사용량 적재/집계**: BigQuery (`@google-cloud/bigquery`)
- **모니터링**: `@vercel/analytics`
- **테스트**: Vitest (+ @testing-library/react)
- **아이콘**: lucide-react

---

## 프로젝트 구조

```
app/
  layout.tsx              # 최소 루트: Providers + SEO 차단 메타 + <UsageTracker/> + <Analytics/>
  providers.tsx           # SessionProvider (클라이언트)
  login/page.tsx          # 로그인 화면 (사이드바 없음)
  robots.ts               # /robots.txt (전체 Disallow)
  (main)/                 # 로그인 뒤 영역 (사이드바 셸)
    layout.tsx            #   사이드바 + 메인
    page.tsx              #   콜 품질 평가 (/)
    damage/page.tsx       #   파손 판별 (/damage)
    usage/page.tsx        #   사용량 대시보드 (/usage, 관리자 전용)
  api/
    auth/[...nextauth]/   # NextAuth 핸들러
    evaluate/route.ts     # 콜 평가 API
    damage/route.ts       # 파손 판별 API
    track/route.ts        # 사용량 수집 (POST, fire-and-forget → 204)
    stats/usage/route.ts  # 사용량 집계 조회 (관리자만, 그 외 403)
lib/                      # HTTP 비의존 순수 모듈 (2단계 Lambda 이식 대비)
  auth.ts  types.ts  format.ts  env.ts  audio.ts
  silence.ts  gemini.ts  evaluate.ts        # 콜 품질
  vision.ts                                 # 파손 판별
  bigquery.ts  adminEmails.ts               # 사용량(BigQuery 적재/집계·관리자 판별)
components/               # Sidebar, 콜/파손 UI, UsageTracker(라우트 변경 추적)
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
| `MAX_IMAGES_PER_PARTY` | 파손 판별 **파당** 최대 장수(신청인/피신청인 각각) | `5` |
| `MAX_IMAGE_MB` | 파손 이미지 장당 최대 | `10` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 사용량·피드백 BigQuery/GCS 인증(서비스계정 키 JSON). 없으면 ADC 사용 | — |
| `GOOGLE_CLOUD_PROJECT_ID` | BigQuery/GCS 프로젝트 | `striped-option-493506-a7` |
| `BIGQUERY_DATASET_ID` | 사용량·피드백 데이터셋 | `helpdesk_x` |
| `BIGQUERY_LOCATION` | 데이터셋 리전 | `asia-northeast3` |
| `GCS_FEEDBACK_BUCKET` | 피드백 사진 보관 버킷(없으면 자동 생성) | `striped-option-493506-a7-helpdesk-x-feedback` |
| `GCS_LOCATION` | 피드백 버킷 리전 | `asia-northeast3` |

> 사용량 탭을 쓰지 않는 로컬에서는 `GOOGLE_SERVICE_ACCOUNT_JSON` 없이도 콜 품질/파손 판별 두 탭은 정상 동작합니다(트래킹만 조용히 실패).
> 파손 판별 **피드백 저장**(👍/👎)은 BigQuery(`damage_feedback`)와 GCS 버킷을 쓰므로 `GOOGLE_SERVICE_ACCOUNT_JSON`이 필요합니다. 버킷은 첫 저장 시 자동 생성되며(서비스계정에 `storage.buckets.create` 권한 필요) 사진은 **90일 후 자동 삭제**됩니다. 열람은 관리자 `/feedback` 탭 전용.

> 참고: 저장소의 예시 파일은 [`.env.local.example`](.env.local.example) 입니다.

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

- **1단계 (완료)**: 세 탭(콜 품질 평가·파손 판별·사용량) + 파손 박스 오버레이 + **구글 SSO** + **외부 검색 차단** + **Vercel Analytics** + **사용량 트래킹(BigQuery)·관리자 대시보드**. AWS 없이 동기 처리.
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

**서비스 구조**
- [`docs/helpdesk-x_서비스구조.md`](docs/helpdesk-x_서비스구조.md) — 전체 동작 구조 개요

**개발일지**
- [`docs/devlog/2026-07-18_개발일지.md`](docs/devlog/2026-07-18_개발일지.md) — 콜 품질 평가
- [`docs/devlog/2026-07-19_개발일지.md`](docs/devlog/2026-07-19_개발일지.md) — 파손 판별 + 박스 오버레이
- [`docs/devlog/2026-07-20_개발일지.md`](docs/devlog/2026-07-20_개발일지.md) — 사용량 트래킹 + 관리자 대시보드

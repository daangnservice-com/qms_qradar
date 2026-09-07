# call-quality-eval (QRadar)

**QRadar** — 당근서비스 콜 품질 평가 시스템(브라우저 탭 제목: **QRadar**). 구글 SSO 로그인 뒤에서 동작하며, 사이드바 탭은 **로그인 계정의 권한에 따라** 노출됩니다.


| 그룹 | 탭 | 하는 일 | 접근 |
| --- | --- | --- | --- |
| **평가 진행** | **전체 평가** · **고위험군 평가** | BQ 샘플 → Genesys 녹취 → **Google STT(듀얼채널)** → Gemini **CS 체크리스트** · 수기 검수 · 결과 저장/공유. 고위험군은 동일 워크벤치에 필터 ON | `CALL_QUALITY_EMAILS` |
| **평가 운영** | **평가 스케줄** · **평가 배분**(확정 배분) · **검수 현황** | 월별 일정 · 대상자/배분 시뮬 · 수기 검수 완료 케이스 통계(오탐/미탐·matrix·평가셋 비중) | 스케줄=로그인, 배분=`canAccessEvalOps`, 검수=`CALL_QUALITY_EMAILS` |
| 평가 설계 | **평가표 ~ AI 호출 사용량** | QMS IA: 평가표·항목(AI 평가 항목 하위)·정확도·비교·프롬프트 개선·LLM 사용량 ([docs/qms](docs/qms/00-overview.md)) | `canAccessAnyCallQuality` |
| 시스템 | **사용량** | 페이지뷰·기능 사용 BigQuery 집계 | `ADMIN_EMAILS` |
| 시스템 | **평가 스케줄**(job) | 진행 중/최근 AI 평가 job 보드(프로세스 메모리) | `ADMIN_EMAILS` |
| 도움말 | **이용 설명서** | 제품 가이드 (`/guide`) | 로그인 |


- 홈(`/`)은 권한에 따라 `/call-quality` · `/usage`로 리다이렉트됩니다.
- 배포: **PAB 내부 EC2 (Docker,** `output: standalone`**) — ALB 뒤**. 프로덕션: `https://helpdesk-x.daangnservice.com`
- 접근: **@daangnservice.com 구글 계정만** 로그인 가능. 외부 검색엔진에는 **노출 안 됨(noindex + robots 차단)**.

> **콜 분석은 상주 데몬형 처리**(Genesys 확보 + STT 장시간)라 Vercel 서버리스에 부적합 → EC2 Docker 상주로 운영합니다.  
> 구조·API·리팩토링 백로그: [docs/helpdesk-x_서비스구조.md](docs/helpdesk-x_서비스구조.md)

---

## 접근 / 로그인 (SSO)

- **NextAuth v4 + Google OAuth**. `lib/auth.ts`의 `signIn` 콜백에서 이메일 도메인을 검증해 `@daangnservice.com`이 아니면 거부.
- `middleware.ts`가 `/login`·`/api/auth`·정적 리소스·`robots.txt`를 제외한 **모든 경로를 보호** → 미로그인 시 `/login`으로 리다이렉트.
- 탭·API는 **이메일 화이트리스트**로 세분화(`lib/adminEmails.ts`): `ADMIN_EMAILS`(사용량·평가 스케줄), `CALL_QUALITY_EMAILS`(성장문화실 평가 진행), `canAccessAnyCallQuality`(평가 설계). 권한 없는 계정은 탭이 안 보이고 직접 접근해도 홈으로 돌아갑니다.
- 로그인 화면(`/login`)은 사이드바 없이 안내 문구 + 구글 로그인 버튼. 사이드바 하단에 로그인 이메일 + 로그아웃.

> ⚠️ **OAuth 값이 없으면 로컬에서도 로그인 불가**(→ /login으로 튕김). 아래 "환경변수"·"배포" 참고.

---

## 평가 진행 (성장문화실)

> ⚠️ **관리자/권한자 전용 기능.** 일반 상담원 대상이 아니며, @헬비(에이전트 봇)는 이 기능을 상담원에게 안내하지 않습니다.

CS 통화를 **점수 매김이 아니라 "뜯어보는" 분석 도구**로 운영합니다.

| 화면 | 라우트 | 요지 |
| --- | --- | --- |
| 전체 평가 | `/call-quality` | 기본 평가 진행 워크벤치 |
| 고위험군 평가 | `/call-quality/high-risk` | 동일 UI · `highRiskOnly` 기본 ON |

**흐름 (end-to-end)**

1. **샘플 선택** — BigQuery 실물 테이블 `data-proj-470202.ds_growth_culture.qradar_evaluation_cases`(리전 US)에서 통화 목록 조회. 팀·카테고리·상담사·기간·통화시간 등 **검색/필터**(URL로 상태 지속), 통화당 dedup, 통화 길이 표시.
2. **녹취 확보 (Genesys)** — 선택한 `conversation_id`로 서버가 Genesys OAuth(client_credentials) → **단건(직접) recording API**로 미디어 URL 확보(수 초). 아카이브 녹취는 배치 API 폴백(복원 필요 시 안내).
3. **정확 전사 (Google STT)** — 스테레오 WAV를 GCS 임시 업로드 후 `longRunningRecognize`로 **워드 타임스탬프 실측**. **듀얼채널 화자분리**(Genesys 좌우 채널 = 상담원/고객 물리 분리)로 화자 구분. 전사 끝나면 임시 파일·GCS 객체 삭제.
4. **무발화 공백** — STT 발화 구간의 사이를 공백으로 계산(보류음 구간도 포착). STT 실패 시 ffmpeg `silencedetect` 폴백.
5. **AI 판별 (Gemini 2.5 Flash)** — STT 스크립트를 넣어 채점 + 상담원 화자 판별. **[CS 영역] 체크리스트 중심**으로 위반 여부/근거를 표시합니다.
6. **결과 저장·공유** — 결과를 BigQuery `qradar_evaluation_results`에 영구 저장(조직 구분 컬럼 포함). 목록에 "분석 완료" 표시가 세션을 넘어 유지되고, `/call-quality/result/[id]` **사내 공유 URL**(URL 끝 = `analysis_id`)로 저장본을 열람.

**재생·보안**

- 오디오는 **재생할 때만** Genesys에서 받아 WAV로 변환해 프록시 스트리밍(`/api/call-quality/audio`, HTTP Range 206, 메모리 10분 캐시). 스크립트 시각 클릭 → 해당 위치로 seek. **다운로드 차단**(`controlsList=nodownload` + 우클릭 차단), 서버·DB에 오디오 **영구 저장 안 함**.
- **PII 마스킹**(전화·주민번호·카드·이메일) — 저장·표시 양쪽에 멱등 적용(근거 인용문·코멘트 포함).

> STT 타임스탬프는 실측이라 seek이 정확합니다(과거 Gemini 추정 방식의 시간 어긋남 해소).

---

## 평가 설계 (QMS)

콜 품질 권한자(`canAccessAnyCallQuality`)에게 사이드바 **평가 설계** 그룹이 노출됩니다.

| 화면 | 라우트 | 요지 |
| --- | --- | --- |
| 평가표 | `/eval-design/sheets` | 템플릿·버전·production 지정 (`promptStore`) |
| 고위험군 플래그 | `/eval-design/high-risk` | 장콜·발화비율 등 규칙 |
| 평가 항목 | `/eval-design/items` | 기준 source view (읽기) |
| └ AI 평가 항목 | `/eval-design/ai-items` | 항목별 AI 프롬프트 (평가 항목 하위 메뉴) |
| 정확도 대시보드 | `/eval-design/accuracy` | Train 수기 vs AI · KPI·matrix·항목 토글 (`AccuracyMetricsShared`) |
| AI 비교·개선 | `/eval-design/compare` | Train 샘플 비교·재평가 |
| 프롬프트 개선 | `/eval-design/prompt-improve` | FP/FN 불일치 → 초안 |
| AI 호출 사용량 | `/eval-design/llm-usage` | 토큰·latency·추정 비용 |

## 평가 운영

| 화면 | 라우트 | 요지 |
| --- | --- | --- |
| 평가 스케줄 | `/eval-ops/schedule` | 확정 배분 기준 개인 일정 |
| 평가 배분 | `/eval-ops/assign` | 대상자·일감·평가자·배분·이력 |
| └ 확정 배분 | `/eval-ops/assign?tab=assign&confirmed=1` | 마지막 확정 셋 + 배분 탭 딥링크 |
| 검수 현황 | `/eval-ops/review-status` | 수기 검수 완료 케이스 통계·리스트 (정확도 UI와 동일 레이아웃) |

레거시 `/prompts` → sheets, `/qa` → accuracy. 화면·판정 모델 상세는 [docs/qms/00-overview.md](docs/qms/00-overview.md).

---

## 사용량 · 평가 스케줄 (관리자 전용)

**사용량** (`/usage`): 누가·어떤 화면을·언제 접속했는지 + 기능별 사용 횟수.
**평가 스케줄** (`/admin/eval-schedule`): 프로세스 내 진행 중/최근 평가 job(재시작 시 유실). QMS 회차·배정과 별개.
**접근**: `ADMIN_EMAILS`(`lib/adminEmails.ts`)만 탭·관련 API. 그 외 **403**.

**수집 동작**

- 라우트 변경마다 `UsageTracker`가 `navigator.sendBeacon`으로 `POST /api/track` 비차단 전송(fire-and-forget). 서버는 세션 쿠키로 사용자를 식별해 BigQuery `qradar_usage_events`에 적재. **비로그인·**`/api`**·**`/_next`**·**`/login` **제외**, 항상 204. 집계는 한국시간 기준, 검증행(`event='__verify'`) 제외.

**BigQuery**

- 대상: `data-proj-470202`.`ds_qradar_{dev|prod}`.`qradar_usage_events` (`BQ_TARGET`, `lib/bqRefs.ts`). 데이터셋·테이블 없으면 최초 1회 자동 생성, **기본 테이블 만료 미설정**.
- 인증: `GOOGLE_SERVICE_ACCOUNT_JSON` 우선, 없으면 ADC.

> 개인별 접속기록(개인정보)이라 조회를 `ADMIN_EMAILS`로 한정. 관리자를 늘리려면 이 배열에 이메일 추가.

---

## 운영 비용 (콜 분석 · 1회 분석 기준, 통화 길이별)


| 통화 길이 | STT(음성인식, 듀얼채널)¹ | AI 채점·체크리스트² | 합계(1회)           | 원화³              |
| ----- | ---------------- | ------------ | ---------------- | ---------------- |
| 5분    | $0.24 ~ 0.36     | ~$0.017      | **$0.26 ~ 0.38** | 약 360 ~ 520원     |
| 10분   | $0.48 ~ 0.72     | ~$0.03       | **$0.51 ~ 0.75** | 약 700 ~ 1,030원   |
| 20분   | $0.96 ~ 1.44     | ~$0.05       | **$1.0 ~ 1.5**   | 약 1,400 ~ 2,070원 |


- **월 물량 환산**: 100콜/월(평균 5분) ≈ **$26~~38(약 3.6만~~5.2만원)** · 300콜/월 ≈ **$78~~114(약 11만~~16만원)**.
- **비용의 90%+ 는 음성인식(STT)** 이 차지 — 평가 항목 수(10개든 20개든)는 비용에 거의 영향 없음.
- **절감 레버**: ①STT 데이터 로깅 opt-in(요금 ~1/3↓) ②화자분리 불필요한 재분석은 모노 처리(STT 절반) ③분석 결과 저장·재사용으로 중복 분석 방지.

> ¹ STT `latest_long`(enhanced) 기준, 듀얼채널은 채널당 과금(×2). 로깅 opt-in 시 표의 낮은 값.
> ² Gemini 2.5 Flash(오디오+텍스트). 체크리스트는 기존 채점 호출에 얹어 **추가 호출 없음**(증분 비용 ≈ 0).
> ³ 환율 1,380원/$ 가정. 실제 청구는 콘솔 기준.

---

## 기술 스택

- **Next.js 15 (App Router,** `output: standalone`**)** / TypeScript / **Tailwind CSS v4** (CSS-first, `@theme`)
- **인증**: NextAuth v4 (Google OAuth, `@daangnservice.com` 도메인 제한)
- **AI**: Google `gemini-2.5-flash` (`@google/generative-ai`) — 콜 평가
- **음성인식**: Google Cloud **Speech-to-Text**(`longRunningRecognize`, 듀얼채널)
- **통화 녹취**: **Genesys Cloud** recording API (OAuth client_credentials)
- **무음 감지**: `ffmpeg-static` (STT 폴백)
- **저장/집계**: BigQuery (`@google-cloud/bigquery`) · GCS (`@google-cloud/storage`)
- **모니터링**: `@vercel/analytics`
- **테스트**: Vitest (+ @testing-library/react) / **아이콘**: lucide-react

---

## 프로젝트 구조

```
app/
  layout.tsx                       # 루트: Providers + SEO 차단 메타 + <UsageTracker/> + <Analytics/>
  login/page.tsx                   # 로그인 화면 (사이드바 없음)
  robots.ts                        # /robots.txt (전체 Disallow)
  (main)/                          # 로그인 뒤 영역 (사이드바 셸)
    page.tsx                       #   홈 → 권한별 리다이렉트
    call-quality/                  #   전체 평가 · high-risk · result/[id]
    eval-ops/                      #   schedule · assign · review-status
    eval-design/                   #   sheets · high-risk · items · ai-items · accuracy · …
    admin/eval-schedule/           #   AI 평가 job 보드 (관리자)
    guide/ · usage/                #   이용 설명서 · 사용량
    prompts/ · qa/                 #   레거시 → eval-design 리다이렉트
  api/
    auth/[...nextauth]/ · health/
    evaluate/                      # 콜 평가 (Genesys→STT→Gemini, NDJSON)
    call-quality/                  # samples · results · filter-options · audio · reviews
    eval-ops/                      # bootstrap · assign · schedule · review-status
    prompts/ · prompts/criteria/   # 평가표·기준 (레거시 경로명)
    qa/                            # samples · compare · evaluate · matrix
    eval-design/prompt-improve/    # mismatches · generate
    stats/usage · stats/llm
    admin/eval-schedule · track
lib/                               # HTTP 비의존 모듈 (플랫; 도메인 폴더화는 백로그)
  auth · types · env · bqRefs · gcpCredentials
  genesys · stt · silence · gemini · evaluate · audioPipeline
  evalResultStore · analysisStore(deprecated 래퍼) · evaluationSamples
  promptStore · criterionStore · qaStore · promptImprove* · reviewStatus*
  evalSchedule · llmCallLog · sttCallLog · bigquery · adminEmails · pii
components/
  eval-design/ · eval-ops/ · eval-metrics/ · guide/
  Sidebar · EvalProgressWorkbench · CallQualityEval · SampleList · …
middleware.ts · Dockerfile · docker-compose.prod.yml
docs/helpdesk-x_서비스구조.md · docs/qms/
```

---

## 환경변수

`.env.local`(로컬)과 배포 환경(`.env.production`) 양쪽에 설정합니다. 예시: `[.env.local.example](.env.local.example)`.

**공통 / 인증**


| 변수                                          | 용도                   | 예시 / 기본값                                                               |
| ------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `GEMINI_API_KEY`                            | Gemini 호출 키 (**필수**) | —                                                                      |
| `GEMINI_MODEL`                              | 모델명                  | `gemini-2.5-flash`                                                     |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 구글 OAuth (**필수**)    | —                                                                      |
| `NEXTAUTH_SECRET`                           | 세션 서명 키 (**필수**)     | `openssl rand -base64 32`                                              |
| `NEXTAUTH_URL`                              | 서비스 URL              | 로컬 `http://localhost:3000` / 배포 `https://helpdesk-x.daangnservice.com` |
| `AUTH_TRUST_HOST`                           | 요청 Host로 URL 추론    | 로컬 LAN 접속 시 `true` (개발 모드는 코드에서 자동) |
| `ALLOWED_EMAIL_DOMAIN`                      | 로그인 허용 도메인           | `daangnservice.com`                                                    |


**사용량 / GCS (BigQuery·STT)**


| 변수                                          | 용도                                     | 예시 / 기본값                                    |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| `GOOGLE_SERVICE_ACCOUNT_JSON`               | BigQuery/GCS/STT 인증(SA 키 JSON). 없으면 ADC | —                                           |
| `GOOGLE_CLOUD_PROJECT_ID`                   | (legacy) 프로젝트 오버라이드. 미설정 시 growth 프로젝트 | `data-proj-470202`                          |
| `BQ_TARGET` / `QRADAR_DATASET`              | 적재 데이터셋 타겟(`dev`→`ds_qradar_dev`, `prod`→`ds_qradar_prod`) | `prod` / (타겟 기본) |
| `GCS_FEEDBACK_BUCKET` / `GCS_LOCATION`      | STT 임시 버킷(없으면 자동 생성)/리전                | `qms_qradar` / app 리전                      |
| `SILENCE_NOISE_DB`                          | 무음 감지 dB 임계                            | `-30`                                       |
| `MAX_UPLOAD_MB`                             | 콜 평가 업로드 상한(MB)                        | `200`                                       |


**콜 분석 (Genesys · STT · DA 프로젝트)**


| 변수                                              | 용도                                       | 예시 / 기본값                                                 |
| ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `GENESYS_CLIENT_ID` / `GENESYS_CLIENT_SECRET`   | Genesys OAuth (녹취 확보). 노출 시 로테이션         | —                                                        |
| `GENESYS_HOST` / `GENESYS_TOKEN_HOST`           | Genesys API/토큰 호스트                       | `api.apne2.pure.cloud` / `login.apne2.pure.cloud`        |
| `GENESYS_FORMAT_ID` / `GENESYS_MAX_WAIT_MS`     | 녹취 포맷 / 배치 폴백 대기 상한                      | —                                                        |
| `GROWTH_CULTURE_PROJECT_ID`                     | BQ 프로젝트(콜 분석·앱 로그 통합)                    | `data-proj-470202`                                       |
| `GROWTH_CULTURE_LOCATION`                       | 해당 데이터셋 리전                               | `US`                                                     |
| `BQ_TARGET`                                     | `dev`→`ds_qradar_dev`, `prod`→`ds_qradar_prod` (테이블명 동일·`qradar_` 접두) | `prod` |
| `EVAL_SHARED_DATASET` / `EVAL_CASES_TABLE`      | 공유 입력 데이터셋 / 케이스 테이블                      | `ds_growth_culture` / `….qradar_evaluation_cases`        |
| `EVAL_RESULTS_TABLE` / `EVAL_RESULTS_TABLE_PAY` | 결과 테이블명. **통합 테이블** 사용(`org` 구분). PAY env는 deprecated 별칭 | `qradar_evaluation_results` |
| `EVAL_CRITERIA_VIEW`                            | CS 체크리스트 기준 뷰 (`dataset.view`). 비우면 하드코딩 | `ds_growth_culture.vw_evaluation_criterions`             |
| `STT_LANGUAGE` / `STT_MODEL`                    | Speech-to-Text 언어/모델                     | `ko-KR` / `latest_long`                                  |
| `STT_TEMP_BUCKET`                               | STT용 GCS 임시 업로드 버킷                       | 미설정 시 `GCS_FEEDBACK_BUCKET` → `qms_qradar` |
| `CALL_PROMPT_VERSION`                           | 콜 분석 프롬프트 버전(결과에 기록)                     | `v1`                                                     |


> BigQuery 프로젝트·테이블·뷰는 **`lib/bqRefs.ts`**. `BQ_TARGET`로 **데이터셋만** 갈라진다(`ds_qradar_dev` / `ds_qradar_prod`). 테이블명은 동일하고 `qradar_` 접두. 공유 입력(cases/criteria)은 `ds_growth_culture` 유지. 레거시 `_dev` 접미 테이블은 `npm run migrate:qradar -- --target=dev` 로 이관.
> GCP 키/토큰은 레포에 없음 — `GOOGLE_SERVICE_ACCOUNT_JSON` 또는 ADC(`lib/gcpCredentials.ts`). 로그인용 Google OAuth는 `GOOGLE_CLIENT_ID`/`SECRET`(NextAuth).
> 콜 분석 BigQuery는 서비스계정에 `data-proj-470202` 접근이 필요합니다: 샘플 조회 `dataViewer`, 결과 저장 `dataEditor`. Cloud STT는 `roles/speech.client`. GCS 버킷 자동 생성이 필요하면 `storage.buckets.create`.

---

## 로컬 실행

```bash
# 1) 의존성
npm install                 # .npmrc(legacy-peer-deps=true) 포함

# 2) .env.local 작성 (위 표 참고). SSO 값이 없으면 로그인 화면에서 못 넘어갑니다.
#    - GEMINI_API_KEY
#    - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  (구글 클라우드 콘솔 발급)
#    - NEXTAUTH_SECRET (openssl rand -base64 32) / NEXTAUTH_URL=http://localhost:3000
#    - AUTH_TRUST_HOST=true  (LAN·nip.io 호스트로 접속할 때)
#    - ALLOWED_EMAIL_DOMAIN=daangnservice.com

# 3) 개발 서버 (0.0.0.0 바인딩 → 동일 네트워크에서 접속 가능)
npm run dev                 # http://localhost:3000 또는 http://<LAN-IP>.nip.io:3000

# 검증 (⚠️ dev 중 next build 금지 — .next 청크 캐시 꼬임. 문제 시 rm -rf .next 후 재시작)
npx tsc --noEmit
npx vitest run
```

**구글 OAuth 클라이언트 발급 (로컬)**

1. [Google Cloud Console](https://console.cloud.google.com) → OAuth 동의 화면(Internal 권장) → 사용자 인증 정보 → **OAuth 클라이언트 ID(웹)**
2. **승인된 자바스크립트 원본**: `http://localhost:3000`
3. **승인된 리디렉션 URI**: `http://localhost:3000/api/auth/callback/google`
4. 발급된 ID/시크릿을 `.env.local`에 (`AUTH_TRUST_HOST=true`)

**같은 네트워크 다른 PC에서 로그인 (Google은 raw IP Origin/Redirect 거부)**

Google은 private IP를 OAuth `redirect_uri`로 쓰면  
`device_id and device_name are required for private IP` (400 invalid_request) 를 냅니다.  
콘솔에도 IP Origin을 등록할 수 없습니다(`localhost`만 예외).

[nip.io](https://nip.io) 호스트를 쓰면 공인 TLD(`.io`)라서 등록되고, DNS가 LAN IP로 resolve됩니다.

예: 서버 PC IP가 `172.17.2.26`이면

1. 구글 콘솔에 추가
   - 원본: `http://172.17.2.26.nip.io:3000`
   - 리디렉션: `http://172.17.2.26.nip.io:3000/api/auth/callback/google`
2. 접속: **`http://172.17.2.26.nip.io:3000`**  
   (IP로 열어도 미들웨어가 nip.io로 리다이렉트하고, auth 콜백 URL도 nip.io로 맞춤)

---

## 배포 (EC2 · Docker)

Vercel 서버리스는 요청 본문/실행시간 제한과 상주 처리 부적합으로 폐기하고, **PAB 내부 EC2에 Docker로 상주 운영**합니다(ALB 뒤, 헬스체크 `/api/health`).

```bash
# EC2에서
#  - .env.production 준비(위 환경변수 표 전체)
docker compose -f docker-compose.prod.yml up -d --build   # 호스트 3010→컨테이너 3000, restart: always
```

1. **환경변수**는 `.env.production`에 전부 등록. `NEXTAUTH_URL = https://helpdesk-x.daangnservice.com`.
2. **구글 OAuth 클라이언트에 배포 도메인 추가**:
  - 자바스크립트 원본: `https://helpdesk-x.daangnservice.com`
  - 리디렉션 URI: `https://helpdesk-x.daangnservice.com/api/auth/callback/google`
3. Genesys/STT/DA 프로젝트 권한(위 각주)·secret이 반영돼 있어야 콜 분석이 동작.

- **SEO**: 루트 메타 `noindex, nofollow` + `/robots.txt` 전체 Disallow → 외부 검색 노출 안 됨.
- **Analytics**: `<Analytics/>`가 루트 레이아웃에 있어 자동 수집(로컬은 no-op).

---

## 상태 / 로드맵

- **완료**: 콜 분석(Genesys · STT 듀얼채널 · 공백 · CS 체크리스트 · org 탭 · 결과 영구저장/공유 · 오디오 임시재생 · PII) · **평가 설계 1차**(평가표·항목·AI 항목·정확도·비교·프롬프트 개선·LLM 사용량) · 사용량 · 평가 스케줄(인메모리) · 이용 설명서 · SSO · EC2 Docker.
 - **다음**: 긴 통화·아카이브 녹취 비동기 복원 · 평가 세션(회차) 전용 UI · QMS 운영(배정·이의제기) · 당근서비스워크 평가폼 연동.
- **구조 백로그**: `analysisStore` 제거 · API `/eval-design` 네임스페이스 · `lib/`·call-quality 컴포넌트 폴더화 — [서비스구조 §10](docs/helpdesk-x_서비스구조.md).

---

## 문서

**서비스 구조(현행)**: [docs/helpdesk-x_서비스구조.md](docs/helpdesk-x_서비스구조.md)  
**QMS 평가 설계**: [docs/qms/00-overview.md](docs/qms/00-overview.md)

**개발일지** (`docs/devlog/`) — 역사 기록. 현행 구조는 위 두 문서를 본다.

- `2026-07-18` ~ `07-21` — 초기 콜 평가·(이후 제거된) 파손 판별·사용량
- `2026-07-23` ~ `07-24` — Genesys·STT·조직 탭·CS 체크리스트
- `2026-07-27` ~ `07-29` — 후속 개선

`docs/superpowers/` 는 2026-07 초기 설계 스냅샷이며 현행과 다를 수 있다.

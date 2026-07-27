# call-quality-eval (X팀 헬프데스크)

X팀 **내부 도구 사이트**(브라우저 탭 제목: **X팀 헬프데스크**). 구글 SSO 로그인 뒤에서 동작하며, 사이드바 탭은 **로그인 계정의 권한에 따라** 노출됩니다(모든 로그인 사용자에게 "파손 판별", 권한자에게만 "콜 분석"·관리자 탭).

| 탭 | 하는 일 | 접근 |
|----|---------|------|
| **콜 분석 · 성장문화실** | BigQuery 샘플에서 통화를 골라 서버가 Genesys에서 녹취를 확보 → **Google STT로 정확 전사·화자분리(듀얼채널)** → Gemini가 **CS 영역 체크리스트(20항목)**를 근거와 함께 판별. 무발화 공백 측정·오디오 임시재생 | `CALL_QUALITY_EMAILS` |
| **콜 분석 · 페이팀** | 위와 동일 구조(샘플 소스 공통). 결과 저장 테이블 분리, **3점 채점·총평 방식**(체크리스트는 성장문화실 전용) | `PAY_CALL_QUALITY_EMAILS` |
| **파손 판별 (Vision AI)** | 신청인·피신청인 사진을 각각 올리면 AI가 **양측을 비교**해 파손 여부·부위·유형을 판정하고 **사진 위 빨간 박스**로 표시(분쟁조정용). 결과 **👍/👎 피드백**·**판정 챗봇** 제공 | 로그인 전체 |
| **피드백** (관리자 전용) | 파손 판별의 👍/👎·코멘트, 프롬프트 버전별 만족도, 나쁜 사례 사진 리뷰, 챗봇 Q&A·평가 로그 열람/삭제 | `ADMIN_EMAILS` |
| **사용량** (관리자 전용) | 누가·어떤 화면을·언제 접속했는지 + 기능별 사용 횟수를 BigQuery로 집계 | `ADMIN_EMAILS` |

- 홈(`/`)은 **파손 판별(`/damage`)로 리다이렉트**됩니다. 콜 분석은 권한 계정만 사이드바에 노출.
- 배포: **PAB 내부 EC2 (Docker, `output: standalone`) — ALB 뒤**. 프로덕션: `https://helpdesk-x.daangnservice.com`
- 접근: **@daangnservice.com 구글 계정만** 로그인 가능. 외부 검색엔진에는 **노출 안 됨(noindex + robots 차단)**.

> **콜 분석은 상주 데몬형 처리**(Genesys 확보 + STT 장시간)라 Vercel 서버리스에 부적합 → EC2 Docker 상주로 운영합니다.

---

## 접근 / 로그인 (SSO)

- **NextAuth v4 + Google OAuth**. `lib/auth.ts`의 `signIn` 콜백에서 이메일 도메인을 검증해 `@daangnservice.com`이 아니면 거부.
- `middleware.ts`가 `/login`·`/api/auth`·정적 리소스·`robots.txt`를 제외한 **모든 경로를 보호** → 미로그인 시 `/login`으로 리다이렉트.
- 탭·API는 **이메일 화이트리스트**로 세분화(`lib/adminEmails.ts`): `ADMIN_EMAILS`(피드백·사용량), `CALL_QUALITY_EMAILS`(성장문화실 콜 분석), `PAY_CALL_QUALITY_EMAILS`(페이팀 콜 분석). 권한 없는 계정은 탭이 안 보이고 직접 접근해도 **403**.
- 로그인 화면(`/login`)은 사이드바 없이 안내 문구 + 구글 로그인 버튼. 사이드바 하단에 로그인 이메일 + 로그아웃.

> ⚠️ **OAuth 값이 없으면 로컬에서도 로그인 불가**(→ /login으로 튕김). 아래 "환경변수"·"배포" 참고.

---

## 콜 분석 (성장문화실 / 페이팀)

> ⚠️ **관리자/권한자 전용 기능.** 일반 상담원 대상이 아니며, @헬비(에이전트 봇)는 이 기능을 상담원에게 안내하지 않습니다.

CS 통화를 **점수 매김이 아니라 "뜯어보는" 분석 도구**로 운영합니다. 조직 탭이 두 개(`/call-quality` 성장문화실, `/call-quality/pay` 페이팀)이며, 샘플 소스는 공통이지만 **접근 권한·결과 저장 테이블·채점 방식**이 다릅니다.

**흐름 (end-to-end)**
1. **샘플 선택** — BigQuery 실물 테이블 `data-proj-470202.ds_growth_culture.qradar_evaluation_cases`(리전 US)에서 통화 목록 조회. 팀·카테고리·상담사·기간·통화시간 등 **검색/필터**(URL로 상태 지속), 통화당 dedup, 통화 길이 표시.
2. **녹취 확보 (Genesys)** — 선택한 `conversation_id`로 서버가 Genesys OAuth(client_credentials) → **단건(직접) recording API**로 미디어 URL 확보(수 초). 아카이브 녹취는 배치 API 폴백(복원 필요 시 안내).
3. **정확 전사 (Google STT)** — 스테레오 WAV를 GCS 임시 업로드 후 `longRunningRecognize`로 **워드 타임스탬프 실측**. **듀얼채널 화자분리**(Genesys 좌우 채널 = 상담원/고객 물리 분리)로 화자 구분. 전사 끝나면 임시 파일·GCS 객체 삭제.
4. **무발화 공백** — STT 발화 구간의 사이를 공백으로 계산(보류음 구간도 포착). STT 실패 시 ffmpeg `silencedetect` 폴백.
5. **AI 판별 (Gemini 2.5 Flash)** — STT 스크립트를 넣어 채점 + 상담원 화자 판별. **성장문화실은 [CS 영역] 체크리스트 20항목**(항목별 위반 여부 + 전사 인용·시각 근거 강제, 근거 없거나 애매하면 false)을 판정하고 **3점 채점·총평 대신 체크리스트 중심**으로 표시. **페이팀은 기존 3점 채점·총평**(체크리스트 미적용 — 기준 확정 대기).
6. **결과 저장·공유** — 결과를 BigQuery에 영구 저장(성장문화실 `qradar_evaluation_results` / 페이팀 `qradar_evaluation_results_pay`). 목록에 "분석 완료" 표시가 세션을 넘어 유지되고, `/call-quality/result/[id]` **사내 공유 URL**(URL 끝 = `analysis_id`)로 저장본을 열람.

**재생·보안**
- 오디오는 **재생할 때만** Genesys에서 받아 WAV로 변환해 프록시 스트리밍(`/api/call-quality/audio`, HTTP Range 206, 메모리 10분 캐시). 스크립트 시각 클릭 → 해당 위치로 seek. **다운로드 차단**(`controlsList=nodownload` + 우클릭 차단), 서버·DB에 오디오 **영구 저장 안 함**.
- **PII 마스킹**(전화·주민번호·카드·이메일) — 저장·표시 양쪽에 멱등 적용(근거 인용문·코멘트 포함).

> STT 타임스탬프는 실측이라 seek이 정확합니다(과거 Gemini 추정 방식의 시간 어긋남 해소).

---

## 파손 판별 (Vision AI)

**입력**: **신청인·피신청인** 사진을 각각 업로드 `.jpg/.jpeg/.png/.webp`, **파당 최대 5장**(각 ≤10MB). 한쪽만 올려도 판정 가능.
**판정**: **파손됨 / 정상 / 불확실** + 신뢰도(%)
**결과**: 판정 배지 + 종합 소견 + **양측 비교 소견** + 파손 근거(부위·유형·설명·**제출 측**, 번호 매김) + **사진별 박스 오버레이(신청인/피신청인 분리)**
**용도**: 분쟁조정 — 양측이 제출한 증거 사진 비교 판정

**동작**
- 양측 사진을 **한 번의 Gemini 호출**에 함께 넣어 종합 판정. **통합 순서(신청인 먼저, 그 뒤 피신청인)**로 `photoIndex`를 부여하고, `claimantCount`로 각 사진·근거의 제출 측(party)을 역산.
- `comparison` 필드로 **양측 사진 간 파손 표현의 차이·불일치**(한쪽엔 보이나 다른 쪽엔 안 보임, 각도/조명 차이, 동일 상품 의심 등)를 짚음.
- 이미지는 **Gemini File API 업로드**(원본 해상도 유지 → 미세 손상까지). 판정 후 업로드 파일 정리.
- 프롬프트/판정 로직 버전 `DAMAGE_PROMPT_VERSION`(현재 `v1`) — 피드백과 짝지어 버전별 품질 비교.

**판정에 대해 물어보기 (챗봇)**
- 결과 화면 **우측 하단 플로팅 버튼** → 멀티턴 챗봇. "왜 이렇게 판단했어?" 등 질문 시 **원본 사진을 매 요청 재첨부**해 Gemini가 시각적으로 다시 살펴보고 답함(`lib/damageChat.ts`, `/api/damage/chat`). 서버 stateless → 대화 히스토리(최근 20턴) + 판정 결과 JSON으로 문맥 유지. 답변별 👍/👎.

**파손 부위 시각화 (박스 오버레이)**
- 각 파손 근거에 `photoIndex` + 바운딩 박스(`{ymin,xmin,ymax,xmax}` 0~1000 정규화)를 받아, 원본 사진 위에 **빨간 사각형 + 번호(①②③)**로 표시. 항목에 마우스를 올리면 해당 박스 강조.
- **정확도 튜닝**: `temperature=0`, "실제 손상 지점만 타이트하게", "확실치 않으면 박스 없음(null)".

**피드백·보관**
- 결과 하단 👍/👎 + 코멘트 → BigQuery `damage_feedback` 적재. **피드백을 남긴 케이스의 사진만** GCS 비공개 버킷에 저장(**90일 자동 삭제**), 관리자 signed URL로만 열람. 평상시 판별 사진은 저장하지 않음(처리 후 삭제).

> **HEIC 미지원**: 아이폰 기본 HEIC는 Gemini가 직접 못 받아 제외. jpg/png/webp로 올려주세요.

---

## 피드백 (관리자 전용)

- `ADMIN_EMAILS`에게만 사이드바 탭·API 노출. 파손 판별의 👍/👎 만족도, **프롬프트 버전별 품질**, 나쁜 사례의 코멘트·사진 리뷰, **피드백 삭제**(스트리밍 버퍼로 즉시 하드 삭제가 안 돼 `damage_feedback_deleted` tombstone soft-delete + GCS 사진 실삭제), **챗봇 질문·답변 로그 + 답변 평가** 열람/삭제.
- BigQuery 테이블: `damage_feedback`, `damage_feedback_deleted`, `damage_chat_turns`, `damage_chat_ratings`, `damage_chat_deleted` (모두 **만료 미설정**).

---

## 사용량 (관리자 전용)

**목적**: 누가·어떤 화면을·언제 접속했는지 + 기능별 사용 횟수(파손 판별·콜 분석·챗봇 질문·피드백) 파악.
**접근 제한**: `ADMIN_EMAILS`(현재 `karla@`, `amber.jeon@`, `russell@daangn.com`, `liana@daangn.com`)에게만 탭·`/usage`·`/api/stats/usage` 노출. 그 외 **403**.
**대시보드**: 총 조회수 / 접속자 수 / 일별 접속량(경량 SVG) / 화면별·사용자별 접속. 기간 7·30·90일 토글.

**수집 동작**
- 라우트 변경마다 `UsageTracker`가 `navigator.sendBeacon`으로 `POST /api/track` 비차단 전송(fire-and-forget). 서버는 세션 쿠키로 사용자를 식별해 BigQuery `usage_events`에 적재. **비로그인·`/api`·`/_next`·`/login` 제외**, 항상 204. 집계는 한국시간 기준, 검증행(`event='__verify'`) 제외.

**BigQuery**
- 대상: `striped-option-493506-a7.helpdesk_x.usage_events` (`asia-northeast3`). 데이터셋·테이블 없으면 최초 1회 자동 생성, **기본 테이블 만료(defaultTableExpiration) 미설정**(과거 60일 자동삭제 사고 재발 방지).
- 인증: `GOOGLE_SERVICE_ACCOUNT_JSON` 우선, 없으면 ADC.

> 개인별 접속기록(개인정보)이라 조회를 `ADMIN_EMAILS`로 한정. 관리자를 늘리려면 이 배열에 이메일 추가.

---

## 운영 비용 (콜 분석 · 1회 분석 기준, 통화 길이별)

| 통화 길이 | STT(음성인식, 듀얼채널)¹ | AI 채점·체크리스트² | 합계(1회) | 원화³ |
|---|---|---|---|---|
| 5분 | $0.24 ~ 0.36 | ~$0.017 | **$0.26 ~ 0.38** | 약 360 ~ 520원 |
| 10분 | $0.48 ~ 0.72 | ~$0.03 | **$0.51 ~ 0.75** | 약 700 ~ 1,030원 |
| 20분 | $0.96 ~ 1.44 | ~$0.05 | **$1.0 ~ 1.5** | 약 1,400 ~ 2,070원 |

- **월 물량 환산**: 100콜/월(평균 5분) ≈ **$26~38(약 3.6만~5.2만원)** · 300콜/월 ≈ **$78~114(약 11만~16만원)**.
- **비용의 90%+ 는 음성인식(STT)** 이 차지 — 평가 항목 수(10개든 20개든)는 비용에 거의 영향 없음.
- **절감 레버**: ①STT 데이터 로깅 opt-in(요금 ~1/3↓) ②화자분리 불필요한 재분석은 모노 처리(STT 절반) ③분석 결과 저장·재사용으로 중복 분석 방지.

> ¹ STT `latest_long`(enhanced) 기준, 듀얼채널은 채널당 과금(×2). 로깅 opt-in 시 표의 낮은 값.
> ² Gemini 2.5 Flash(오디오+텍스트). 체크리스트는 기존 채점 호출에 얹어 **추가 호출 없음**(증분 비용 ≈ 0).
> ³ 환율 1,380원/$ 가정. 실제 청구는 콘솔 기준.

---

## 기술 스택

- **Next.js 15 (App Router, `output: standalone`)** / TypeScript / **Tailwind CSS v4** (CSS-first, `@theme`)
- **인증**: NextAuth v4 (Google OAuth, `@daangnservice.com` 도메인 제한)
- **AI**: Google `gemini-2.5-flash` (`@google/generative-ai`) — 오디오·이미지 **File API**
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
    page.tsx                       #   홈 / → /damage 리다이렉트
    call-quality/page.tsx          #   콜 분석 · 성장문화실 (/call-quality)
    call-quality/pay/page.tsx      #   콜 분석 · 페이팀 (/call-quality/pay)
    call-quality/result/[id]/      #   콜 분석 결과 공유 페이지 (analysis_id)
    damage/page.tsx                #   파손 판별 (/damage)
    feedback/page.tsx              #   피드백 리뷰 (/feedback, 관리자)
    usage/page.tsx                 #   사용량 대시보드 (/usage, 관리자)
  api/
    auth/[...nextauth]/            # NextAuth 핸들러
    health/route.ts                # ALB 헬스체크 ({status:"ok"})
    evaluate/route.ts              # 콜 분석 실행 (Genesys→STT→Gemini)
    call-quality/samples           #   샘플 목록(BQ)
    call-quality/results           #   저장 결과 조회
    call-quality/filter-options    #   필터 드롭다운 옵션
    call-quality/audio             #   오디오 프록시(WAV·Range·다운로드 차단)
    damage/route.ts                # 파손 판별 · damage/chat(챗봇)·chat/rating
    damage/feedback/route.ts       # 파손 피드백 적재
    track/route.ts                 # 사용량 수집 (POST → 204)
    stats/usage · stats/feedback · stats/feedback/image · stats/chat  # 관리자 집계/열람
lib/                               # HTTP 비의존 순수 모듈 위주
  auth.ts types.ts format.ts env.ts audio.ts
  genesys.ts stt.ts silence.ts gemini.ts evaluate.ts    # 콜 분석 파이프라인
  evaluationSamples.ts analysisStore.ts                 # 콜 분석 샘플/결과 저장(BQ, data-proj-470202)
  csChecklist.ts callQualityOrg.ts pii.ts               # 체크리스트·조직·PII 마스킹
  vision.ts damageChat.ts storage.ts                    # 파손 판별·챗봇·GCS
  bigquery.ts adminEmails.ts                            # BigQuery·권한(이메일 화이트리스트)
components/                        # Sidebar, 콜 분석 UI(FilterPanel/MultiSelect/SampleList/
                                   #   ResultDrawer/Transcript/ChecklistView/ResultView),
                                   #   파손 UI, UsageTracker
middleware.ts                      # 인증 게이트 (미로그인 → /login)
Dockerfile · docker-compose.prod.yml  # EC2 배포(standalone)
```

---

## 환경변수

`.env.local`(로컬)과 배포 환경(`.env.production`) 양쪽에 설정합니다. 예시: [`.env.local.example`](.env.local.example).

**공통 / 인증**
| 변수 | 용도 | 예시 / 기본값 |
|------|------|---------------|
| `GEMINI_API_KEY` | Gemini 호출 키 (**필수**) | — |
| `GEMINI_MODEL` | 모델명 | `gemini-2.5-flash` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 구글 OAuth (**필수**) | — |
| `NEXTAUTH_SECRET` | 세션 서명 키 (**필수**) | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | 서비스 URL | 로컬 `http://localhost:3000` / 배포 `https://helpdesk-x.daangnservice.com` |
| `ALLOWED_EMAIL_DOMAIN` | 로그인 허용 도메인 | `daangnservice.com` |

**파손 판별 / 사용량 / 피드백 (BigQuery·GCS)**
| 변수 | 용도 | 예시 / 기본값 |
|------|------|---------------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | BigQuery/GCS 인증(서비스계정 키 JSON). 없으면 ADC | — |
| `GOOGLE_CLOUD_PROJECT_ID` | 앱 BigQuery/GCS 프로젝트 | `striped-option-493506-a7` |
| `BIGQUERY_DATASET_ID` / `BIGQUERY_LOCATION` | 사용량·피드백 데이터셋/리전 | `helpdesk_x` / `asia-northeast3` |
| `GCS_FEEDBACK_BUCKET` / `GCS_LOCATION` | 피드백 사진 버킷(없으면 자동 생성)/리전 | `…-helpdesk-x-feedback` / `asia-northeast3` |
| `SILENCE_NOISE_DB` | 무음 감지 dB 임계 | `-30` |
| `MAX_IMAGES_PER_PARTY` / `MAX_IMAGE_MB` | 파손 판별 파당 최대 장수 / 장당 최대 | `5` / `10` |

**콜 분석 (Genesys · STT · DA 프로젝트)**
| 변수 | 용도 | 예시 / 기본값 |
|------|------|---------------|
| `GENESYS_CLIENT_ID` / `GENESYS_CLIENT_SECRET` | Genesys OAuth (녹취 확보). 노출 시 로테이션 | — |
| `GENESYS_HOST` / `GENESYS_TOKEN_HOST` | Genesys API/토큰 호스트 | `api.apne2.pure.cloud` / `login.apne2.pure.cloud` |
| `GENESYS_FORMAT_ID` / `GENESYS_MAX_WAIT_MS` | 녹취 포맷 / 배치 폴백 대기 상한 | — |
| `GROWTH_CULTURE_PROJECT_ID` | 콜 분석 샘플/결과 BQ 프로젝트(DA 소유) | `data-proj-470202` |
| `GROWTH_CULTURE_LOCATION` | 해당 데이터셋 리전 | `US` |
| `EVAL_CASES_TABLE` | 샘플(케이스) 테이블 | `qradar_evaluation_cases` |
| `EVAL_RESULTS_DATASET` | 결과 데이터셋 | `ds_growth_culture` |
| `EVAL_RESULTS_TABLE` / `EVAL_RESULTS_TABLE_PAY` | 결과 테이블(성장문화실 / 페이팀) | `qradar_evaluation_results` / `…_pay` |
| `STT_LANGUAGE` / `STT_MODEL` | Speech-to-Text 언어/모델 | `ko-KR` / `latest_long` |
| `STT_TEMP_BUCKET` | STT용 GCS 임시 업로드 버킷 | 미설정 시 `GCS_FEEDBACK_BUCKET` → `…-helpdesk-x-feedback` 폴백 |
| `CALL_PROMPT_VERSION` | 콜 분석 프롬프트 버전(결과에 기록) | `v1` |

> 콜 분석 BigQuery는 서비스계정(`google-group-checker@…`)에 `data-proj-470202` 접근이 필요합니다: 샘플 조회 `dataViewer`, 결과 저장 `dataEditor`. Cloud STT는 `roles/speech.client`. GCS 버킷 자동 생성이 필요하면 `storage.buckets.create`.
> 콜 분석/사용량/피드백을 쓰지 않는 로컬에서는 관련 env 없이도 파손 판별은 동작합니다(해당 기능만 조용히 실패).

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

# 검증 (⚠️ dev 중 next build 금지 — .next 청크 캐시 꼬임. 문제 시 rm -rf .next 후 재시작)
npx tsc --noEmit
npx vitest run
```

**구글 OAuth 클라이언트 발급 (로컬)**
1. [Google Cloud Console](https://console.cloud.google.com) → OAuth 동의 화면(Internal 권장) → 사용자 인증 정보 → **OAuth 클라이언트 ID(웹)**
2. **승인된 자바스크립트 원본**: `http://localhost:3000`
3. **승인된 리디렉션 URI**: `http://localhost:3000/api/auth/callback/google`
4. 발급된 ID/시크릿을 `.env.local`에

---

## 배포 (EC2 · Docker)

Vercel 서버리스는 요청 본문/실행시간 제한과 상주 처리 부적합으로 폐기하고, **PAB 내부 EC2에 Docker로 상주 운영**합니다(ALB 뒤, 헬스체크 `/api/health`).

```bash
# EC2에서
#  - .env.production 준비(위 환경변수 표 전체)
docker compose -f docker-compose.prod.yml up -d --build   # 포트 3000, restart: always
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

- **완료**: 콜 분석(Genesys 단건 확보 · Google STT 듀얼채널 화자분리 · 무발화 공백 · CS 체크리스트 20항목 · 조직 탭 · 결과 영구저장/공유 URL · 오디오 임시재생/다운로드 차단 · PII 마스킹) · 파손 판별(양측 비교·박스 오버레이·챗봇·피드백/GCS) · 사용량 트래킹 · 구글 SSO · 외부 검색 차단 · EC2 Docker 배포.
- **다음(미구현)**: 사람 평가 대비 일치율 재보정(특히 맥락 의존 항목) · 페이팀 조직별 채점 기준/체크리스트 · 긴 통화 비동기/백그라운드 분석 · 아카이브 녹취 비동기 복원 · 당근서비스워크 평가폼 자동기입 연동 · 파손 판별 대용량 업로드(브라우저→GCS 직접).

---

## 문서

**서비스 구조**: [`docs/helpdesk-x_서비스구조.md`](docs/helpdesk-x_서비스구조.md)

**개발일지** (`docs/devlog/`)
- `2026-07-18` — 콜 품질 평가 초기
- `2026-07-19` — 파손 판별 + 박스 오버레이
- `2026-07-20` — 사용량 트래킹 + 관리자 대시보드
- `2026-07-21` — 파손 판별 고도화(양측 비교·피드백·챗봇)
- `2026-07-23` — 콜 평가 Genesys 전환(1단계)
- `2026-07-24` — 콜 분석 실데이터 완성(Genesys 단건·STT·조직 탭·CS 체크리스트)

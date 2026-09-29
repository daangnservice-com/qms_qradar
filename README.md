# QRadar (qms_qradar)

당근서비스 콘택센터 품질평가(QMS) 시스템이다. 전화·인앱 문의 상담을 AI(Gemini)로 먼저 평가하고, 사람이 검수하고, 사람 평가 결과를 리포트로 모은다. `@daangnservice.com` 구글 계정으로만 로그인하고, 사이드바는 계정 권한에 따라 달라진다.

- **프로덕션**: 이 리포를 도는 로컬 Next 서버(워치독이 `npm run dev`를 띄우고 감시). helpdesk-x EC2(`helpdesk-x.daangnservice.com`)는 포크 이전 호스트다.
- **저장**: 화면 요청은 서빙 Postgres만 친다. BigQuery는 데이터 쪽 원천에서 가져오는 곳이자 매일 밤 덤프를 보내는 웨어하우스다. → [서빙 DB](docs/qms/system/serving-db.md)
- **IA·판정 모델**: [docs/qms/00-overview.md](docs/qms/00-overview.md)

---

## 화면

| 그룹 | 화면 | 라우트 | 하는 일 |
|---|---|---|---|
| **평가 진행** | 전체 평가 · 고위험군 · 미검수건 · 검수 요청 · 내 평가 | `/call-quality/*` (전화), `/feedback/*` (인앱 문의) | 상담 목록 → 녹취·전사 → AI 평가 → 수기 검수·찜·완료. 전화/인앱 채널 토글 |
| | 결과 공유 | `/call-quality/result/[id]` | 저장된 평가 결과 사내 공유 URL (`analysis_id`) |
| | STT 이슈 | `/call-quality/stt-issues` | 전사 이상 신고 |
| **평가 운영** | 평가 스케줄 | `/eval-ops/schedule` | 확정 배분 기준 월별 개인 일정(완료·리더검토·본인확정) |
| | 평가 배분 · 확정 배분 | `/eval-ops/assign` | 재직자 → 팀 확정 → AQT 일감 → 평가자 배분 |
| | 수기 검수 할당 | `/eval-ops/auto-run` | AI 평가된 콜을 골라 「검수 요청」 대기열에 넣기 |
| | AI 평가 배치 | `/eval-ops/eval-batch` | 스케줄 시각에 대상 콜을 골라 Gemini 평가 |
| | STT 배치 · STT 이슈 | `/eval-ops/stt-batch` | 하루 콜을 구성원당 N건 모아 로컬 STT 서버 큐에 넣기 |
| | 검수 현황 | `/eval-ops/review-status` | 수기 검수 완료 건의 AI vs 수기 오탐·미탐 |
| **평가 설계** | 평가표 | `/eval-design/sheets` | 평가 기준·프롬프트 묶음 버전(draft/production) |
| | 고위험군 플래그 | `/eval-design/high-risk` | 채널별 선별 규칙(장콜·DSAT 등) |
| | 평가 항목 · AI 평가 항목 | `/eval-design/items`, `/ai-items` | 항목 마스터 조회 · 항목별 AI 프롬프트 편집 |
| | 정확도 · AI 비교·개선 · 프롬프트 개선 | `/eval-design/accuracy`, `/compare`, `/prompt-improve` | Train 수기 vs AI 비교, 불일치 사례로 프롬프트 초안 |
| | 답변 다듬기 테스트 | `/eval-design/reply-polish` | 문의 답변 톤앤매너 프롬프트 비교 |
| | AI 호출 사용량 | `/eval-design/llm-usage` | LLM·STT 호출량과 추정 비용 |
| **품질평가** | 리포트 · 월간 리포트 | `/results/report`, `/results/monthly-report` | 구성원 Hot/Cold 집계, 월마감 대시보드·보고서 초안 |
| | 평가 현황 · 케이스 상세 · 월별 집계 | `/results/status`, `/cases`, `/aggregate` | 사람 평가 진행 상태·케이스·팀별 집계 |
| **시스템** | 사용량 · AI 평가 job · Slack 유저 · sudo | `/usage`, `/admin/*` | 관리자 전용 |
| 도움말 | 이용 설명서 | `/guide` | |

레거시 `/prompts` → 평가표, `/qa` → 정확도 대시보드로 리다이렉트한다.

## 권한

`lib/adminEmails.ts` · `lib/resolveAccess.ts`. 그룹 멤버십은 Google Groups(Cloud Identity)로 확인해 로그인 세션에 싣는다.

| 범위 | 기준 |
|---|---|
| 평가 진행(전화·인앱) | `ALLOWED_EMAIL_DOMAIN` 도메인 전체 |
| 평가 설계 · 품질평가 | `QUALITY_EVAL_EMAILS` 또는 `QUALITY_EVAL_GROUP_EMAILS` 그룹 |
| 품질평가 > 월간 리포트 | 위 + `MONTHLY_REPORT_*`(리더 그룹) |
| 평가 운영 | `DISTRIBUTION_FULL_EMAILS`(전체), `DISTRIBUTION_ROSTER_EMAILS`(명단만) |
| 시스템 | `ADMIN_EMAILS` |

`middleware.ts`가 `/login`·`/api/auth`·`/api/health`·STT 콜백·정적 리소스를 뺀 모든 경로를 막는다. 외부 검색엔진에는 노출하지 않는다(noindex + robots 차단).

---

## 데이터 흐름

```
BigQuery 원천 ──(pull: 15분 증분 / 야간 전량)──▶ 서빙 Postgres ◀──▶ 화면·API
 (콜 케이스, CSAT, 인앱 문의,                        │
  QMS 결과 뷰, Karrot 평가 원천 …)                    └──(야간 덤프)──▶ BigQuery ds_qradar_{dev|prod}
```

- 요청 안에서는 BQ에 쓰지 않는다. 앱이 원천인 값(평가 결과, 검수, 평가표, 배분·일정, 호출 로그 …)은 Postgres에 쓰고 매일 밤 BQ로 덤프한다.
- 동기화 루프는 `instrumentation.ts`가 띄운다(`lib/servingSync.ts`). 증분·야간 범위, 테이블 목록, 보정 스크립트는 [serving-db.md](docs/qms/system/serving-db.md).
- 같은 곳에서 STT 배치·AI 평가 배치·수기 검수 할당 스케줄러도 뜬다. 서버 프로세스당 한 번만 뜨도록 라우트가 아니라 여기서 띄운다.

### 콜 평가 흐름

1. **목록**: `call_serving`(BQ 콜 케이스의 서빙 사본)에서 팀·상담사·기간·통화시간·CSAT·고위험군 등으로 필터.
2. **녹취**: Genesys OAuth → recording API로 미디어 URL 확보. 재생은 `/api/call-quality/audio` 프록시 스트리밍(Range 지원, 다운로드 차단, 영구 저장 안 함).
3. **전사**: 온디맨드는 Google STT(듀얼채널, 채널 = 상담원/고객). 배치는 로컬 STT 서버(`LOCAL_STT_BASE_URL`)에 큐로 넣고 콜백 또는 1분 폴링으로 회수.
4. **AI 평가**: Gemini(`GEMINI_MODEL`, 기본 `gemini-2.5-flash`)가 production 평가표로 CS 체크리스트 위반·근거를 낸다. 무발화 공백·고위험군 플래그도 함께 저장.
5. **저장**: `serving_eval_results`(전화·인앱 공통, 버전 이력 유지). 수기 검수·찜·완료도 Postgres. PII(전화·주민번호·카드·이메일)는 저장·표시 양쪽에서 마스킹.

인앱 문의는 종결 스레드 본문(`feedback_serving`)을 텍스트로 평가한다. 녹취·STT 단계가 없다.

---

## 로컬 실행 · 운영

```bash
npm install                    # .npmrc(legacy-peer-deps=true)
docker compose up -d postgres  # 서빙 Postgres 16, 호스트 포트 5433 (데이터: ./.data/postgres)
node scripts/run-local-ts.cjs scripts/serving-migrate.ts   # db/migrations 적용
npm run dev                    # http://localhost:3000 (0.0.0.0 바인딩)
```

- 처음 띄우는 DB면 원천 pull과 BQ 백필을 한 번 돌린다: `scripts/serving-backfill.ts`, 이후 `scripts/serving-repair.ts`.
- `npm run serving:*`는 `tsx`가 있어야 돈다. 없으면 `node scripts/run-local-ts.cjs scripts/<이름>.ts`로 같은 스크립트를 돌린다.
- 동기화 한 번 돌리기: `scripts/serving-sync.ts` (증분) / `scripts/serving-sync.ts --nightly` (전량 + BQ 덤프).
- **dev 서버가 도는 중에 `next build` 금지** — `.next`가 섞여 앱이 죽는다. 꼬이면 서버를 내리고 `.next`를 지운 뒤 다시 띄운다.

검증:

```bash
npx tsc --noEmit
npx vitest run
```

### 워치독 (프로덕션 운영)

`scripts/watchdog-bootstrap.ps1`을 시작프로그램에 등록하면 예약 작업이 3분마다 `scripts/dev-server-watchdog.ps1`을 돌려 dev 서버가 없거나 응답이 없으면 다시 띄운다. 이 레포의 서버가 둘 이상 뜨면(.next 충돌) 최신 것만 남긴다.

- 로그: `%LOCALAPPDATA%\helpdesk-x-watchdog\dev-server.log` (줄마다 시각, URL 쿼리 시크릿은 `***`), `watchdog.log`
- 보기: `npm run logs` (`-- -Errors`, `-- -Quiet`, `-- -Watchdog`, `-- -Tail 300 -NoFollow`)

### 같은 네트워크 다른 PC에서 로그인

구글은 사설 IP를 OAuth 리디렉션으로 받지 않는다. [nip.io](https://nip.io) 호스트를 쓴다. 서버 IP가 `172.17.2.26`이면 구글 콘솔에 원본 `http://172.17.2.26.nip.io:3000`, 리디렉션 `http://172.17.2.26.nip.io:3000/api/auth/callback/google`을 등록하고 그 주소로 접속한다. IP로 열어도 미들웨어가 nip.io로 보낸다.

---

## 환경변수

전체 예시와 설명은 [.env.local.example](.env.local.example). 키·토큰은 레포에 없다(`.env*`, `sa/`는 gitignore).

| 영역 | 변수 |
|---|---|
| 로그인 | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_TRUST_HOST`, `ALLOWED_EMAIL_DOMAIN` |
| Google Groups | `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL`, `GOOGLE_GROUPS_CACHE_TTL_MS` (SA는 `./sa/*.json` 또는 `GOOGLE_SERVICE_ACCOUNT_FILE`) |
| AI | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| 서빙 DB | `SERVING_DATABASE_URL`, `SERVING_SYNC_INTERVAL_MS`, `SERVING_NIGHTLY_HOUR_KST` |
| BigQuery | `BQ_TARGET`(`dev`→`ds_qradar_dev`, `prod`→`ds_qradar_prod`), `GROWTH_CULTURE_*`, `EVAL_*`, `QA_REFERENCES_*`, `QMS_CASES_DETAIL_VIEW`, `FEEDBACK_*` — 참조는 `lib/bqRefs.ts` |
| Genesys | `GENESYS_CLIENT_ID` / `GENESYS_CLIENT_SECRET`, `GENESYS_HOST`, `GENESYS_TOKEN_HOST` |
| STT | `STT_API_VERSION`, `STT_LANGUAGE`, `STT_MODEL`, `STT_TEMP_BUCKET` / `GCS_FEEDBACK_BUCKET` |
| 로컬 STT 배치 | `LOCAL_STT_BASE_URL`, `LOCAL_STT_API_KEY`, `LOCAL_STT_CALLBACK_URL`, `LOCAL_STT_CALLBACK_SECRET` |
| Slack | `SLACK_BOT_TOKEN` (평가자 이메일 매핑) |

GCP 인증: BigQuery·Speech는 ADC(`gcloud auth application-default login`) 우선, GCS·Groups는 서비스계정 키 우선(`lib/gcpCredentials.ts`). BigQuery는 `data-proj-470202` 조회·쓰기, STT는 `roles/speech.client`가 필요하다.

---

## 비용 감각 (온디맨드 콜 평가 1건)

| 통화 길이 | Google STT(듀얼채널) | Gemini | 합계 |
|---|---|---|---|
| 5분 | $0.24 ~ 0.36 | ~$0.02 | $0.26 ~ 0.38 |
| 10분 | $0.48 ~ 0.72 | ~$0.03 | $0.51 ~ 0.75 |
| 20분 | $0.96 ~ 1.44 | ~$0.05 | $1.0 ~ 1.5 |

비용 대부분이 STT다. 배치 평가는 로컬 STT 서버로 전사해서 이 비용이 없다. 실제 사용량·추정 비용은 「AI 호출 사용량」 화면에서 본다.

---

## 기술 스택

- Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Seed Design
- NextAuth v4 (Google OAuth) · Google Cloud Identity Groups
- 서빙 DB: PostgreSQL 16 (`pg`) · 웨어하우스: BigQuery · GCS
- Gemini (`@google/generative-ai`) · Google Speech-to-Text · 로컬 STT 서버 · Genesys Cloud
- ffmpeg-static (무발화 감지 폴백) · Vitest + Testing Library

## 프로젝트 구조

```
app/(main)/          로그인 뒤 화면 (call-quality · feedback · eval-ops · eval-design · results · admin · usage · guide)
app/api/             route handlers (call-quality · evaluations · evaluate · eval-ops · eval-design · prompts · qa · results · stats …)
lib/                 HTTP 비의존 모듈
  servingDb · servingSync · servingMirror · qmsResultsSync     서빙 DB 연결·동기화·덤프
  callServingStore · feedbackServingStore · servingEvalStore  목록·평가 결과
  evalResultStore · evalReview*Store · evaluationItemResultStore
  promptStore · criterionStore · highRiskFlagStore · evalOps*  평가 설계·운영
  resultsStore · monthlyReport*                                품질평가
  genesys · stt · localSttClient · gemini · evaluate · silence · pii
  sttBatch* · evalBatch* · reviewAssign*                       배치·스케줄러
  bqRefs · bigquery · adminEmails · resolveAccess · googleGroups
components/          화면 컴포넌트 (eval-design · eval-ops · results · guide …)
db/migrations/       서빙 DB 스키마 (파일명 순 적용)
scripts/             serving-* · 워치독 · 마이그레이션·검증 스크립트 · bq/ (BQ 뷰·테이블 SQL)
instrumentation.ts   서버 기동 시 스케줄러·동기화 루프
```

## 문서

- [QMS 개요](docs/qms/00-overview.md) · [판정 모델](docs/qms/01-judgment-model.md) · [용어](docs/qms/glossary.md) · [원천 데이터](docs/qms/sources.md)
- [서빙 DB](docs/qms/system/serving-db.md) · [시스템 요약](docs/qms/system/README.md)
- [현황·타임라인](docs/qms/status-and-timeline.md)
- [서비스 구조](docs/helpdesk-x_서비스구조.md) — 포크 이전(helpdesk-x) 시절 문서라 일부 옛 정보가 섞여 있다.
- `docs/devlog/`, `docs/superpowers/` — 과거 기록.

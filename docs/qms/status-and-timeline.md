# QRadar 구현 현황 · 타임라인

기준일: **2026-08-26**. MCP 3차 발표(2026-07 말, 콜 분석 E2E) 이후 운영 투입·피드백을 반영한 스냅샷.  
시각 보드: Cursor canvas `qradar-status-timeline.canvas.tsx`.

프로덕션: `https://helpdesk-x.daangnservice.com` · 권한은 이메일 화이트리스트(`lib/adminEmails.ts`).

---

## 한 줄 요약

MCP 3차 시점의 QRadar는 **콜 1건을 골라 Genesys→STT→Gemini CS 체크리스트로 분석**하는 도구였다.  
지금은 그 파이프라인 위에 **평가 설계 · 수기 검수 · 배분/스케줄 · 품질평가 리포트**가 붙어, 성장문화실이 **실제 월 평가에 쓰는 운영 시스템**에 가깝다. 자동 배치 평가·GAS 완전 폐기·상담사 「내 결과」는 아직 후속이다.

| 구분 | 수량 |
|---|---|
| 운영 중 화면 (고유 라우트) | 24 |
| 구현 중 (초안 UI, API 미연동) | 1 — 자동 평가 실행 |
| 레퍼런스에는 있으나 미구현 | 「내 결과」·이의제기·회차 세션 UI·GAS 폐기 등 |

---

## 1. 현재 형태 — 구현된 것

구성원이 실제 평가에 쓰는 경로. 데이터는 BigQuery(`ds_qradar_{dev|prod}` + `ds_growth_culture`).

### 평가 진행

| 화면 | 라우트 | 상태 | 하는 일 |
|---|---|---|---|
| 전체 평가 | `/call-quality` | **운영** | 샘플 필터 → Genesys 녹취 → Google STT(듀얼채널) → Gemini 체크리스트 → 수기 검수 → BQ 저장·공유 |
| 고위험군 평가 | `/call-quality/high-risk` | **운영** | 동일 워크벤치, 고위험 플래그 필터 ON |
| 수기 평가 필요 | `/call-quality/needs-review` | **운영** | AI 완료 · 검수 미완료만 |
| 결과 공유 | `/call-quality/result/[id]` | **운영** | `analysis_id` 딥링크 |

핵심 파이프라인(MCP 3차 산출물, 이후 검수·워크벤치로 확장):

1. BQ `qradar_evaluation_cases`에서 통화 선택  
2. Genesys 단건 recording → WAV  
3. STT `longRunningRecognize` 듀얼채널 + 무발화 공백  
4. production 평가표 + Gemini 2.5 Flash  
5. STT 위 수기 정정 → 「검수 완료」(`human_result` / `match`)  
6. `qradar_evaluation_results` 저장. 오디오는 영구 저장하지 않음. PII 마스킹.

### 평가 운영

| 화면 | 라우트 | 상태 | 하는 일 |
|---|---|---|---|
| 평가 스케줄 | `/eval-ops/schedule` | **운영** | 확정 배분 이력 기준 월 캘린더·완료 체크·개인일정 |
| 평가 배분 | `/eval-ops/assign` | **운영** | 대상자·일감·평가자·시뮬·이력. 확정 시 BQ `qradar_dist_*` |
| 확정 배분 | `/eval-ops/assign?tab=assign&confirmed=1` | **운영** | 마지막 확정 셋 딥링크 |
| 검수 현황 | `/eval-ops/review-status` | **운영** | 수기 검수 완료 케이스 Accuracy/Recall/Precision·matrix·오탐/미탐 |

한계: 대상자 SOT는 아직 시트(BQ 적재). 월 잠금·팀 확정은 이식됨. Google Groups 멤버십은 이메일 화이트리스트로 flatten.

### 평가 설계

| 화면 | 라우트 | 상태 |
|---|---|---|
| 평가표 | `/eval-design/sheets` | **운영** — 템플릿·버전·production |
| 고위험군 플래그 | `/eval-design/high-risk` | **운영** — 장콜·발화비율 등 규칙 |
| 평가 항목 | `/eval-design/items` | **운영** — criterion source view (읽기) |
| AI 평가 항목 | `/eval-design/ai-items` | **운영** — 항목별 프롬프트 버전 |
| 정확도 대시보드 | `/eval-design/accuracy` | **운영** — Train 수기 vs AI (Gate 90% 안내) |
| AI 비교·개선 | `/eval-design/compare` | **운영** — Train 샘플 재평가 |
| 프롬프트 개선 | `/eval-design/prompt-improve` | **운영** — FP/FN → LLM 초안 |
| AI 호출 사용량 | `/eval-design/llm-usage` | **운영** — 토큰·latency·추정 비용 |

Train(`purpose=qa_eval`)과 운영 검수(`call_eval` + 검수완료)는 데이터면을 분리하고 UI 패턴은 공유한다. 상세: [train-reference-lineage.md](eval-design/train-reference-lineage.md).

### 품질평가 (결과)

| 화면 | 라우트 | 상태 |
|---|---|---|
| 리포트 | `/results/report` | **운영** — Hot/Cold 요약·추이·조직·평가표 |
| 평가 현황 | `/results/status` | **운영** — 월 ▸ 팀 ▸ 템플릿 ▸ 평가표 트리 |
| 케이스 상세 | `/results/cases` | **운영** — QMS 케이스 열람 |
| 월별 집계 | `/results/aggregate` | **운영** — 팀별 Cold 집계 |

데이터: `growthBq.qmsCasesDetailView`. 상담사 「내 결과」는 후속.

### 시스템 · 도움말

| 화면 | 라우트 | 상태 |
|---|---|---|
| 사용량 | `/usage` | **운영** — 페이지뷰 (`qradar_usage_events`) |
| AI 평가 job | `/admin/eval-schedule` | **운영** — 인메모리. 재시작 시 유실. QMS 회차와 별개 |
| Slack 유저 | `/admin/slack-users` | **운영** — sudo 대상 목록 동기화 |
| sudo | `/admin/sudo` | **운영** — 관리자가 다른 이메일 권한으로 보기 |
| 이용 설명서 | `/guide` | **운영** |

---

## 2. 구현 중인 것

| 항목 | 위치 | 무엇이 남았나 |
|---|---|---|
| **자동 평가 실행** | `/eval-ops/auto-run` | 스케줄·상담사당 목표·STT v2 Dynamic Batch → 온디맨드 Gemini **초안 UI**. API·BQ·배치 파이프라인 **미연동** (로컬 mock) |
| GAS → BQ **P5 폐기** | ops-migration | 읽기·쓰기·시뮬까지 이식됨. 시트 쓰기 중단·리다이렉트·공지는 미완. 대상자 SOT가 아직 시트 |
| 평가 스케줄 ↔ 배분 자동 연동 | `/eval-ops/schedule` | 확정 이력에서 일정을 만들 수 있음. GAS 시절처럼 STEP1 수동 입력을 완전 대체했는지, 완료 3단(평가/리더/본인) 운영 정착은 피드백 중 |

운영 피드백으로 이미 들어간 것(구현됨, 다만 다듬는 중): STT 위 수기 검수, 검수 현황 KPI, 고위험군, 수기 평가 필요 큐, 재생바, 프롬프트 버전 라벨, 평가셋 비중.

---

## 3. 가능한 기능 (레퍼런스·백로그)

우선은 설계조건·QMS IA·서비스구조 로드맵에 **명시된** 것. 일정 약속은 아님.

### 가까운 운영 공백

- 자동 평가 배치 파이프라인 (초안 화면의 실연동) — 탭을 닫아도 되는 비동기 job과 한 세트
- 아카이브 녹취 비동기 복원 (현재 ARCHIVED면 즉시 실패)
- 평가 **세션(회차)** 전용 UI — 평가표 production 스냅샷 + 공지. 지금은 버전 지정만
- GAS 웹앱 폐기 · 시트 쓰기 중단 (P5)
- 대상자 명단 SOT를 시트가 아닌 BQ(+HR 원천)로

### QMS 설계조건에 있으나 미구현

- 상담사/구성원 **「내 결과」** 본인 열람
- **이의제기** (신청→QA검토→재학습 케이스)
- 콜 레벨 **Melt / Hot / Cold / CriticalCold** 4단계 (현재는 항목 Hot/Cold + CS 체크리스트 위반)
- **confirmed / provisional** Gate 소급 전환·롤백 로그
- 직무축 AI (절차준수·리스크예방·중대 오안내 — 지식베이스/CRM 필요)
- 당근서비스워크 **평가폼 자동기입** (`evaluation_criterions_id` 매핑은 있음)
- 리포트 PDF · AI 콜 결과 딥링크 · 평가자/이의 집계
- 사용자·권한 UI (현재는 이메일 배열). Google Groups 연동
- 타깃 모니터링 · 외부 대화

### 기술 부채 (동작 유지)

`docs/helpdesk-x_서비스구조.md` §10: `analysisStore` 래퍼 제거, `/api/prompts`·`/api/qa` 네임스페이스 통일, `lib/` 도메인 폴더.

---

## 4. 타임라인 — 체크포인트 · 마일스톤

날짜는 git 커밋·개발일지·파일 mtime 기준. **MCP 3차 = 2026-07-24 콜 분석 E2E + CS 체크리스트**로 본다. 그 이후 대량은 워킹트리(미커밋)로 쌓였다.

| 때 | 마일스톤 | 산출물 |
|---|---|---|
| **07-18** | MCP 1차 — 로컬 1단계 | Next.js 스캐폴드. m4a 업로드 → ffmpeg 공백 + Gemini 3점(태도/해결/흐름). AWS 없이 로컬 동기 |
| **07-19** | 사내 도구 골격 | Google SSO(`@daangnservice.com`) · noindex · 사용량 트래킹 착수. (파손 판별은 이후 제거) |
| **07-20~21** | 관측 | `/usage` 관리자 대시보드 |
| **07-22** | 배포 | EC2 Docker `standalone` + ALB. Vercel 서버리스 한계(콜 분석 장시간) 탈출 |
| **07-23** | MCP 2차 — 실콜 입구 | 업로드 제거. BQ 샘플 목록 → Genesys 배치 녹취 → 기존 AI |
| **07-24 오전** | 실데이터 E2E | 뷰→실물 테이블, Genesys **단건**(수 초), 결과 슬라이드 패널 |
| **07-24 오후** | 분석 도구로 재정의 | 필터, 조직 탭, BQ 영구저장·공유 URL, **Google STT 듀얼채널**, 오디오 프록시, PII |
| **07-24 저녁** | **MCP 3차 완료 (발표 스냅샷)** | 성장문화실 **CS 체크리스트 20항목** (점수제 폐기, 근거 인용 강제). 사람 평가 대비 일치율은 당시 후속 |
| **07-27** | 긴 통화 운영 | `/api/evaluate` **NDJSON 스트리밍**(ALB idle timeout 회피), Gemini 대기 상한 300초, 스크립트 UX |
| **07-29** | 운영 안정화 · **마지막 main 커밋** | 필터 권한 가드, 실패 드러내기, `call_start` **KST**, 샘플 적재 점검 스크립트 |
| **08-03** | QMS IA 이식 시작 | `/eval-design/*` — 평가표·항목·정확도·비교·LLM 사용량. 설계 HTML(0803) 반영 |
| **08-12** | 설계 루프 닫기 | 프롬프트 개선, `/guide`, 평가 설계 레이아웃 |
| **08-14** | 비교 워크벤치 | Train 재평가 UX |
| **08-25** | **운영 화면 대량 이식** | GAS 3종 → `/eval-ops/*` · `/results/*`. 고위험군, 검수 현황, 수기 평가 필요, 자동평가 **초안**, sudo/Slack |
| **08-26** | **현재** | 구성원 실평가 사용. 검수·배분 데이터 축적. 본 문서 |

### MCP 3차 이후 무엇이 달라졌나

발표 때 있던 것: 콜 고르기 → AI 분석 → 결과 URL.  
이후에 붙은 것:

- **수기 검수**가 평가 진행의 본 작업이 됨 (STT 위 항목 정정·검수 완료)
- **평가표/프롬프트 버전**을 웹에서 발행하고 production으로 고정
- Train 골드로 **정확도·비교·프롬프트 개선**
- 월 평가 **대상·배분·스케줄**을 시트 웹앱 대신 QRadar에서
- 사람 평가 완료 건 **리포트/현황/케이스**
- 고위험군·검수 큐로 트리아지

---

## 5. 레퍼런스로 삼은 기존 대시보드

구현 시 Primary HTML의 `data-screen-label` 단위로 화면을 맞춘다. GAS HTML은 **레퍼런스만** — iframe 이식 없음. 화면은 React + SEED / `qms-tokens`.

### A. QMS 설계 HTML (IA · 판정 모델)

| 소스 | 역할 |
|---|---|
| `qms_ref/당근 QMS 평가시스템 설계 (0803)_haro/당근서비스 QMS.dc.html` | **Primary UI.** 좌측 IA(평가 진행/운영/설계/품질평가/시스템) |
| `uploads/AI_QMS_개편_설계조건명세.md` | 100점제 → Hot/Cold, CS/직무 8항목, Gate 90%, confirmed/provisional |
| `당근_QMS_이용_매뉴얼.html` | 역할별 이용 톤. `/guide`가 앱에 실제 있는 화면만 다룸 |
| `QMS 설계조건 반영현황.dc.html` | 설계 반영 체크 (당시 스냅샷) |
| `AI QMS v3.dc.html` | **구버전. 참고만** — 100점제·축소 IA |

작성: Haro · 성장문화팀. 0803 = 2026-08-03 설계 패키지.

### B. GAS 웹앱 3종 (Sheets 운영 → QRadar)

| GAS | 제품명 | 하던 일 | QRadar |
|---|---|---|---|
| `qa_distribution` | 품질평가 대상자 선정 · 업무 자동배분 시뮬레이터 | 월 명단 판정·팀 확정·GP 배분 알고리즘·이력 | `/eval-ops/assign` |
| `qa_scheduler` | 엘리의 평가 할 일 한판 | 월 회차×채널 일정 바, 완료 3단, 개인일정 | `/eval-ops/schedule` |
| `qa_dashboard` | 평가 케이스 상세 대시보드 | 월▸구성원▸템플릿▸케이스, 팀별 Cold 집계 | `/results/cases` · `/results/aggregate` (+ 리포트·현황은 QMS IA) |

마이그레이션 원칙·페이즈: [ops-migration/README.md](ops-migration/README.md).  
P0 문서 → P1 적재 → P2 결과 읽기 → P3–P4 배분 → P4b 스케줄 → **P5 GAS 폐기(미완)**.

배분 알고리즘·판정 규칙은 클라이언트 JS에서 `lib/` + 단위 테스트로 옮겼다.

---

## 관련 문서

- [00-overview.md](00-overview.md) — IA · 라우트 매핑
- [01-judgment-model.md](01-judgment-model.md) — Hot/Cold · Gate
- [glossary.md](glossary.md)
- [../helpdesk-x_서비스구조.md](../helpdesk-x_서비스구조.md) — 파이프라인 · API · 로드맵
- [../README.md](../README.md) — 실행·배포·비용

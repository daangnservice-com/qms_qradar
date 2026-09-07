# QMS 개요 (helpdesk-x)

당근 콘택센터 QA 평가 시스템의 IA·판정 모델을 helpdesk-x에 단계적으로 이식한다.

## 좌측 IA (레퍼런스)

| 그룹 | 화면 | helpdesk-x 이번 범위 |
|---|---|---|
| 홈 | 대시보드 | 비범위 (`/`는 권한별 리다이렉트) |
| **평가 진행** | 전체 평가 · 고위험군 평가 | `/call-quality` · `/call-quality/high-risk` |
| **평가 운영** | 스케줄 · 배분 · 검수 현황 | `/eval-ops/schedule` · `/eval-ops/assign`(확정 배분 딥링크) · `/eval-ops/review-status` · `/admin/eval-schedule`≈인메모리 job |
| **평가 설계** | 평가표, 평가 항목(AI 평가 항목 하위), 정확도, AI 비교 | **구현됨** (+ 고위험군 플래그·프롬프트 개선·LLM 사용량) |
| 품질평가 | 리포트, 케이스, 집계, 내 결과 | **리포트·평가 현황·케이스 상세·월별 집계** `/results/*`. 상담사「내 결과」는 후속 |
| 시스템 | 사용자, 권한 | **이메일 기반**. 사용량·AI 평가 job(관리자) |
| (제품) | 이용 설명서 | `/guide` |

## helpdesk-x 라우트 매핑

| 레퍼런스 | 라우트 | 백엔드 |
|---|---|---|
| 평가표 | `/eval-design/sheets` | `promptStore` 평가표 템플릿·버전 |
| 고위험군 플래그 | `/eval-design/high-risk` | `highRiskFlagStore` |
| 평가 항목 | `/eval-design/items` | `criterionStore` source view |
| AI 평가 항목 | `/eval-design/ai-items` | `criterionStore` prompts (사이드바: 평가 항목 하위) |
| 정확도 대시보드 | `/eval-design/accuracy` | `qaStore` matrix · 공유 metrics UI |
| AI 비교·개선 | `/eval-design/compare` | `qaStore` compare + evaluate |
| 프롬프트 개선 | `/eval-design/prompt-improve` | Train/Test 불일치 + LLM 초안 |
| AI 호출 사용량 | `/eval-design/llm-usage` | `llm_call_logs` |
| 전체 평가 | `/call-quality` | Genesys→STT→Gemini · `evalResultStore` |
| 고위험군 평가 | `/call-quality/high-risk` | 동일 + `highRiskOnly` |
| 평가 배분 | `/eval-ops/assign` | `evalOpsStore` + BQ `qradar_eval_targets` / `qradar_dist_*` |
| 확정 배분 | `/eval-ops/assign?tab=assign&confirmed=1` | 마지막 확정 셋 + 배분 탭 |
| 평가 스케줄 | `/eval-ops/schedule` | 확정 이력 기반 개인 일정 |
| 검수 현황 | `/eval-ops/review-status` | `reviewStatusStore` · `call_eval`+검수완료 |
| (품질평가) 리포트·현황·케이스·집계 | `/results/*` | `resultsStore` |
| (시스템) 사용량 | `/usage` | `qradar_usage_events` |
| (시스템) AI 평가 job | `/admin/eval-schedule` | `lib/evalSchedule.ts` (인메모리) |
| 이용 설명서 | `/guide` | `components/guide` |

레거시 `/prompts` → sheets, `/qa` → accuracy 리다이렉트.  
API 일부는 레거시 경로명 유지(`/api/prompts`, `/api/qa/*`). UI 네임스페이스와의 통일은 [서비스구조 리팩토링 백로그](../helpdesk-x_서비스구조.md).

Train 레퍼런스 뷰 → 통합 `qradar_evaluation_results` 리니지: [eval-design/train-reference-lineage.md](eval-design/train-reference-lineage.md).

## 역할 (레퍼런스)

시스템관리자 · QA 매니저 · QA 평가자 · 상담사/구성원.  
현재 helpdesk-x는 **이메일**로 사용자를 식별하고, 콜품질 권한(`canAccessAnyCallQuality`, `lib/adminEmails.ts`)으로 평가 설계를 게이트한다. 상세는 [시스템](system/README.md).

## 상세 문서

- [구현 현황 · 타임라인](status-and-timeline.md) — MCP 3차 이후 스냅샷 (2026-08-26)
- [판정 모델](01-judgment-model.md)
- [소스 포인터](sources.md)
- [용어집](glossary.md)
- [평가 설계](eval-design/)
- [평가 운영 · 검수 현황](eval-ops/)
- [GAS → QRadar 운영/결과 마이그레이션](ops-migration/README.md)
- [서비스 전체 구조](../helpdesk-x_서비스구조.md)

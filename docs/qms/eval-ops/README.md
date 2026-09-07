# 평가 운영 (요약)

스케줄 · 진행(AI·수기 검수) · 타깃 모니터링 · 외부 대화 · **평가 대상** · 이의 제기 · **업무 배분** · **검수 현황**.

## helpdesk-x에 있는 것

| 레퍼런스에 가까운 것 | 구현 | 한계 |
|---|---|---|
| 평가 **진행**(런타임) | `/call-quality`(전체 평가) · `/call-quality/high-risk`(고위험군) | QMS 회차·배정·타깃 모니터링 아님 |
| **검수 현황** | `/eval-ops/review-status` — 수기 검수 완료 통계·리스트 | [검수-현황.md](검수-현황.md) |
| 가벼운 **스케줄/현황**(job) | `/admin/eval-schedule` — 동일 conversation 중복 실행 방지·진행 step | **인메모리**. QMS 회차와 별개 |
| **평가 배분** 시뮬레이터 | `/eval-ops/assign` — 대상자·일감·평가자·배분·이력 · 확정 배분 딥링크 | 대상자 SOT는 시트(BQ 적재) |
| **평가 스케줄** (월별 일정) | `/eval-ops/schedule` | 확정 배분 이력 기준 개인 일정 |

## GAS에서 이식 중 (Sheets → BQ)

| 화면 | GAS | QRadar | 문서 |
|---|---|---|---|
| 품질평가 대상자 명단 | `qa_distribution` ① | `/eval-ops/assign` 대상자 탭 | [ops-migration/qa-distribution](../ops-migration/qa-distribution.md) |
| 팀·채널 설정 · 배분 · 이력 | `qa_distribution` ②③④⑤ | 같은 페이지의 일감·평가자·배분·이력 탭 | 동일 |
| 월별 평가 일정 · 완료 추적 | `qa_scheduler` | `/eval-ops/schedule` | [ops-migration/qa-scheduler](../ops-migration/qa-scheduler.md) |

백엔드는 Google Sheets → BigQuery(`qradar_eval_targets`, `qradar_dist_*`). 사이드바 「평가 운영」. 신규 배분 셋은 직전 확정 planSnapshot(팀/GP/AQT)을 복사한다.

## 후속(비범위)

타깃/외부대화 · 이의제기 · 상담사 대상 결과 공개 · 영구 회차·담당자 배정 job 보드.

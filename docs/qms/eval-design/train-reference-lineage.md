# Train 레퍼런스 데이터 리니지

수기 평가 완료 케이스를 Train 셋으로 쓰는 경로와, 앱이 적재하는 **통합 평가 결과 테이블**·항목 리뷰를 정리한다.

## 소스 (공유 입력 · 읽기 전용)

| 객체 | 위치 | 비고 |
|---|---|---|
| Train 레퍼런스 뷰 | `ds_growth_culture.vw_qradar_evaluation_case_references_pay_phone_inquries` | env `QA_REFERENCES_VIEW`. 뷰명에 `pay`가 남아 있어도 **전화채널 멀티팀**(페이·알바·광고 등) 포함 |
| 필터 | `year_month >= QA_REFERENCES_MIN_YEAR_MONTH` (기본 `2026-06-01`) | 6월 이전 `score_detail`은 criterion **이름≈동일·id≠현재** 체계라 Train에서 제외 |
| 주요 컬럼 | `year_month`, `case_content`, `case_result`, `score_detail`, `memo_detail`, `evaluation_extra` | conversation id는 `case_content.genesys_conversation_id` |

앱 로더: `lib/qaStore.ts` → `listQaReferenceSamples()`.

**이 뷰와 무관한 입력 (혼동 주의)**

| 객체 | 용도 |
|---|---|
| `ds_growth_culture.qradar_evaluation_cases` | **평가 진행(Test/ops)** 샘플 풀 |
| `ds_growth_culture.vw_evaluation_criterions` | 평가 항목 마스터 |

## 통합 AI 결과 테이블 (앱 적재 · `ds_qradar_{prod|dev}`)

실행 메타데이터의 기준 테이블은 `qradar_evaluation_results`다.  
(`purpose` = `call_eval` | `qa_eval`, `org` = growth/pay). 기준 정의와
기준별 판정은 정규화 테이블로 분리한다. 통합 전 `qradar_qa_eval_results`는
`scripts/migrate-qa-eval-results.ts`로 물리 복사한다 (앱 런타임 읽기 fallback 없음).

```
Train 뷰 ──/api/qa/evaluate──► qradar_evaluation_results (purpose=qa_eval)
cases ───/api/evaluate────────► qradar_evaluation_results (purpose=call_eval)
                                      │
                                      ├─► qradar_eval_set_criteria
                                      │     (평가셋 ↔ 기준/프롬프트 연결)
                                      ├─► qradar_evaluation_criterion_results
                                            (실행별 violated/reason/evidence)
                                      ├─► 평가 진행 완료 배지 / 결과 패널
                                      │     (org 필터, purpose 무관 최신 1건)
                                      ├─► AI 비교·개선 · matrix
                                      │     (purpose=qa_eval + prompt_version_id)
                                      └─► 검수 완료 시 append 스냅샷
                                            review_completed_*, human_result, match
```

| 컬럼 그룹 | 예시 |
|---|---|
| 공통 | `analysis_id`, `analyzed_at`, `conversation_id`, `org`, `result_json`, `transcript_json`, … |
| 목적 | `purpose` |
| 평가셋 | `prompt_version_id` (= `eval_set_id`), `prompt_version` |
| QA/수기 라벨 | `human_result`, `ai_label`, `match`, `checklist_json` |
| 검수 완료 | `review_completed_at`, `review_completed_by` |

스토어: `lib/evalResultStore.ts` (`analysisStore` / `qaStore` save·list는 래퍼).

`llm_prompt_versions`는 평가셋 차원, `vw_evaluation_criterions`와
`llm_criterion_prompts`는 기준 차원/기준 프롬프트 버전이다.
신규 결과의 기준 정의는 결과 JSON에 다시 저장하지 않고
`eval_set_id`를 통해 복원하며, 기존 결과의 스냅샷 JSON은 하위 호환으로 읽는다.

### 항목 단위 수기 리뷰 (별도)

| 테이블 | 소스 | 비고 |
|---|---|---|
| `qradar_eval_human_reviews` | 평가 진행 STT 항목 정정·추가 | 스키마 변경 없음. 「검수 완료」 시 파생 `human_result`에 반영 |

## 화면 · API 매핑

| 화면 | API | 읽기 |
|---|---|---|
| AI 비교·개선 | `/api/qa/samples`, `/compare`, `/evaluate` | Train 뷰 + `purpose=qa_eval` |
| 정확도 대시보드 | `/api/qa/matrix` | `purpose=qa_eval` ⊕ 뷰 `score_detail` |
| 전체/고위험군 평가 | `/api/call-quality/samples`, `/results`, `/evaluate` | cases + 통합 결과 (org, purpose 무관 최신) |
| 검수 완료 | `POST /api/call-quality/reviews/complete` | 최신 결과 스냅샷 append + 파생 라벨 |
| **검수 현황** | `GET /api/eval-ops/review-status` | `purpose=call_eval` + `review_completed_at` 기간 필터 · 항목 리뷰로 Cold 개수 |
| 프롬프트 개선 · Train | `/api/eval-design/prompt-improve/mismatches?set=train` | QA 결과 FP/FN |
| 프롬프트 개선 · Test | `…?set=test` | `eval_human_reviews` |

## 운영 메모

- 뷰에 팀이 늘어나도 **결과 테이블 스키마는 그대로**. QA는 `purpose=qa_eval`로만 matrix/Compare에 집계한다.
- 6월 이전 골드를 다시 넣으면 criterion id가 어긋나 FP/FN·정확도가 오염된다 → `QA_REFERENCES_MIN_YEAR_MONTH`로 차단.
- **검수 현황**은 ops(`call_eval`+검수완료)를 별도 집계한다. Train 정확도 대시보드와 UI는 공유하되 데이터면은 분리.
- 데브 wipe 전제: ensure 시 스키마 생성 / `addColumnsIfMissing`. prod 마이그레이션 SQL은 별도.

# qa_dashboard — 구성 분석 · BQ 스키마 · 마이그레이션 플랜

**소스**: `qms_ref/Ref/qa_dashboard/`  
**배포명**: 평가 케이스 상세 대시보드  
**런타임**: GAS Web App (`doGet` → `Index.html`) + Spreadsheet `data` 시트  
**권한**: DOMAIN, `executeAs: USER_DEPLOYING` (별도 이메일 ACL 없음 — 시트 공유 범위에 의존)

---

## 1. 구성 요약

**읽기 전용** 분석 UI. 시트 전체를 한 번에 `getDashboardData()`로 받아 브라우저에서 트리·집계.

| 뷰 | data-view | 역할 |
|---|---|---|
| 케이스 상세 | `detail` | 월 ▸ 구성원 ▸ 템플릿 ▸ 케이스 카드. 필터·검색·오답만 |
| 월별 팀별 결과 집계 | `aggregate` | 월 ▸ 팀 ▸ 구성원. Cold / Cold아님 / Cold비율 |

파일:

| 파일 | 역할 | 규모 |
|---|---|---|
| `Code.js` | 시트 → normalize → options | ~270 LOC |
| `Index.html` | 필터·트리 렌더·집계·JSON pretty | ~1.8k LOC |

QMS IA상 [`results`](../results/README.md) (리포트 / 내 결과)의 **운영자용 케이스 리포트**에 해당. 상담사 「내 결과」는 후속.

---

## 2. 데이터 모델 (시트 `data`)

필수 컬럼 (`Code.js` `requiredColumns`):

| 컬럼 | 의미 |
|---|---|
| `evaluation_id` | 평가(회차/세션) ID |
| `evaluation_template_id` / `template_name` | 평가표 |
| `evaluation_target_id` | 대상 인스턴스 |
| `year_month` | 평가월 |
| `team_id` / `team_name` (+ optional `fallback_current_team_name`) | 팀 |
| `target_admin_user_id` / `first_name` / `employee_number` | 구성원 |
| `status` / `result` | 대상 상태 · 결과(`cold` 등) |
| `evaluated_count` / `cold_count` | 집계용 카운트 |
| `case_id` / `case_content` / `case_status` / `case_scores` / `case_result` / `case_extra` | 케이스 |
| `score_detail` / `memo_detail` | 오답 항목 · 메모 (있으면 뱃지) |

정규화 파생 키:

- `month_key`, `team_key`(=해석된 팀명), `member_key`, `template_key`, `case_key`
- `is_cold` ← `result.trim().toLowerCase() === 'cold'`
- `has_wrong_score` / `has_memo`

필터 옵션: months / teams / members / templates (클라이언트 빌드).

---

## 3. UI 구조

### 3.1 케이스 상세

```
Filters: 월 | 팀 | 구성원 | 템플릿 | 검색 | 오답만 | 새로고침
Summary: 케이스수 · 오답 · 메모포함 · 구성원수 · 템플릿수
Tree:
  <details> 월
    <details> 구성원 (+ summary: cold 등)
      <details> 템플릿
        Case card:
          meta badges, case_content (JSON/URL 스마트 렌더),
          score_detail(danger), memo_detail,
          raw toggles: case_scores / case_extra / evaluation_extra / extra
```

### 3.2 월별 팀별 집계

```
Filters: 월 | 팀
Summary: 구성원 · Cold · Cold아님 · Cold비율
Tree: 월 ▸ 팀 ▸ 구성원 (구성원 row는 상세 뷰의 member 블록 재사용)
```

집계는 **행 단위**로 cold 여부를 세는 클라이언트 로직 (`buildAggregateTree`).

---

## 4. QRadar / 기존 코드와의 관계

| 기존 | 관계 |
|---|---|
| `components/EvalCaseDetail.tsx` | **AI 콜 평가** 결과(체크리스트·STT). 본 대시보드는 **사람/QMS 케이스**(score_detail·memo·case_content). **컴포넌트 재사용 금지**, 패턴(섹션·뱃지)만 맞춤 |
| `qradar_evaluation_results` | AI(STT+Gemini) 결과. 스키마가 다름 |
| **`vw_quality_evaluation_cases_detail_with_fallback`** | **원천 (확정)**. `data-proj-470202.ds_growth_culture` — GAS 시트 `data`와 동일 계열. **qradar로 복사하지 않음** — `growthBq.qmsCasesDetailView`로 직접 조회 |
| `/call-quality/result/[id]` | 콜 단위 공유 페이지. `/results/cases`는 월·팀 브라우징 |

프로브 결과(2026-08): 뷰 컬럼 28개, 약 4,581행. GAS `requiredColumns`와 일치(+ typed INT64/DATE).

---

## 5. BigQuery 매핑

### 5.1 원천 = 공유 뷰 (적재 불필요)

```text
data-proj-470202.ds_growth_culture.vw_quality_evaluation_cases_detail_with_fallback
```

앱 참조: `lib/bqRefs.ts` → `growthBq.qmsCasesDetailView` / `qmsCasesDetailSql()`.
env 오버라이드: `QMS_CASES_DETAIL_VIEW`.

### 5.2 API 설계 (읽기 전용)

GAS처럼 전체 dump 금지. 서버 필터 + 페이지네이션.

| Endpoint | 용도 |
|---|---|
| `GET /api/results/options` | months/teams/members/templates distinct |
| `GET /api/results/cases?month=&team=&member=&template=&q=&wrongOnly=&limit=` | 상세 트리·월별 집계용 행. month 생략 시 평가완료 전체 |
| `GET /api/results/aggregate?month=&team=` | SQL 집계 (화면은 cases 전체 로드 후 클라 필터) |
| `GET /api/results/report?range=&from=&to=` | 품질평가 리포트. Hot/Cold는 구성원 단위, 케이스 비율은 별도 |

집계는 **BQ SQL**로 옮겨 브라우저 O(n) 제거.

---

## 6. UI 마이그레이션 (SEED / React)

**HTML 그대로 쓰지 않는다.** GAS `Index.html`은 레퍼런스·로직 명세용이다.
QRadar Next.js 페이지 + SEED/`qms-tokens`로 재구현한다 (기존 `eval-design`·`call-quality`와 동일).

| 뷰 | 라우트 | 컴포넌트(가칭) |
|---|---|---|
| 상세 + 집계 탭 | `/results` (탭) 또는 `/results/cases` + `/results/aggregate` | `ResultsCasesWorkbench` / `ResultsAggregateWorkbench` |

Sidebar 「품질평가」 그룹:

- 리포트 → `/results/report`
- 케이스 상세 → `/results/cases`
- 월별 집계 → `/results/aggregate`

SEED:

- sticky filter bar → `FilterPanel` 패턴
- summary cards → 기존 accuracy 대시보드 Stat와 동일 토큰
- `<details>` 트리 → Accordion 또는 disclosure (접근성)
- danger/memo 블록 → `var(--critical-*)` / muted surface (GAS 회색 브랜드 폐기, QRadar `--brand` 사용)
- case_content URL/JSON 렌더 로직 → `lib/resultsCaseContent.ts`로 이전

권한: `canAccessAnyCallQuality` 또는 별도 `RESULTS_EMAILS`. 개인정보(이름·사번·케이스 본문) 포함 → 관리자/QA만.

---

## 7. 마이그레이션 플랜 (상세)

### Phase A — 원천 확정 (완료)

1. ~~시트 `data` 원천 탐색~~ → **공유 BQ 뷰 확정**
2. `bqRefs` 등록 (`qmsCasesDetailView`)
3. 프로브 스크립트: `npm run probe:qms-bq`

### Phase B — 읽기 API + 집계 SQL (P1–P2)

1. options / cases / aggregate API.
2. Cold 집계 golden test (동일 fixture vs GAS `buildAggregateTree`).
3. 페이지네이션·월 필수 필터로 쿼리 비용 가드.

### Phase C — SEED UI (P2)

1. `/results/cases` 필터 + 트리 + 케이스 카드.
2. `/results/aggregate` 집계 뷰.
3. Sidebar 「결과」 그룹.
4. `/guide`에 사용법.

### Phase D — 고도화 (후속)

1. 케이스 ↔ QRadar AI 결과(`conversation_id`) 딥링크 (있을 때).
2. 「내 결과」상담사 뷰 (본인 `employee_number`만).
3. PDF/공지 플로우 (results README).

### 리스크

| 리스크 | 대응 |
|---|---|
| 전체 시트 로드 메모리 | 월 필수 + BQ LIMIT/cursor |
| `case_content` 비정형 | 기존 `renderDynamicContentBlock` 포팅 + 안전한 링크만 |
| AI EvalCaseDetail과 혼동 | 라우트·카피·컴포넌트명에 `Qms`/`Results` 명시 |
| 시트 ACL만 있던 보안 | NextAuth + 이메일 화이트리스트 필수 |

### 완료 기준

- [ ] 임의 월 필터 시 GAS와 Cold 수 ±0
- [ ] 오답/메모/검색 필터 동작
- [ ] 대용량(수만 행)에서도 초기 로드 < 3s (월 한정)
- [ ] SEED 토큰으로 브랜드 통일
- [ ] GAS 대시보드 트래픽 이전 완료

---

## 8. distribution과의 의존

| 의존 | 설명 |
|---|---|
| 약함 | 대시보드는 **완료된 평가 케이스** 조회. distribution은 **누가·누가 평가할지** |
| 팀명 | 양쪽 팀 문자열 정규화 규칙 공유 권장 (`normalizeColdTeamName_` 등) |
| 월 | `yyyy-MM` 공통 |

배분 확정 ≠ 케이스 적재. 케이스 파이프라인은 QMS 본평가 도구/시트의 별도 ETL.

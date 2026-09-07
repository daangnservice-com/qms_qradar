# qa_distribution — 구성 분석 · BQ 스키마 · 마이그레이션 플랜

**소스**: `qms_ref/Ref/qa_distribution/`  
**배포명**: 품질평가 대상자 선정 및 업무 자동배분 시뮬레이터  
**런타임**: GAS Web App (`doGet` → `index.html`) + Spreadsheet bound script  
**권한**: DOMAIN, `executeAs: USER_DEPLOYING`

---

## 1. 구성 요약

단일 SPA에 **5개 탭**. 월(`yyyy-MM`)이 전역 필터. 권한에 따라 탭 노출이 갈린다.

| 탭 | UI ID | 권한 | 역할 |
|---|---|---|---|
| ① 품질평가 대상자 명단 | `p0` | roster+ | 재직자 기반 대상/제외 판정, 수동 조정, 팀 확정, 월 잠금 |
| ② 팀별 평가 세부내용 | `p1` | full | 팀·채널 ON/AQT/직무·CS 건수/난이도/COLD%/직무 평가자 |
| ③ 배분 실행 | `p2` | full | GP 설정·CS 비율·배분 알고리즘·드래그 재조정·확정 |
| ④ 대시보드 | `p3` | full | **확정 이력** 기준 평가자/팀/맨먼스 현황 |
| ⑤ 이력 | `p4` | full | 월별 배분 확정 이력 목록 |

파일:

| 파일 | 역할 | 규모 |
|---|---|---|
| `Code.js` | API·시트 I/O·접근제어·COLD·history | ~670 LOC |
| `roster.js` | 대상자 월 생성/동기화/판정/팀확정 | ~530 LOC |
| `index.html` | UI + **배분 알고리즘 전부 클라이언트** | ~2.1k LOC |

---

## 2. 권한 모델 (현행)

```
full   = FULL_ACCESS_CONFIG (성장문화팀 이메일 + growth_ 그룹)
roster = full ∪ ROSTER_ONLY (리더 그룹 이메일/Groups)
none   → 접근 거부 HTML
```

| 동작 | full | roster |
|---|---|---|
| 명단 조회·수동판정·메모·평가항목·팀확정·인원추가 | ✅ | ✅ |
| 새 월 생성·명단 새로고침(sync)·설정 저장·배분·월잠금 | ✅ | ❌ |

QRadar 이식: `lib/adminEmails.ts`에 `DISTRIBUTION_FULL_EMAILS` / `DISTRIBUTION_ROSTER_EMAILS` (또는 역할 enum) 추가. GroupsApp은 1차에서 이메일 목록으로 flatten.

---

## 3. 시트 인벤토리 → BigQuery 매핑

### 3.1 설정·마스터

| 시트 | 열(요약) | BQ 제안 | 비고 |
|---|---|---|---|
| `config` | days, avail, month (KV) | `qradar_dist_config` | 월별 또는 글로벌 KV. `eval_month`, `work_days`, `default_avail_h` |
| `aqt` | 채널, 기준AQT | `qradar_dist_aqt_base` | channel → minutes |
| `teams` | 팀ID·ON·명·GP·인원·CS모드·난이도·COLD% + 채널행 | `qradar_dist_teams` + `qradar_dist_team_channels` | 현행은 채널당 1행 denormalized → 정규화 권장 |
| `gps` | 평가자명·일가용h·버퍼%·CS참여·배분비율%·비율고정 | `qradar_dist_evaluators` | GP = QA 평가자 |
| `eval_items` | 항목(문의/전화/…) | `qradar_dist_eval_item_options` | 명단 다중선택 옵션 |

### 3.2 대상자 · 이력 · 잠금

| 시트 | 열(요약) | BQ 제안 | 비고 |
|---|---|---|---|
| `재직자_raw` | 사번·영문명·팀·파트·레벨·고용·재직상태·입사/전환/퇴사일… | **외부 HR 소스** 또는 `qradar_hr_employees` (읽기 전용 적재) | 월 생성의 원천. 앱이 직접 쓰지 않음 |
| `평가대상자` | 19열 — 월·사번·판정·메모·평가항목·수정자… | `qradar_eval_targets` | PK: `(eval_month, employee_id)` |
| `평가대상자_이력` | 팀 확정 스냅샷 16열 | `qradar_eval_target_snapshots` | 팀 단위 확정 시 append (덮어쓰기=구버전 soft-delete 또는 version) |
| `월확정` | 평가월·확정자·확정시각 | `qradar_eval_month_locks` | 월 단위 잠금 |

### 3.3 배분 이력 · COLD

| 시트 | 열(요약) | BQ 제안 | 비고 |
|---|---|---|---|
| `history` | 월·확정자·시각·CS총건수·전월중복·±5충족·result JSON·ratios JSON·이력ID·meta | `qradar_dist_assign_history` | result/ratios/meta는 JSON 또는 STRUCT |
| `history_detail` | 월·평가자·팀·채널·CS·유형·전화·중복·이력ID·사번·이름 | `qradar_dist_assign_detail` | 확정 시 flatten |
| `팀별 COLD Count` | 년월·팀명·평가모수·COLD건수 | `qradar_team_cold_monthly` | 이미 BQ→시트 연동 추정. **시트 제거 후 원천 BQ 직접 조회** |

### 3.4 DDL 초안 (핵심)

```sql
-- 평가 대상 (월별)
CREATE TABLE IF NOT EXISTS `…qradar_eval_targets` (
  eval_month STRING NOT NULL,          -- yyyy-MM
  employee_id STRING NOT NULL,
  name_en STRING,
  team_name STRING,
  part STRING,
  level STRING,
  employment_type STRING,
  status STRING,                       -- 재직 / 퇴사예정 …
  hire_date DATE,
  convert_date DATE,
  exit_date DATE,
  auto_judge STRING,                   -- 대상 | 제외 (+ 레거시 이모지 strip)
  manual_judge STRING,                 -- '' | 대상 | 제외
  final_judge STRING,
  auto_note STRING,
  memo STRING,
  eval_items ARRAY<STRING>,
  edited_by STRING,
  edited_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
PARTITION BY DATE_TRUNC(PARSE_DATE('%Y-%m', eval_month), MONTH)
CLUSTER BY team_name, employee_id;

-- 배분 확정 이력
CREATE TABLE IF NOT EXISTS `…qradar_dist_assign_history` (
  history_id STRING NOT NULL,          -- yyyy-MM-dd_verN
  eval_month STRING NOT NULL,
  confirmed_by STRING,
  confirmed_at TIMESTAMP,
  total_cs INT64,
  prev_month_repeats INT64,
  within_pm5 BOOL,
  metric STRING,                       -- count | time
  scope STRING,                        -- cs | total
  ratios_json STRING,
  result_json STRING,
  plan_snapshot_json STRING,           -- teams/gps/aqt/cfg 복원용
  inserted_at TIMESTAMP
);
```

판정 값은 UI에서 이모지(`✅/❌`)를 쓰지 말고 `target` / `excluded` enum으로 정규화. 레거시 적재 시 strip.

---

## 4. 도메인 로직 (이식 필수)

### 4.1 대상자 자동 판정 (`judgeTarget_` in `roster.js`)

제외 조건 (우선순위 누적 notes):

1. 레벨 파싱 실패 또는 **L5+**
2. **L2 단기** 계약
3. **퇴사예정** + 퇴사월이 평가월 이전
4. **신규 입사 유예**: 입사월 +2개월 미만 (4월 입사 → 6월부터)
5. **계약 전환 유예**: L2 + 전환일 기준 +2개월 미만
6. 파트명에 **「모니터링」** 포함

제외 팀(명단 자체 미노출): `피플팀`, `성장문화팀`, `X팀`.

최종판정: `manual`이 있으면 우선, 없으면 `auto`.

→ `lib/evalTargetJudge.ts` + vitest로 고정.

### 4.2 월 라이프사이클

```
createMonth → 재직자_raw 스냅샷 + 직전월 keep(수동/메모/항목) + 직전 확정 planSnapshot(팀/GP/AQT)
syncMonth   → 해당 월 행 삭제 후 재생성(keep 유지) — 잠금 시 불가
teamConfirm → 평가대상자_이력에 팀 스냅샷 (동월·동팀 덮어쓰기)
lockMonth   → 전 팀 확정 필수 → 월확정 row → 이후 수정 API 전부 reject
```

### 4.3 배분 알고리즘 (`runAssign` in `index.html`)

클라이언트에 집중되어 있음. 서버로 옮기되 **순수 함수**로 분리해 테스트.

핵심 규칙:

- CS 비율 합 = 100%, 고정(locked) 평가자는 슬라이더에서 제외
- 팀 순서 shuffle; 팀 전체 유지 원칙, 채널 분리 상한 2팀
- 전화 채널: 평가자당 1개 이하
- 목표 비율 **±5%p**
- 전월 확정 이력과 같은 평가자–팀 조합 회피(로테이션)
- metric: `count` | `time`(AQT×건수); scope: `cs` | `total`(직무 고정 포함)
- 확정 전엔 저장 없음; 확정 시 history + detail + planSnapshot

→ `lib/distAssign.ts` (+ UI는 드래그 재조정만 클라이언트).

### 4.4 COLD%

평가월 기준 **이전 3개월** 팀별 COLD/모수 합산 → %. 「페이팀 *파트」는 `페이팀`으로 normalize.

---

## 5. API 표면 (현행 → Next)

| GAS | Method 제안 | 권한 |
|---|---|---|
| `apiLoad` | `GET /api/eval-ops/bootstrap?month=` | roster |
| `apiSelectMonth` | `GET /api/eval-ops/targets?month=` (+ config patch) | roster |
| `apiCreateMonth` | `POST /api/eval-ops/months` | full |
| `apiSyncMonth` | `POST /api/eval-ops/months/:m/sync` | full |
| `apiRosterUpdate` | `PATCH /api/eval-ops/targets` | roster |
| `apiRosterBulkEval` | `POST /api/eval-ops/targets/bulk-eval-items` | roster |
| `apiAddRosterMember` | `POST /api/eval-ops/targets` | roster |
| `apiTeamConfirm` | `POST /api/eval-ops/targets/confirm-team` | roster |
| `apiLockMonth` | `POST /api/eval-ops/months/:m/lock` | full |
| `apiSave` | `PUT /api/eval-ops/plan` (teams/gps/aqt/cfg) | full |
| `apiConfirm` | `POST /api/eval-ops/assign/confirm` | full |
| `apiSaveEvalItemsOptions` | `PUT /api/eval-ops/eval-item-options` | roster |
| (신규) | `POST /api/eval-ops/assign/simulate` — 서버 배분 | full |
| (신규) | `GET /api/eval-ops/cold?month=` | full |

동시성: GAS `LockService` → BQ는 낙관적 잠금(`updated_at`) 또는 `qradar_eval_month_locks` 선조회. 확정/잠금은 트랜잭션성 보장을 위해 단일 API에서 검증.

---

## 6. UI 마이그레이션 (SEED / React)

**HTML 그대로 쓰지 않는다.** `index.html`은 로직·카피 레퍼런스.
Next.js 라우트 + SEED/`qms-tokens`로 재구현 (평가 설계·콜품질과 동일 스택).

### 라우트

| 탭 | 라우트 | 컴포넌트(가칭) |
|---|---|---|
| ① | `/eval-ops/assign` (탭: 대상자) | `EvalOpsWorkbench` |
| ② | 같은 페이지 · 일감 · AQT | 동일 |
| ③④⑤ | 같은 페이지 · 평가자 / 배분 / 현황·이력 | 동일 |

공통: 상단 `평가 년월` Select — 세 라우트가 쿼리 `?month=2026-08` 공유.

SEED 매핑(대략):

| GAS 패턴 | QRadar/SEED |
|---|---|
| `.tab` / `.pane` | 페이지 분리 또는 SegmentedControl |
| `.card` / metrics | `eval-design`과 동일: border + `var(--bg-*)` / Stat 행 |
| `.toggle` | Switch |
| `.btn.bo` / `.bg` | ActionButton / Button (brand / positive) |
| roster 테이블 | 기존 SampleList·FilterPanel 밀도에 맞춘 테이블 |
| 드래그 보드 | HTML5 DnD 유지 가능 — SEED Chip + column layout |
| Pretendard 커스텀 토큰 | `app/qms-tokens.css` + seed foundation |

접근: roster-only 사용자는 Sidebar에 **평가 대상**만 노출.

---

## 7. 마이그레이션 플랜 (상세)

### Phase A — 스키마·적재 (P0–P1)

**소스 스프레드시트**  
https://docs.google.com/spreadsheets/d/1zVtfyduiNpZ0Ro3ZLiDRw4662IxXOufDESFrTHvyAxw

| Sheets 탭 | BQ 테이블 (`ds_qradar_{dev\|prod}`) |
|---|---|
| `config` | `qradar_dist_config` |
| `aqt` | `qradar_dist_aqt` |
| `teams` | `qradar_dist_teams` |
| `gps` | `qradar_dist_evaluators` |
| `history` | `qradar_dist_assign_history` |
| `history_detail` | `qradar_dist_assign_detail` |
| `eval_items` | `qradar_dist_eval_item_options` |
| `월확정` | `qradar_eval_month_locks` |
| `평가대상자` | `qradar_eval_targets` |
| `평가대상자_이력` | `qradar_eval_target_snapshots` |
| `재직자_RAW` (시트 현행명) | `qradar_hr_employees` |
| `재직자_raw` / `재직자 RAW` | (별칭 — 없으면 skip) |
| `팀별 COLD Count` | `qradar_team_cold_monthly` |

참조: `lib/bqRefs.ts` → `distBq` / `DIST_SHEET_TO_TABLE`.

**적재 명령**

```bash
# ADC에 Sheets 스코프 필요 (최초 1회)
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets.readonly,https://www.googleapis.com/auth/drive.readonly

npm run migrate:dist-sheets -- --target=dev --dry-run
npm run migrate:dist-sheets -- --target=dev
```

1. BQ 테이블은 스크립트가 CREATE(기존 있으면 drop+재생성, STRING 스키마 + `_ingested_at`).
2. 이모지/판정 값 normalize는 UI/API 단계에서 (`target`/`excluded`).
3. 프론트는 **React+SEED** (GAS HTML 임베드 금지). HTML은 배분 알고리즘·카피 레퍼런스.

### Phase B — 대상자 UI (P3)

1. 읽기: 월 선택 · 팀/판정 필터 · 메트릭.
2. 쓰기: 수동판정 · 메모 · 평가항목 · bulk · 수동추가.
3. 팀 확정 · 월 잠금.
4. `createMonth` / `syncMonth` + judge 유닛테스트.
5. Sidebar 「평가 운영」 그룹 추가.

### Phase C — 팀·배분 (P4)

1. teams/channels/gps/aqt CRUD.
2. COLD%·명단 인원 자동 반영.
3. `distAssign` 서버 이식 + 시뮬레이트 API.
4. 드래그 재조정 UI → confirm → history.
5. 현황/이력 탭(확정본 only).

### Phase D — 컷오버 (P5)

1. GAS 쓰기 API 비활성 / read-only 안내.
2. 시트는 아카이브. 트리거(`refreshColdDataLog`) 제거.
3. 이용 설명서(`/guide`)에 경로 안내 추가.

### 리스크

| 리스크 | 대응 |
|---|---|
| 배분 알고리즘 미묘한 차이 | 동일 seed fixture로 GAS vs TS golden test |
| Groups 권한 | 초기 이메일 flatten; 이후 Workspace Directory API |
| 대용량 명단 시트 성능 | BQ partition + 월 필터 API (전체 `apiLoad` 금지) |
| planSnapshot 복원 | meta JSON 스키마 버전 필드 추가 |

### 완료 기준

- [x] roster/full 권한 게이트 (이메일 화이트리스트; Groups flatten은 후속)
- [x] 월 생성→판정→팀확정→잠금 플로우 (BQ 쓰기)
- [x] 배분 확정 시 BQ history/detail + planSnapshot 기록
- [x] SEED 시각 언어가 eval-design과 동일 계열 (`/eval-ops/assign`)
- [ ] GAS Web App 트래픽 0 (공지 후)

---

## 8. 기존 QRadar와의 접점

| 기존 | 접점 |
|---|---|
| `/admin/eval-schedule` | **다른 개념**(AI 평가 job). 배분 스케줄과 혼동 금지. 같은 「평가 운영」 그룹에 두되 라벨 구분 |
| `/call-quality` · `/call-quality/high-risk` | 실제 콜 평가 실행(전체/고위험군). 대상자 명단은 배정 **입력**, 콜 평가는 **실행** |
| `eval-design/*` | 평가표/항목 설계. distribution의 `eval_items`는 **채널·유형 태그**로 별개 |
| `adminEmails` | full/roster 화이트리스트 확장 |

용어: glossary에 **GP(평가자)**, **AQT**, **배분 비율**, **월 잠금** 추가 권장.

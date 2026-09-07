# qa_scheduler — 구성 분석 · BQ 스키마 · 마이그레이션 플랜

**소스**: `qms_ref/Ref/qa_scheduler/`  
**배포명**: 엘리의 평가 할 일 한판  
**런타임**: GAS Web App (`doGet` → `Index.html`) + Spreadsheet bound script  
**권한**: `executeAs: USER_DEPLOYING`, `access: MYSELF` (배포자 본인만 — 운영 시 DOMAIN/그룹으로 변경 필요)

**scriptId**: `1x3bpwTG5JcL1qs89ZJmVxHiOPLwm2DI6nlfWj1GO6Kcoi9fXB-Q_UQAB`

---

## 1. 구성 요약

월(`yyyy-MM`) 단위로 **팀·채널·회차별 평가 건수 배분안**을 만들고, **캘린더에 일정 배치**하며, **평가완료 → 리더검토 → 본인확정** 워크플로를 체크하는 운영 보드.

| STEP | UI | 역할 |
|---|---|---|
| 1 | 팀·인원·1인당 건수·평가 횟수·채널 입력 | 월별 배분 **입력 폼** (여러 팀 항목 누적) |
| 2 | 자동 배분안 생성 & 저장 | 회차×채널로 1인당 건수 분할 → 시트 저장(월 덮어쓰기) |
| 3 | 투두리스트 | 미배치 항목 → 캘린더 드래그, 완료 체크 3단 |
| 4 | 캘린더 | 연속 바(lane)·기간 조정·개인일정 |

파일:

| 파일 | 역할 | 규모 |
|---|---|---|
| `Code.js` | 시트 CRUD·날짜 정규화 | ~156 LOC |
| `Index.html` | UI + 배분 알고리즘 + 캘린더 DnD 전부 클라이언트 | ~740 LOC |
| `appsscript.json` | V8, Asia/Seoul | — |

### qa_distribution과의 관계

| | `qa_distribution` | `qa_scheduler` |
|---|---|---|
| 목적 | **누가** 평가받을지 · **누가** 평가할지 · CS 건 **배분** | **언제** 팀/채널별 평가를 진행할지 · **완료 여부** 추적 |
| 산출물 | 대상자 명단, GP 배분, 확정 이력 | 월별 평가 **일정 바**, 완료 체크리스트 |
| 연계 | 배분 확정 후 건수·팀·채널 정보를 스케줄러 STEP 1 입력에 **수동 반영** (현행 자동 연동 없음) |

---

## 2. 권한 모델 (현행)

GAS `appsscript.json`은 `access: MYSELF`. 별도 GroupsApp/이메일 ACL 없음.

QRadar 이식:

| 역할 | 권한 |
|---|---|
| `full` (성장문화팀) | STEP 1–2 배분안 생성·저장, 전체 일정·완료 상태 수정 |
| `roster` (팀 리더) | 해당 팀 항목의 `leaderDone`/`selfDone` (또는 읽기 전용 — 정책 확정 필요) |
| `viewer` | 읽기 + 개인일정 CRUD (본인 것만) |

`lib/adminEmails.ts`에 `SCHEDULE_FULL_EMAILS` 등 추가. `qa_distribution`과 동일 이메일 집합 재사용 가능.

---

## 3. 시트 인벤토리 → BigQuery 매핑

### 3.1 `평가데이터`

| 열 | 필드 | 타입 | 비고 |
|---|---|---|---|
| A | `id` | STRING | UUID |
| B | `year_month` | STRING | `yyyy-MM`, 앞 `'` prefix |
| C | `team` | STRING | 팀명 |
| D | `type` | STRING | `직무` \| `CS` |
| E | `channel` | STRING | 채널명 |
| F | `members` | INT64 | 인원 |
| G | `per_person_cnt` | INT64 | 1인당 건수 |
| H | `count` | INT64 | 배분 건수 (= members × per_person_cnt) |
| I | `round` | STRING | `1회차`, `2회차` … |
| J | `start_date` | DATE | 캘린더 시작 (nullable) |
| K | `end_date` | DATE | 캘린더 종료 (nullable) |
| L | `eval_done` | BOOL | 평가완료 |
| M | `leader_done` | BOOL | 리더검토 (eval_done 필요) |
| N | `self_done` | BOOL | 본인확정 (eval_done 필요) |
| O | `created_at` | TIMESTAMP | 등록일시 |

**BQ 제안**: `qradar_eval_schedule_items`

```sql
CREATE TABLE IF NOT EXISTS `…qradar_eval_schedule_items` (
  id STRING NOT NULL,
  eval_month STRING NOT NULL,       -- yyyy-MM
  team_name STRING NOT NULL,
  eval_type STRING NOT NULL,          -- 직무 | CS
  channel STRING NOT NULL,
  member_count INT64 NOT NULL,
  per_person_count INT64 NOT NULL,
  total_count INT64 NOT NULL,
  round_label STRING NOT NULL,        -- 1회차, 2회차
  start_date DATE,
  end_date DATE,
  eval_done BOOL DEFAULT FALSE,
  leader_done BOOL DEFAULT FALSE,
  self_done BOOL DEFAULT FALSE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
PARTITION BY DATE_TRUNC(PARSE_DATE('%Y-%m', eval_month), MONTH)
CLUSTER BY team_name, channel;
```

### 3.2 `개인일정`

| 열 | 필드 | BQ 제안 |
|---|---|---|
| A–G | id, year_month, title, start, end, color, created_at | `qradar_eval_personal_events` |

```sql
CREATE TABLE IF NOT EXISTS `…qradar_eval_personal_events` (
  id STRING NOT NULL,
  eval_month STRING NOT NULL,
  owner_email STRING NOT NULL,       -- QRadar: 세션 이메일
  title STRING NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  color STRING,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
PARTITION BY DATE_TRUNC(PARSE_DATE('%Y-%m', eval_month), MONTH)
CLUSTER BY owner_email;
```

개인일정은 GAS에선 전 사용자 공유. QRadar에서는 **owner_email**로 분리.

---

## 4. API (GAS → Next.js)

| GAS | HTTP (제안) | 비고 |
|---|---|---|
| `getAllData(ym)` | `GET /api/eval-ops/schedule?month=` | items + personal |
| `saveDistribution(ym, items)` | `PUT /api/eval-ops/schedule/distribution?month=` | 월 전체 replace |
| `updateItem(id, fields)` | `PATCH /api/eval-ops/schedule/items/:id` | start/end/flags |
| `savePersonalEvent(ym, evt)` | `PUT /api/eval-ops/schedule/personal/:id?` | upsert |
| `deletePersonalEvent(ym, id)` | `DELETE /api/eval-ops/schedule/personal/:id` | |

`fields` 허용 키: `start`, `end`, `evalDone`, `leaderDone`, `selfDone`.

완료 플래그 규칙 (UI와 동일):

- `leaderDone`, `selfDone`은 `evalDone === true`일 때만 활성
- 우선순위 표시: selfDone > leaderDone > evalDone > scheduled > unscheduled

---

## 5. UI 구조 (SEED 재구현)

### 5.1 레이아웃

```
[년월 선택] [불러오기]

STEP 1 — 입력 카드 (팀·구분·인원·1인당·회차·채널 chips)
STEP 2 — 배분안 테이블 + [자동 생성] [저장] [비우기]

[요약 stat 4칸: 총계 | 직무 | CS | 완료율]

┌ 투두리스트 (400px) ─┬── 캘린더 (flex) ─────────────┐
│ 드래그 → 캘린더      │ 7열 grid, lane 연속 바        │
│ 체크 3단            │ 평가 바 + 개인일정(점선)       │
└─────────────────────┴───────────────────────────────┘
```

### 5.2 클라이언트 로직 이식 대상 (`lib/evalOpsSchedule.ts`)

| 함수 | 역할 |
|---|---|
| `distributeEntries(entries)` | STEP 2: 회차×채널 슬롯 분할, 나머지 건수 앞 슬롯에 +1 |
| `assignLanes(items)` | 캘린더 lane 충돌 회피 (greedy) |
| `teamColor(team, teams)` | PALETTE 순환 |
| `completionState(item)` | CSS/뱃지 상태 derive |

DnD: HTML5 drag 또는 `@dnd-kit` — 캘린더 day drop, bar move, handle resize-start/end.

### 5.3 SEED 컴포넌트 매핑

| GAS | QRadar |
|---|---|
| card / stat | SEED `Card`, stat grid (`/eval-ops/assign` 패턴) |
| badge job/cs | `Badge` variant |
| modal 개인일정 | SEED `Dialog` |
| checkbox cascade | controlled + disabled when parent unchecked |
| calendar grid | custom grid (월 뷰). FullCalendar 불필요 — lane bar가 핵심 |

---

## 6. QRadar 라우트 · IA

**목표 위치**: QRadar > **평가 운영** > **평가 스케줄**

| 기존 | 구분 |
|---|---|
| `/admin/eval-schedule` | **AI 콜 평가 job** 보드 (`lib/evalSchedule.ts`, 인메모리). **본 GAS와 무관** |
| `/eval-ops/schedule` (신규) | **본 문서** — 월별 팀/채널 평가 일정 |

사이드바 [`components/Sidebar.tsx`](../../../components/Sidebar.tsx) 변경:

```ts
// 평가 운영 그룹
{ label: "평가 스케줄", href: "/eval-ops/schedule", ... },
{ label: "평가 배분", href: "/eval-ops/assign", children: [{ label: "확정 배분", href: "...?tab=assign&confirmed=1" }] },
{ label: "검수 현황", href: "/eval-ops/review-status", ... }, // CALL_QUALITY
```

`/admin/eval-schedule`은 「시스템」에 유지하되 라벨을 **「AI 평가 job」** 등으로 구분 ([qa-distribution.md](qa-distribution.md) §8 참고).

권한: `roster` 이상 조회. STEP 1–2·월 덮어쓰기는 `full`.

---

## 7. 마이그레이션 페이즈

| Phase | 작업 | 산출물 |
|---|---|---|
| **P0** | 문서·DDL | 본 문서, BQ 테이블 2종 |
| **P1** | Sheets → BQ 1회 적재 | `평가데이터`, `개인일정` import 스크립트 |
| **P2** | 읽기 API + 요약/투두/캘린더 **읽기 전용** UI | `/eval-ops/schedule` skeleton |
| **P3** | 일정 PATCH (start/end) + DnD | optimistic update |
| **P4** | 완료 체크 3단 + 개인일정 CRUD | owner scoped |
| **P5** | STEP 1–2 배분안 생성·저장 | `distributeEntries` + PUT distribution |
| **P6** | (선택) `qa_distribution` 확정 이력 → STEP 1 prefill | API 연동 |
| **P7** | GAS 리다이렉트·폐기 | 공지 |

---

## 8. 데이터 이식 메모

- GAS `saveDistribution`은 해당 월 **전 행 삭제 후 재삽입** — id가 매번 새 UUID. QRadar도 동일 semantics 또는 soft-delete + batch insert 중 선택.
- 날짜는 시트에 `'yyyy-MM-dd` 문자 prefix로 저장 → BQ `DATE`로 파싱.
- `updateItem`은 단일 셀 patch — QRadar는 `updated_at` + audit (선택).
- 개인일정 색상 기본 `#64748b`, 프리셋 9색 (HTML `COLOR_PRESETS`).

---

## 9. 테스트 체크리스트

- [ ] 월 필터: 다른 월 데이터 격리
- [ ] distribute: 1인당 7건, 2회차×3채널 → 6슬롯, remainder +1 앞쪽
- [ ] saveDistribution 후 id·일정·체크 초기화
- [ ] evalDone off → leader/self disabled + unchecked
- [ ] lane: 겹치는 기간 2바 이상 표시
- [ ] personal event: 본인만 CRUD
- [ ] `/admin/eval-schedule`과 라우트·용어 혼동 없음

---

## 10. 관련

- [ops-migration README](README.md)
- [qa-distribution](qa-distribution.md) — 배분·대상자
- [eval-ops 요약](../eval-ops/README.md)
- clasp: `cd qms_ref/Ref/qa_scheduler && npm run pull`

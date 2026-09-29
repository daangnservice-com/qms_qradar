# 서빙 DB

프로덕션은 이 리포(`qms_qradar`)를 돌리는 로컬 Next다. helpdesk-x EC2는 포크 이전 호스트다.

화면의 온디맨드 읽기·쓰기는 Postgres(`SERVING_DATABASE_URL`)를 친다. BigQuery는 데이터 쪽이 소유한 사실의 원천이거나, 웨어하우스로 나가는 덤프다. 요청 안에서 BQ에 같이 쓰지 않는다.

로컬은 Docker Compose의 Postgres 16, 호스트 포트 5433이다. 5432는 이 머신에서 이미 쓰인다. 나중에 RDS로 옮길 때는 같은 `db/migrations`를 적용하고 URL만 바꾼다. 로컬은 `sslmode=disable`, RDS는 `require`.

마이그레이션은 `node scripts/run-local-ts.cjs scripts/serving-migrate.ts`(`npm run serving:*`는 `tsx`가 있어야 돈다).

## 화면별 테이블

| 화면 | 테이블 |
|---|---|
| 콜 목록·필터, STT·평가 배치 후보 | `call_serving` |
| 콜 결과·전사·버전, 인앱 평가 결과, QA 결과 | `serving_eval_results` (`channel`로 전화·인앱 구분) |
| 검수 찜·저장·완료, 검수 현황 | `serving_review_claims`, `serving_human_reviews`, `serving_review_completions` |
| 콜 CSAT 패널 | `serving_csat_assignments` |
| 인앱 문의 목록·필터·본문, 답변 다듬기 샘플 | `feedback_serving` |
| 인앱 CSAT 패널 | `feedback_csat` (없으면 BQ rawlog 폴백) |
| 결과 탭(케이스·집계·옵션·리포트), 월간 리포트 | `qms_cases` |
| 평가 진행 현황 | `qms_eval_*` + 이름·팀은 `qms_cases` |
| 평가셋·항목 프롬프트·필드, 고위험 규칙, 장콜 스냅샷 | `qradar_llm_*`, `qradar_high_risk_flag_rules`, `qradar_long_call_thresholds` |
| 배분·명단·월 잠금·일정 | `qradar_dist_*`, `qradar_eval_*` |
| STT 이슈 신고, 슬랙 사용자 | `qradar_stt_issue_reports`, `qradar_slack_users` |
| 원본 평가 기준, QA 레퍼런스 | `qms_source_criteria`, `qms_qa_references` |
| LLM·STT 사용량, 사이트 사용량 | `serving_llm_call_logs`, `serving_stt_call_logs`, `serving_usage_events` |

`qradar_*` 테이블은 BQ 테이블과 이름·컬럼이 같다. BQ에서 옮겨 온 스토어는 `servingRows`(`@name` 파라미터, BQ와 같은 행 모양: timestamp는 ISO 문자열, date는 `YYYY-MM-DD`, int8은 number)로 읽는다.

요청 중에 BQ를 치는 곳은 이것뿐이다.

- 결과 단건: `qms_cases`에 없는 케이스(당일 평가분)만 Karrot 원천을 본다.
- 인앱 CSAT 상세: `feedback_csat`에 없을 때만 rawlog를 본다.
- 평가 진행 현황의 새로고침 버튼: Karrot 평가 원천을 바로 한 번 읽는다(1분에 한 번으로 묶음).
- 결과 JSON에 체크리스트나 프롬프트 설정이 없는 옛 결과를 열 때.

Genesys 녹취, Google STT, Gemini는 DB 밖이다.

## 동기화

`instrumentation.ts`가 `startServingSyncLoop`를 띄운다. 틱마다 두 모드 중 하나를 돈다.

| 모드 | 언제 | 하는 일 |
|---|---|---|
| fast | `SERVING_SYNC_INTERVAL_MS`(기본 15분)마다 | 최근 2일 생성 콜, 장콜·DSAT 메타, 최근 3일 안에 종결된 인앱 문의, 평가 진행 상태. CSAT(전화·인앱, 최근 3일)은 한 시간에 한 번 |
| nightly | 하루 1회, `SERVING_NIGHTLY_HOUR_KST`(기본 3시) 이후 첫 틱 | 콜·CSAT 전량, 메타, 최근 7일 종결 문의, 평가 진행 상태, 결과 뷰(`qms_cases`), 원본 기준, QA 레퍼런스, Postgres → BQ 덤프 |

야간 작업을 놓쳤으면(서버가 꺼져 있었으면) 다음 틱에 바로 돈다. 여러 프로세스가 같은 DB를 봐도 `pg_try_advisory_lock`으로 한 번에 하나만 돈다. 단계별 마지막 실행·에러는 `serving_sync_state`(`fast:pull-cases`, `nightly:export` …)에 남는다. 한 번 돌리기: `scripts/serving-sync.ts [--nightly]`.

BQ 쪽 원천 뷰 중 비싼 것:

- 결과 뷰(`vw_quality_evaluation_cases_detail_with_fallback`)는 한 번에 약 2GB를 읽어서 야간에만 통째로 가져온다.
- CSAT rawlog 뷰는 날짜로 잘라도 파티션이 안 걸려 매번 약 600MB를 읽는다. 전화·인앱을 한 쿼리로 가져오고, 증분도 한 시간에 한 번이다.

upsert는 1000행씩 묶고, 값이 같은 행은 다시 쓰지 않는다.

| 방향 | 지금 |
|---|---|
| BQ → Postgres | 콜 원천, CSAT(전화·인앱), 장콜·DSAT 메타, 종결 인앱 문의(없는 `thread_id`만), 결과 뷰, Karrot 평가 진행 상태, 원본 기준, QA 레퍼런스 |
| Postgres → BQ (`ds_qradar_dev`) | 평가 결과(전화·인앱), 수기 검수, 검수 완료, 찜 이력, CSAT 배정, 평가셋 연결, LLM·STT 호출 로그, 사용 이벤트, `qradar_*` 설정·운영 테이블 |

덤프는 행을 JSON 문자열 배열 하나로 보낸다. 컬럼별 배열 파라미터는 NULL 원소를 받지 않기 때문이다. 평가 결과와 호출 로그는 BQ에 같은 키가 있으면 건너뛰어 재시도해도 중복되지 않는다. 덤프했다고 표시할 때는 덤프한 값과 지금 값이 같은 행만 표시해서, 그 사이 바뀐 행은 다음 덤프로 넘어간다. 연결을 전부 지운 평가셋처럼 행이 사라지는 변경은 `serving_export_dirty`로 알린다.

`qradar_*` 설정·운영 테이블은 트리거가 바뀐 테이블을 `serving_mirror_state`에 표시하고, 덤프가 그 테이블만 BQ에서 한 트랜잭션으로 통째로 갈아 끼운다(`lib/servingMirror.ts`). 서빙 전용 `_row_id`는 덤프하지 않는다.

보정: `node scripts/run-local-ts.cjs scripts/serving-repair.ts`는 BQ 평가 결과의 과거 버전, 늦게 종결된 인앱 문의, 호출 로그·사용 이벤트, 비어 있는 `qradar_*` 테이블을 BQ에서 채운다. 여러 번 돌려도 같다.

## 인앱 문의와 CSAT

종결 스레드 본문(`status = 10`)은 다시 안 바뀐다. `feedback_serving`은 그래서 `thread_id`가 있으면 본문을 덮어쓰지 않는다. 증분 pull은 문의 시작일이 아니라 종결(마지막 이벤트) 시각으로 자른다. 시작 후 사흘 넘게 걸려 끝나는 문의가 약 30%다.

CSAT은 문의가 완결된 뒤에도 도착한다. 인앱 CSAT 원본은 `feedback_csat`에 따로 두고, pull이 `feedback_serving`의 `csat_id`·점수·코멘트만 갱신한다. 전화 CSAT은 `serving_csat_assignments`에 있고, 점수나 통화 연결이 바뀔 때만 다시 덤프한다.

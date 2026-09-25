# 평가 아이템 키 통일 (dev 컷오버)

실행 시각: **2026-09-21 19:00 KST** (운영 종료 후).  
대상: `data-proj-470202.ds_qradar_dev` only. prod 금지.

이 문서는 19시에 그대로 따라가는 런북이다. 설계 배경은 대화에서 합의한 “실행 1테이블 + 수기 이벤트 3테이블 + 키 `(channel, source_system, source_id)`”.

## 무엇을 바꾸나


| 전                                                              | 후                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 전화 결과 `qradar_evaluation_results` (`conversation_id` REQUIRED) | 같은 이름, 채널 공통 스키마. 키 = `channel + source_system + source_id`                |
| 인앱 결과 `qradar_evaluation_item_results`                         | 위 테이블로 합친 뒤 `_legacy_20260921` 로 치움                                        |
| reviews / completions / claims 가 `conversation_id` only        | 같은 아이템 키. reviews 는 `payload_json` 을 컬럼으로 전개 (`payload_json` 은 백업 컬럼으로 남김) |
| 결과 행의 `review_completed_*`, `human_result`, `match`, 점수 플랫 컬럼  | 삭제. 완료는 completions, 수기 라벨은 조회 시 reviews 로 파생                              |


전화 매핑:

- `channel=phone`, `source_system=genesys`, `source_id=<conversation_id>`

인앱 매핑:

- 기존 `FEEDBACK_SOURCE_SYSTEM` 값 유지 (`karrotmarket.team_operation.feedback_thread_aggregation`). 이미 저장된 item_results 키를 깨지 않는다.
- `purpose=text_eval` → `call_eval` (운영 평가). `qa_eval` 은 Train 그대로.

`call_eval`/`qa_eval` 이름을 `ops`/`train` 으로 바꾸는 일은 **이번 컷오버에 넣지 않는다.** 결과 테이블 재생성과 섞으면 실패 면이 커진다.

## 19:00 전 준비 (지금 상태)

이미 레포에 있음.


| 경로                                       | 역할                             |
| ---------------------------------------- | ------------------------------ |
| `scripts/migrate-eval-item-key.ts`       | 백업 → v2 생성 → 백필 → 검증 → 스왑 / 롤백 |
| `scripts/bq/eval_item_key_v2_schema.sql` | 스키마 리뷰용 DDL (실행은 TS)           |
| `scripts/bq/eval_item_key_v2_views.sql`  | 스왑 후 분석 뷰                      |
| `lib/evalSchemaV2.ts`                    | 앱 ensure() 와 마이그레이션이 공유하는 스키마  |
| `lib/evalItemKey.ts`                     | 키 헬퍼 + 라이브 테이블 스키마 자동 감지       |


앱은 결과 테이블에 `source_id` 가 있고 `conversation_id` 가 없으면 v2 로 읽기/쓰기한다. **스왑 전에는 자동으로 v1.** 낮에 서버를 재시작해도 현재 BQ 스키마와 맞다.

컷오버 직후는 **Next 프로세스를 재시작**해야 감지 캐시가 v2 로 바뀐다.

## 컷오버 순서 (19:00)

예상 창: 백필 크기에 따라 15–40분. 스왑 자체는 초 단위.

### 0. 쓰기 중단

1. 평가 배치 STT/eval-batch 화면에서 실행 중인 job 이 있으면 끝날 때까지 기다리거나 취소.
2. Next 개발 서버를 끈다 (`npm run dev` / `next start`). 스왑 중 스트리밍 insert 가 레거시 테이블로 들어가면 유실된다.
3. 다른 탭에서 검수 저장하지 말 것.



### 1. Dry-run (수 분, 쓰기 없음)

```bash
npx tsx scripts/migrate-eval-item-key.ts --target=dev
```

현재 row count 가 찍힌다. 이상한 숫자면 중단.

### 2. Apply (백업 + v2 적재, 라이브 이름 유지)

```bash
npx tsx scripts/migrate-eval-item-key.ts --target=dev --apply
```

하는 일:

1. `*_bak_20260921` 스냅샷 (만료 없음)
2. `*_v2` 테이블 CREATE (파티션 + 클러스터)
3. 전화 결과 · 인앱 결과 · reviews · completions · claims 백필
4. 결과 테이블의 레거시 `review_completed_at` 이 있는 콜은 completions 에 한 줄 추가 (이미 completion 이벤트가 있으면 skip)
5. 인앱 checklist 를 `qradar_evaluation_criterion_results` 에 보강 (analysis_id 가 없을 때만)

실패하면 라이브 테이블은 그대로다. `--rebuild-v2` 로 v2 만 지우고 다시 apply 가능.

### 3. Verify (별도 재실행 가능)

`--apply` 가 이미 verify 를 돌린다. 한 번 더 보려면:

```bash
npx tsx scripts/migrate-eval-item-key.ts --target=dev --verify
```

필수 통과:

- 전화 결과 행 수 = 백업 (빈 conversation_id 제외)
- 인앱 결과 행 수 = item_results 백업
- `analysis_id` 중복 0
- `source_id` 비어 있지 않음
- purpose 가 `call_eval` / `qa_eval` 만
- v2 결과에 `conversation_id` / `review_completed_at` 없음
- reviews / claims 행 수 일치
- completions 는 레거시 완료 합류로 **원본 이상**
- 전화 `ai_label` 불일치 0

하나라도 FAIL 이면 **스왑하지 않는다.**

### 4. Swap (라이브 이름 교체)

```bash
npx tsx scripts/migrate-eval-item-key.ts --target=dev --swap
```

- 현재 라이브 → `*_legacy_20260921`
- `*_v2` → 원래 이름
- `qradar_evaluation_item_results` → `..._legacy_20260921`
- 분석 뷰 3개 CREATE OR REPLACE



### 5. 앱 재시작 + 스모크

```bash
npm run dev
```

확인할 것:

1. `/call-quality` 목록에 “분석 완료” 가 스왑 전과 같이 보이는지
2. 이미 검수 완료한 콜 하나를 열어 수기 주석이 살아 있는지
3. 검수 완료 배지가 보이는지 (`eval_review_completions`)
4. 인앱 문의 평가 화면에서 기존 결과가 보이는지
5. 전화 1건 · 인앱 1건을 새로 평가해 저장되는지

자동 감지 실패 시에만 `.env.local` 에 `EVAL_ITEM_KEY_V2=1` 을 넣고 재시작. 평소엔 넣지 않는다.

## 롤백

스왑 후 앱이 깨지면 서버를 끄고:

```bash
npx tsx scripts/migrate-eval-item-key.ts --target=dev --rollback
```

라이브를 `*_v2_failed_20260921` 로 치우고 `*_legacy_*` 를 원래 이름으로 되돌린다. 뷰는 DROP. 앱 재시작 (v1 감지).

백업 `*_bak_20260921` 은 건드리지 않는다. 롤백 후에도 남아 있어야 한다.

## 스왑 후 테이블 지도

라이브:

- `qradar_evaluation_results`
- `qradar_eval_human_reviews`
- `qradar_eval_review_completions`
- `qradar_eval_review_claims`

분석 뷰:

- `vw_qradar_eval_latest_run` — 아이템+purpose 최신 AI
- `vw_qradar_eval_latest_annotations` — annotation 최신 비삭제
- `vw_qradar_eval_item_status` — 최신 AI ⊕ 완료 ⊕ 찜

보존 (수동 drop 은 D+14 이후):

- `*_bak_20260921` 스냅샷
- `*_legacy_20260921` 스왑 직전 라이브



## 결과 테이블 컬럼 (v2)

공통만 남긴다.

```
analysis_id, analyzed_at
channel, source_system, source_id
org, purpose
analyzed_by, model, prompt_version_id, prompt_version
ai_label
turns_json, input_snapshot_json, channel_attrs_json
result_json, llm_call_id, error
```

뺀 것: `conversation_id`, `review_completed_*`, `human_result`, `match`, `checklist_json`, `transcript_json`, 점수/무음 플랫 컬럼, `audio_*`.

전화 전용 값은 `channel_attrs_json` (`durationSec`, `silence*`, `sttSource`, `highRiskFlags`, `phoneInquiryId` …).

`turns_json` 은 이번엔 정규화하지 않는다. 전화는 기존 `transcript_json`, 인앱은 `conversation_json` 우선.

## 앱 동작

- 전화 API 는 계속 `conversationId` 를 받는다. 스토어가 `phoneItemRef()` 로 바꾼다.
- 인앱 `saveEvaluationItemResult` 는 v2 에서 통합 결과 테이블에 쓴다.
- 수기 overlay 로직은 그대로다. 결과 행을 복사하지 않는다.



## 하지 않는 것 (의도적)

- prod
- purpose 를 `ops`/`train` 으로 개명

- `FEEDBACK_SOURCE_SYSTEM` 단축
- 아이템 마스터 테이블
- reviews 를 결과 테이블에 합치기
- `payload_json` 즉시 DROP (백필 검증용으로 유지, 후속)



## 컷오버 후 후속

1. D+1 스모크가 괜찮으면 레거시/백업 테이블 목록만 문서화하고, D+14 에 DROP
2. reviews `payload_json` DROP
3. 전화 transcript 를 `EvaluationTurn[]` 로 정규화
4. purpose 개명 (`call_eval`→`ops`) 은 별도 PR
5. 인앱 수기 검수 UI 를 같은 키로 연결 (이번 스키마가 그 전제)


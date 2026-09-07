# 인앱 문의(feedback) 채널 평가 계획

## 1. 100건 샘플 분석 결과

원천 뷰: `karrotmarket.team_operation.vw_feedback_thread_aggregation`

- 행 의미: `feedback_thread_id` 1개에 문의와 상담사 답변을 집계한 스레드 1건
- 원문: `contents_concat` 안에 `[FEEDBACK]` / `[REPLY]` 블록이 시간순으로 저장됨
- 샘플 기간: 2025-02-23 ~ 2026-08-24
- 답변 포함: 92/100건
- 문의 개수: 1건 59%, 2건 25%, 3건 이상 16%
- HTML 답변: 6/100건
- CSAT 데이터 포함: 14/100건
- 본문 길이: 평균 약 1,587자, 최대 9,161자
- 주요 팀: 중고거래팀 35건, 분쟁조정팀 32건, 페이팀 10건

따라서 인앱 문의는 전화의 `conversation_id`나 STT를 재활용하지 않고, 스레드와 발화를 먼저 정규화해야 한다. 답변 HTML은 평가 입력과 화면 표시에서 평문으로 변환하되, 원본 HTML을 결과에 저장하지 않는다.

## 2. 식별자와 저장 원칙

채널별 원천 ID가 충돌할 수 있으므로 평가 대상의 식별자는 다음 세 값의 조합으로 고정한다.

```text
channel + source_system + source_id
```

- `phone`: Genesys conversation ID
- `feedback`: `feedback_thread_id`
- `chatcs`: 채팅 상담 스레드 ID

전화 레거시 결과 테이블은 그대로 읽고, 새 채널은 `qradar_evaluation_item_results`에 저장한다. 이 테이블은 `conversation_id`를 필수로 요구하지 않아 텍스트 채널을 synthetic conversation ID로 우회하지 않는다.

## 3. 현재 구현된 백엔드 1차 범위

- `lib/feedbackSamples.ts`
  - 원천 뷰의 명시적 컬럼만 조회
  - `[FEEDBACK]` / `[REPLY]` 파싱
  - HTML 제거, KST 시각과 발화 간 상대 시간 정규화
  - 10분 프로세스 캐시와 최대 500건 제한
- `POST /api/evaluations/feedback/samples`
  - 전화 샘플 API와 분리
  - 평가 결과의 analyzed/AI label을 채널·원천·ID 조합으로 조회
- `POST /api/evaluate/feedback`
  - 클라이언트가 제출한 원문을 신뢰하지 않고 서버에서 원천 스레드를 재조회
  - 오디오/STT 없이 텍스트 전용 Gemini 평가
- `lib/evaluationItemResultStore.ts`
  - 텍스트 채널용 결과 저장·최신 결과 조회
- 텍스트 프롬프트
  - `feedback_eval`, `chatcs_eval` 템플릿 키 추가
  - 공통 점수/체크리스트 구조를 재사용하되 오디오 변수와 `agentSpeakerTag`는 제외

## 4. 다음 백엔드 작업 순서

### A. 평가셋 연결

1. feedback 전용 평가 항목 세트를 정의한다.
2. `feedback_eval` production prompt를 QMS 프롬프트 관리 화면에서 생성한다.
3. 전화와 공통으로 쓸 항목은 공통 criterion ID/프롬프트 바인딩으로 재사용하고, 채널 특화 항목은 별도 criterion으로 둔다.
4. chatcs 원천 뷰의 실제 스키마를 같은 `EvaluationTurn`으로 정규화한다.

### B. 수기 검수 상태

기존 수기 리뷰/찜/완료 테이블은 `conversation_id`만 키로 사용한다. 새 채널에서는 다음 테이블에도 `channel`, `source_system`, `source_id`를 포함하는 별도 저장 모델이 필요하다.

- human annotations
- review claims
- review completions
- mine/review-status 조회

이 작업이 끝나야 중앙 원문·우측 AI 평가·수기 검수를 전화와 동일한 흐름으로 연결할 수 있다.

### C. 무거운 원천 뷰 운영 전환

현재 샘플 분석 때문에 원천 뷰를 한 번 조회했다. 운영 목록 조회는 원천 뷰를 매번 직접 읽지 않고, `qradar_evaluation_feedback_items` 스냅샷 테이블을 주기적으로 적재한 뒤 그 테이블을 읽도록 전환한다.

- 초기 수집: 최근 N일 + 변경 스레드 upsert
- 보존: 평가 당시 원문 스냅샷은 결과 행에 마스킹된 형태로 보존
- 재평가: 원천 변경과 무관하게 당시 평가 입력을 재현

### D. 정확도/대시보드 분리

정확도 집계, 결과 현황, 고위험 플래그, 검수 큐의 모든 집계 키에 `channel`을 추가한다. 전화 전용 지표인 통화시간·무음·말 겹침은 feedback/chatcs 집계에서 제외하고, 텍스트 채널에서는 응답시간·미응답·재문의·CSAT 같은 지표를 별도 정의한다.

## 5. UI 구현 순서

기존 3열 구조는 유지한다.

1. 좌측: 채널별 탐색기와 필터
2. 중앙: `EvaluationTurn[]` 기반 문의/답변 타임라인
3. 우측: 공통 AI 결과 + 채널별 수기 검수

feedback에서는 오디오 플레이어, waveform, silence timeline을 렌더링하지 않는다. 발화 시각은 표시하되, 시각이 없는 chatcs 데이터도 `atSec=0`으로 위조하지 않고 null로 유지한다.

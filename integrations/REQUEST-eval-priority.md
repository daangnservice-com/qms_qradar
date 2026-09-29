# 평가 진행 온디맨드 STT — 서버 요청

qradar 평가 진행에서 넣은 잡은 `POST /v1/jobs` 의 `priority=100` 으로 보냅니다.
배치 스케줄 잡은 기존처럼 `priority=0` 입니다.

문서상 `priority` 가 클수록 큐에서 먼저 뽑히고, **실행 중인 잡은 끊지 않습니다.**
이 동작은 그대로 쓰면 됩니다. 아래는 그 위에 필요한 한 가지입니다.

## 이미 되는 것

- 큐에 쌓인 일반 잡보다 `priority=100` 이 먼저 선택됨
- 지금 `running` 인 잡은 끝까지 가고, 그다음 최우선 잡을 시작함

## 필요한 것: 재처리 force (client_ref 디둡 우회)

`POST /v1/jobs` 계약에는 `file` / `options` / `callback_url` / `client_ref` / `priority` 만 있고,
**force rerun / replace / skip_dedup 필드는 없습니다.** `options`에 없는 키를 넣으면 422입니다.

평가 진행의 「STT 재처리 → 로컬 배치」는 같은 콜을 다시 전사해야 합니다.
서버가 `client_ref`(conversation id)로 기존 `done`/`queued` 잡을 그대로 돌려주면 재처리가 안 됩니다.

호출 쪽 임시 우회: 재처리일 때만 `client_ref`를 `{conversationId}::rerun::{jobId}` 로 보냅니다.
목록을 conversation id로 묶거나, 같은 ref로 콜백을 맞추려면 아래가 필요합니다.

`POST /v1/jobs` 폼 필드 **`force=true`** (또는 `replace=true`):

- 같은 `client_ref`가 이미 `done`/`queued`/`running`이어도 **새 잡 id**를 만든다
- `client_ref`는 conversation id 그대로 둔다
- 지금 도는 잡은 끊지 않는다. 큐에만 새로 넣는다
- 오디오 해시 디둡이 있으면 그것도 건너뛴다

기본(`force` 생략/false)은 지금처럼 디둡해도 됩니다. 밤 배치는 force를 안 보냅니다.

---

## 필요한 것: 게이트 우회는 잡 단위로

지금 워커는 오프피크 창·GPU 유휴일 때만 큐를 소진합니다.
`priority` 와 무관하게 창이 닫혀 있으면 최우선 잡도 `queued` 로 남습니다.

평가 진행에서 넣는 잡은 **지금 돌아가는 전사 다음**에 시작되기를 기대합니다.
업무 시간에 전 큐를 열어 버리는 `POST /v1/control { override_minutes }` 는 쓰지 않습니다.
배치 대기열이 같이 소진되기 때문입니다.

다음 중 하나만 있으면 됩니다.

1. **`priority >= 100` 인 잡은 게이트를 무시**하고, 현재 `running` 이 끝나는 즉시 시작
2. 또는 `POST /v1/jobs` 에 **`urgent=true`** (또는 동등한 폼 필드). 그 잡만 창·GPU 체크를 건너뜀. 모르는 필드는 지금처럼 422가 아니라 무시해도 됩니다.

## 있으면 좋은 것 (선택)

- `PATCH /v1/jobs/{id}` 로 대기 중 잡의 `priority` 만 올리기 — 오디오를 다시 올리지 않고 앞으로 당길 수 있음
- `GET /v1/jobs?client_ref=` 는 이미 클라이언트가 쓰고 있음. 문서에 쿼리로 적어 두면 좋음

## 클라이언트가 보내는 값

| 필드 | 평가 진행 온디맨드 | 밤 배치 |
|---|---|---|
| `priority` | `100` | `0` |
| `client_ref` | conversation id. 재처리만 `{id}::rerun::{jobId}` (서버 force가 생기면 conversation id로 되돌림) | conversation id |
| `callback_url` | 기존과 동일 | 기존과 동일 |

계약의 나머지(`options` 키, 상태 머신, 콜백 본문)는 바꾸지 않습니다.

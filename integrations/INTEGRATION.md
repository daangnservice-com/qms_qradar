# STT 배치 서버 연동 가이드

> **이 문서를 읽는 에이전트에게**: 당신은 이 STT 서버를 *호출하는* 쪽 코드베이스에서 일하고 있습니다.
> 서버는 이미 떠 있고 수정 대상이 아닙니다. 이 문서에 적힌 계약(contract)만 보고 클라이언트를 붙이세요.
> 여기 없는 엔드포인트나 필드를 추측해서 쓰지 마세요.

로컬 GPU에서 멀티채널 오디오를 전사해 주는 잡 큐 서버입니다. Gemini STT 같은 종량제 API를
대체하려고 만든 것이라, **PC가 노는 시간(평일 밤·주말)에만 큐를 소진합니다.**

| 항목 | 값 |
|---|---|
| Base URL | `http://172.17.15.85:8760` (같은 PC라면 `http://127.0.0.1:8760`) |
| 인증 | 기본 없음. 서버에 `STT_API_KEY`가 설정돼 있으면 `X-API-Key: <key>` 헤더 필요 |
| OpenAPI | `GET /docs` |
| 모델 | faster-whisper large-v3, 한국어 기본 |

---

## 1. 가장 먼저 이해할 것: 이건 동기 API가 아닙니다

업로드하면 **`job_id`만 즉시** 돌아옵니다. 전사는 나중에 끝납니다.
그리고 오프피크 창 밖이면 잡은 **몇 시간이고 `queued` 상태로 대기합니다.** 이건 버그가 아니라 설계입니다.

```
POST /v1/jobs              →  202 { "id": "...", "status": "queued" }
        ↓  (오프피크 창이 열리고 GPU가 놀 때까지 대기)
GET  /v1/jobs/{id}         →  queued → running → done
        ↓
GET  /v1/jobs/{id}/result  →  전사 JSON
```

**따라서 요청-응답 사이클 안에서 전사를 기다리는 코드를 쓰면 안 됩니다.**
HTTP 핸들러 안에서 전사를 호출해 그 응답을 만들려는 설계는 반드시 타임아웃 납니다.
`job_id`를 본인 DB에 저장하고, 콜백이나 주기적 폴링으로 나중에 회수하세요.

### 상태 머신

| status | 뜻 | 다음 |
|---|---|---|
| `queued` | 큐에 있음. 오프피크 창·GPU 유휴를 기다리는 중일 수 있음 | `running`, `canceled` |
| `running` | 처리 중. `progress`(0.0~1.0)와 `stage`가 갱신됨 | `done`, `failed`, `queued`(재시도/서버 재시작) |
| `done` | 완료. 결과 조회 가능 | (종료) |
| `failed` | 재시도까지 소진하고 실패. `error`에 사유 | (종료) |
| `canceled` | 취소됨 | (종료) |

종료 상태는 `done` / `failed` / `canceled` 셋뿐입니다. 폴링 루프의 종료 조건으로 이 셋을 쓰세요.

> `running`이던 잡이 `queued`로 되돌아갈 수 있습니다(서버 재시작, 자동 재시도). 폴링 로직이
> "한 번 running이면 다시 queued가 될 리 없다"고 가정하면 안 됩니다.

---

## 2. 엔드포인트

### `POST /v1/jobs` — 제출

**`multipart/form-data`입니다. JSON 본문이 아닙니다.**

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `file` | 파일 | 필수 | 오디오. 멀티채널 그대로 올리면 됩니다. 최대 4096 MB |
| `options` | 문자열 | | **JSON을 문자열로 직렬화해서** 넣는 폼 필드. 아래 표 참조 |
| `callback_url` | 문자열 | | 완료·실패·취소 시 POST 받을 주소 |
| `client_ref` | 문자열 | | 본인 쪽 ID. 상태·콜백·결과에 그대로 실려 돌아옴 |
| `priority` | 정수 | | 클수록 먼저. 기본 0 |

`options`에 넣을 수 있는 키는 **아래가 전부**입니다. 모르는 키를 넣으면 422로 거절됩니다.

| 키 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `language` | 문자열 \| null | `"ko"` | `null`/생략 시 채널마다 자동 판별. 한국어만 다루면 `"ko"` 고정 권장(짧은 발화 오판 방지) |
| `channel_names` | 문자열 배열 | 서버 설정 | **위치 기준** 라벨. `["agent","customer"]` → ch0=agent, ch1=customer |
| `beam_size` | 정수 1~10 | 5 | |
| `vad_filter` | 불린 | true | 무음 구간 제거 |
| `word_timestamps` | 불린 | false | 단어 단위 타임스탬프. 결과가 커짐 |
| `condition_on_previous_text` | 불린 | false | |
| `initial_prompt` | 문자열 | | 도메인 용어 힌트. 예: `"상담원과 고객의 통화 녹취입니다."` |
| `temperature` | 실수 0.0~1.0 | 0.0 | |

**응답 `202`** — 아래 "잡 객체" 형식.

```bash
curl -X POST http://172.17.15.85:8760/v1/jobs -F "file=@call.wav" -F 'options={"language":"ko","channel_names":["agent","customer"]}' -F "callback_url=http://myserver:9000/stt-done" -F "client_ref=ticket-42"
```

### `GET /v1/jobs/{id}` — 상태 조회

"잡 객체"를 돌려줍니다.

```json
{
  "id": "d4eee3b201e74b2e8624abc8c0862fdc",
  "status": "running",
  "priority": 0,
  "filename": "call.wav",
  "client_ref": "ticket-42",
  "channels": 2,
  "duration_sec": 14.572,
  "progress": 0.5,
  "stage": "transcribing customer (2/2)",
  "error": null,
  "attempts": 1,
  "rtf": null,
  "created_at": "2026-08-31T03:24:01+00:00",
  "started_at": "2026-08-31T13:00:02+00:00",
  "finished_at": null,
  "result_url": null
}
```

- 시각은 전부 **UTC ISO 8601**입니다.
- `progress`는 0.0~1.0 실수, `stage`는 사람이 읽는 문자열입니다(파싱하지 마세요).
- `channels`·`duration_sec`은 디코딩 전까지 `null`입니다.
- `rtf`는 완료 후 채워지는 실시간 대비 처리 계수(작을수록 빠름).
- **`result_url`은 절대 URL이 아니라 경로(`/v1/jobs/{id}/result`)입니다.** Base URL과 이어 붙여 쓰세요.

### `GET /v1/jobs/{id}/result` — 전사 결과

`status`가 `done`일 때만 200입니다. 아직이면 **409**입니다(404 아님).

```json
{
  "job_id": "d4eee3b2...",
  "filename": "call.wav",
  "client_ref": "ticket-42",
  "language": "ko",
  "audio": {
    "channels_total": 2,
    "channels_transcribed": 2,
    "duration_sec": 14.572,
    "source_sample_rate": 22050,
    "codec": "pcm_s16le",
    "container": "wav"
  },
  "processing_sec": 3.9,
  "channels": [
    {
      "index": 0,
      "name": "agent",
      "language": "ko",
      "language_probability": 0.9912,
      "segments": [
        { "start": 0.0, "end": 5.62, "text": "안녕하세요 고객님...",
          "avg_logprob": -0.21, "no_speech_prob": 0.004 }
      ]
    },
    { "index": 1, "name": "customer", "segments": [] }
  ],
  "segments": [
    { "channel": 0, "speaker": "agent",    "start": 0.0,  "end": 5.62, "text": "안녕하세요 고객님..." },
    { "channel": 1, "speaker": "customer", "start": 7.02, "end": 13.9, "text": "네 안녕하세요..." }
  ],
  "text": "[00:00:00] agent: 안녕하세요 고객님...\n[00:00:07] customer: 네 안녕하세요..."
}
```

셋 중 필요한 걸 쓰세요.

- **`text`** — 화자·타임스탬프가 붙은 완성된 대화록 문자열. 대부분 이거면 충분합니다.
- **`segments`** — 모든 채널을 시작 시각순으로 병합한 평면 배열. 화자별 분석·검색 인덱싱에 씁니다.
- **`channels`** — 채널별 원본. 채널 하나만 따로 처리할 때.

무음 채널은 STT를 돌리지 않고 `{"index":1,"name":"customer","skipped":"silent","segments":[]}`
형태로 들어옵니다. **`segments` 키는 항상 존재하되 빈 배열일 수 있습니다.**

### `DELETE /v1/jobs/{id}` — 취소

```json
{ "job_id": "...", "status": "canceled" }
```

`queued`면 즉시 `canceled`, `running`이면 `canceling`을 돌려주고 다음 세그먼트 경계에서 멈춥니다.
이미 끝난 잡이면 현재 상태를 그대로 돌려줍니다(에러 아님).

### `GET /v1/jobs` — 목록

쿼리: `status`(`queued|running|done|failed|canceled`), `limit`(1~500, 기본 50), `offset`.

```json
{ "total_by_status": { "queued": 3, "done": 12 }, "jobs": [] }
```

### `GET /v1/health` — 서버·게이트 상태

**제출 전에 이걸 찍어보면 "왜 안 돌아가는지"가 바로 나옵니다.**

```json
{
  "status": "ok",
  "gate": {
    "accepting_work": false,
    "reason": "outside off-peak window; next opens 2026-08-31 22:00",
    "windows": ["Mon-Fri 22:00-08:00", "Sat 00:00-24:00", "Sun 00:00-24:00"],
    "window_open": false,
    "next_window_at": "2026-08-31T22:00:00",
    "override_until": null,
    "paused": false
  },
  "gpu": { "utilization_pct": 5, "memory_free_mb": 11897, "memory_total_mb": 16311 },
  "model": { "model_size": "large-v3", "loaded": false, "device": "cuda" },
  "queue": { "queued": 3 },
  "current_job": null
}
```

`gate.accepting_work`가 `false`면 `gate.reason`이 이유를 문장으로 알려줍니다.
사용자에게 "왜 안 끝났냐"를 설명해야 할 때 이 문자열을 그대로 보여주세요.

### `POST /v1/control` — 스케줄 무시 / 일시정지

`application/json` 본문입니다.

```json
{ "override_minutes": 60 }
```

- `override_minutes: 60` — 앞으로 60분간 시간창·GPU 체크를 무시하고 즉시 처리. **테스트할 때 이걸 씁니다.**
- `override_minutes: 0` — 무시 해제, 원래 스케줄 복귀.
- `pause: true` / `false` — 워커 정지/재개.

응답은 위 `gate` 객체와 같은 형식입니다.

---

## 3. HTTP 상태 코드

| 코드 | 언제 | 대응 |
|---|---|---|
| `202` | 제출 성공 | `id`를 저장 |
| `401` | API 키 누락/불일치 | 헤더 확인. 재시도해도 소용없음 |
| `404` | 없는 `job_id` | 재시도 금지 |
| `409` | 결과를 요청했는데 아직 `done`이 아님 | 정상. 계속 폴링 |
| `410` | 결과 파일이 삭제됨 | 재제출 필요 |
| `413` | 업로드가 4096 MB 초과 | 분할하거나 압축 |
| `422` | `options` JSON이 깨졌거나 모르는 키, 빈 파일 | 요청을 고쳐야 함. 재시도 금지 |

`401`/`404`/`422`는 재시도해도 똑같이 실패합니다. 네트워크 오류와 `5xx`만 재시도하세요.

---

## 4. 붙이는 방법

### 권장: 콜백 (fire-and-forget)

밤 배치라 완료까지 몇 시간 걸릴 수 있으니, 프로세스를 붙잡고 기다리지 말고 콜백을 받으세요.

```python
job_id = stt.submit("call.wav",
                    channel_names=["agent", "customer"],
                    callback_url="http://myserver:9000/stt-done",
                    client_ref="ticket-42")
db.save(ticket_id=42, stt_job_id=job_id, stt_status="queued")
```

완료·실패·취소 시 `callback_url`로 아래가 POST 됩니다. 실패하면 최대 3회 재시도합니다.

```json
{
  "job_id": "d4eee3b2...",
  "status": "done",
  "client_ref": "ticket-42",
  "filename": "call.wav",
  "error": null,
  "result_url": "/v1/jobs/d4eee3b2.../result"
}
```

**콜백 본문에 전사 결과는 없습니다.** 받은 뒤 결과를 따로 가져와야 합니다.

```python
@app.post("/stt-done")
def stt_done(payload: dict):
    if payload["status"] == "done":
        result = stt.result(payload["job_id"])
        db.save_transcript(payload["client_ref"], result["text"])
    else:
        db.mark_failed(payload["client_ref"], payload.get("error"))
    return {"ok": True}          # 2xx를 돌려줘야 재시도가 멈춥니다
```

콜백 수신부는 **멱등**해야 합니다. 재시도 때문에 같은 `job_id`가 두 번 올 수 있습니다.

### 대안: 폴링

콜백 엔드포인트를 열 수 없으면, 별도 워커에서 미완료 잡을 주기적으로 훑으세요.
**폴링 간격은 30초 이상**으로 두세요. 밤새 기다리는 잡을 1초마다 찌를 이유가 없습니다.

```python
for job_id in db.pending_stt_jobs():
    job = stt.status(job_id)
    if job["status"] == "done":
        db.save_transcript(job["client_ref"], stt.result(job_id)["text"])
    elif job["status"] in ("failed", "canceled"):
        db.mark_failed(job["client_ref"], job.get("error"))
```

### 클라이언트 코드

`httpx` 하나만 필요합니다. `stt_client.py`로 저장해 쓰세요.

```python
"""stt_client.py — STT 배치 서버 클라이언트."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx

TERMINAL = {"done", "failed", "canceled"}


class SttJobError(RuntimeError):
    """잡이 failed/canceled 로 끝났을 때."""


class SttClient:
    def __init__(self, base_url: str, api_key: str = "", timeout: float = 600.0):
        headers = {"x-api-key": api_key} if api_key else {}
        # 업로드는 파일 크기에 비례해 오래 걸리므로 넉넉히.
        self._http = httpx.Client(base_url=base_url.rstrip("/"), headers=headers,
                                  timeout=timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "SttClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def submit(self, audio_path: str | Path, *, language: str | None = "ko",
               channel_names: list[str] | None = None, word_timestamps: bool = False,
               initial_prompt: str | None = None, callback_url: str = "",
               client_ref: str = "", priority: int = 0) -> str:
        """오디오를 큐에 넣고 job_id 를 돌려준다. 전사를 기다리지 않고 바로 반환된다."""
        path = Path(audio_path)
        options: dict[str, Any] = {}
        if language:
            options["language"] = language
        if channel_names:
            options["channel_names"] = channel_names
        if word_timestamps:
            options["word_timestamps"] = True
        if initial_prompt:
            options["initial_prompt"] = initial_prompt

        with path.open("rb") as fh:
            response = self._http.post(
                "/v1/jobs",
                files={"file": (path.name, fh, "application/octet-stream")},
                data={"options": json.dumps(options, ensure_ascii=False),
                      "callback_url": callback_url, "client_ref": client_ref,
                      "priority": str(priority)},
            )
        response.raise_for_status()
        return response.json()["id"]

    def status(self, job_id: str) -> dict[str, Any]:
        response = self._http.get(f"/v1/jobs/{job_id}")
        response.raise_for_status()
        return response.json()

    def result(self, job_id: str) -> dict[str, Any]:
        response = self._http.get(f"/v1/jobs/{job_id}/result")
        response.raise_for_status()
        return response.json()

    def wait(self, job_id: str, poll_sec: float = 30.0,
             timeout_sec: float | None = None) -> dict[str, Any]:
        """종료 상태가 될 때까지 폴링. 오프피크 대기까지 감안해 timeout 을 잡을 것."""
        deadline = None if timeout_sec is None else time.monotonic() + timeout_sec
        while True:
            job = self.status(job_id)
            if job["status"] in TERMINAL:
                return job
            if deadline is not None and time.monotonic() > deadline:
                raise TimeoutError(f"job {job_id} still {job['status']}")
            time.sleep(poll_sec)

    def transcribe(self, audio_path: str | Path, *, poll_sec: float = 30.0,
                   **kwargs) -> dict[str, Any]:
        """제출→대기→결과를 한 번에. 창이 닫혀 있으면 열릴 때까지 블로킹된다."""
        job_id = self.submit(audio_path, **kwargs)
        job = self.wait(job_id, poll_sec=poll_sec)
        if job["status"] != "done":
            raise SttJobError(f"job {job_id} {job['status']}: {job.get('error')}")
        return self.result(job_id)

    def cancel(self, job_id: str) -> dict[str, Any]:
        response = self._http.delete(f"/v1/jobs/{job_id}")
        response.raise_for_status()
        return response.json()

    def health(self) -> dict[str, Any]:
        response = self._http.get("/v1/health")
        response.raise_for_status()
        return response.json()

    def run_now(self, minutes: int = 60) -> dict[str, Any]:
        """스케줄을 무시하고 지금 처리. 0 이면 원래 스케줄로 복귀."""
        response = self._http.post("/v1/control", json={"override_minutes": minutes})
        response.raise_for_status()
        return response.json()
```

---

## 5. 테스트 방법

오프피크 창 밖에서 개발 중이라면 잡이 큐에만 쌓입니다. 스케줄을 잠깐 무시시키세요.

```python
stt = SttClient("http://172.17.15.85:8760")
stt.run_now(60)                                    # 60분간 즉시 처리 모드
result = stt.transcribe("test.wav", poll_sec=5,
                        channel_names=["agent", "customer"])
print(result["text"])
stt.run_now(0)                                     # 원래 스케줄로 복귀
```

```bash
curl -X POST http://172.17.15.85:8760/v1/control -H "content-type: application/json" -d "{\"override_minutes\": 60}"
```

**테스트 후 `run_now(0)`으로 반드시 되돌리세요.** 안 그러면 낮에도 GPU를 계속 씁니다.

처리 속도 참고: 2채널 오디오 기준 실시간 대비 약 3.8배. 1시간짜리 통화 1건이 약 16분입니다.
모델 최초 로드에 별도로 약 55초가 붙습니다(이후 상주). 테스트 파일은 짧게 쓰세요.

연결이 안 되면 순서대로 확인하세요.

1. `curl http://172.17.15.85:8760/v1/health` — 응답이 없으면 서버가 안 떴거나 방화벽입니다.
2. 같은 PC에서 `127.0.0.1`로는 되는데 LAN IP로 안 되면 **Windows 방화벽 인바운드 규칙**(TCP 8760)이 없는 것입니다.
3. `401`이면 서버에 API 키가 설정된 것입니다. `X-API-Key` 헤더를 넣으세요.

---

## 6. 자주 틀리는 것

1. **동기 호출로 착각** — HTTP 핸들러 안에서 결과를 기다리면 타임아웃 납니다. `job_id`를 저장하고 나중에 회수하세요.
2. **`queued`가 안 끝난다고 재제출** — 오프피크 창을 기다리는 정상 상태입니다. 중복 잡만 쌓입니다. `/v1/health`의 `gate.reason`을 먼저 확인하세요.
3. **`options`를 JSON 본문으로 전송** — `multipart/form-data`의 폼 필드에 **문자열로 직렬화**해서 넣어야 합니다.
4. **`result_url`을 절대 URL로 착각** — 경로만 옵니다. Base URL과 이어 붙이세요.
5. **콜백에 전사가 있을 거라 기대** — 없습니다. `result_url`로 따로 가져오세요.
6. **채널 라벨을 내용 기준으로 기대** — 순수 **위치 기준**입니다. 녹취 장비가 채널 순서를 바꾸면 agent/customer가 뒤바뀝니다. 장비 설정을 고정하고, 도입 초기에는 결과를 눈으로 확인하세요.
7. **콜백 재시도 미고려** — 같은 `job_id`가 여러 번 올 수 있습니다. 멱등하게 만드세요.
8. **`segments`가 항상 비어있지 않다고 가정** — 무음 채널은 빈 배열입니다.

## 7. 이 서버가 못 하는 것

- **화자 분리(diarization)를 하지 않습니다.** 채널이 곧 화자라는 전제입니다. 회의실 마이크처럼 한 채널에 여러 사람이 섞인 녹음은 화자를 나눠주지 못합니다.
- **실시간·스트리밍 전사를 하지 않습니다.** 완성된 파일 단위 배치 전용입니다.
- **한 번에 한 잡만** 처리합니다. 동시에 여러 개 던져도 순차 처리됩니다. 처리량을 늘리려면 병렬로 던지지 말고 오프피크 창을 넓혀야 합니다.
- 업로드 원본과 결과를 **자동 삭제하지 않습니다.** 보존 정책이 필요하면 호출하는 쪽에서 관리하세요.

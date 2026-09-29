채널별 항목 프롬프트 구현 및 BigQuery 등록 결과 (2026-09-16)

구현과 실제 BigQuery 실행을 완료했다. 설정된 대상은 `data-proj-470202.ds_qradar_dev`, location은 `US`이다. 데이터셋 이름의 dev와 평가셋 행의 production 상태는 별개다. `.env.local`을 기존 Next 환경 로더로 읽었으며, 대상 데이터셋을 임의로 prod로 바꾸지 않았다. 기존 인증 경로 `getBQ` → `gcpAdcPreferredAuth`를 그대로 사용했다.

production 승격·기존 production 프롬프트 내용 변경·배포·실제 상담 평가·외부 LLM 전송은 하지 않았다. 2차 평가 파이프라인이나 새 판정 상태도 추가하지 않았다.

**데이터 구조와 호환성**

- 평가항목 마스터의 공통 ID·이름·분류와 기존 `fields: Record<string,string>` 구조를 유지한다. 상세별 `prompt_id`는 새 버전 저장마다 달라진다.
- `qradar_llm_criterion_prompts.exposure_channels_json STRING`에 `phone`, `feedback`, `chatcs`의 비어 있지 않은 배열을 저장한다. 복수 선택을 허용한다. 과거 메타데이터 누락만 전화로 해석하며, 신규 빈 배열은 오류다.
- 채널이나 상세 수정은 기존 행 UPDATE가 아닌 INSERT다. 공유 버전의 노출 채널을 변경해도 이전 ID와 기존 바인딩은 그대로 남는다. 새 채널 선택 범위는 새 버전에만 적용된다.
- 실제 포함 여부는 기존 `criterionBindings[].enabled`가 결정한다. 비활성이고 상세 ID가 없는 바인딩은 허용한다. 상세가 지정되었다면 비활성 바인딩도 항목 ID 및 채널 일치를 검증한다.
- `qradar_llm_prompt_versions.legacy_channel_snapshot_json STRING`은 마이그레이션 시 기존 production 세 개에만 부여한 호환 메타데이터다. 당시 채널·바인딩·실제 렌더링 기준을 고정한다. 새 저장 API는 이 값을 받아들이지 않는다. 기존 인앱 production이 전화로 이관된 상세를 참조해도 원래 결과를 보존할 수 있지만, 새 저장·발행에서는 해당 상세를 인앱용으로 재선택해야 한다.
- 새 실행은 고정 `criteria_json`을 사용하고, 최신 상세·전화 기본 정의로 자동 폴백하지 않는다. 바인딩 채널 오류와 저장된 production 검증 오류는 실행을 차단한다.
- `qradar_eval_set_criteria`의 기존 24개 행은 그대로 유지했다. 새 draft의 24개 바인딩을 추가했으며, 활성 20개만 `criteria_json`과 출력 검증 대상이다. 정규화 바인딩 저장은 트랜잭션 DML로 바꿨고 동기화 실패를 숨기지 않는다.
- `violated` boolean, JSON 응답 스키마, 결과 파서와 `any_checklist_violated` 집계를 유지했다. 오류 응답을 검토 불필요로 저장하지 않도록 오류일 때 결과 라벨은 비워 둔다.

**BigQuery 실제 작업**

1. 스키마, production, 모든 항목 상세 및 정규화 바인딩을 조회했다. 상담 원문 테이블은 조회하지 않았다.
2. 기존 설정에서 유도한 아래 세 테이블을 만료 없는 백업으로 만들었다. 공통 시점의 원본 스키마와 데이터를 보존했다.
   - `qradar_llm_prompt_versions_backup_channels_20260916_v1`
   - `qradar_llm_criterion_prompts_backup_channels_20260916_v1`
   - `qradar_eval_set_criteria_backup_channels_20260916_v1`
3. 위 두 메타데이터 컬럼을 `ADD COLUMN IF NOT EXISTS`로 추가했다.
4. 기존 상세 83개를 전화 노출로 이관했다. 원래 상세 내용과 ID는 변경하지 않았다.
5. 인앱 상세 20개와 draft 하나, 그 draft의 바인딩 24개를 단일 DML 트랜잭션으로 등록했다.
6. 재조회하여 모든 기존 평가셋 행의 내용·상태, 기존 상세의 내용, 기존 바인딩이 백업과 동일함을 검증했다. 허용된 차이는 채널/호환 메타데이터뿐이다.
7. 성공 후 동일 `--apply`를 다시 실행했다. 각 draft·상세 ID는 한 행씩, 바인딩은 24개로 유지됐으며 내용도 계획과 일치했다. 결정적 ID와 `NOT EXISTS` 삽입을 사용한다. 원본 production ID가 달라지면 중단한다.
8. 실제 앱 로더를 통한 읽기 검증도 완료했다. 전화 그로스 15개·전화 페이 0개·기존 인앱 23개의 렌더링은 변경 전과 동일하다. 새 draft 렌더링은 20개이며, 상세 필드에서 STT·원음·음성·한숨·전화 대기시간 전용 근거가 제거됨을 확인했다.

첫 등록 시 BigQuery의 `FROM` 없는 `SELECT … WHERE` 제약으로 DML 트랜잭션이 거절됐다. 구문 수정 후 성공했으며, 당시에는 백업/컬럼 추가까지만 반영된 상태였다. 현재 차단된 BQ 작업은 없다.

**생성 버전**

- 기준 인앱 production: `3a9f9ac3-df61-490d-ae69-ec6c047b324e`
- 공통 항목 상세의 기준 전화 production: `f49785d7-21f3-439e-a186-d35483afc197`
- 새 draft ID: `feedback-channels-v1-20260916-set-8ff9e09d739185427ecf`
- 새 draft 라벨: `260916_ver1_feedback-channels-v1-20260916`
- 상세 20개의 전체 ID·버전 라벨과 백업 전체 경로: [등록 결과 JSON](feedback-channels-registration.json)
- 활성: 415, 423, 424, 425, 426, 428, 429, 430, 652, 407, 408, 409, 410, 411, 419, 418, 420, 421, 545, 546.
- 비활성: 413, 416, 547, 548. 416은 기존부터 인앱 비활성이었으며 원음·말 겹침 전용 정의를 유지한다. 비활성 항목을 텍스트 태도 항목으로 재정의하거나 정상 결과로 채우지 않는다.

인앱 production의 기존 항목 구성을 기반으로 했다. 전화 production에서 활성인 공통 항목은 그 전화 상세를 원본으로 사용했고, 전화 production에서 비활성이지만 인앱에서 활성인 문의 파악 항목은 인앱 production에 명시된 상세 ID를 원본으로 사용했다. 전화에만 활성인 500번을 인앱에 임의 추가하지 않았다.

**변경 파일**

- `lib/criterionChannels.ts`, `lib/promptTypes.ts`, `lib/criterionStore.ts`: 채널 메타데이터, 엄격한 채널 검증, 새 상세 버전 저장, 최신/힌트 폴백 제거.
- `lib/promptStore.ts`, `lib/evaluationDimensionStore.ts`: 저장·발행·로딩 검증, 기존 production 호환 스냅샷, 고정 상세 실행, 정규화 바인딩 저장.
- `components/eval-design/EvalAiItemsWorkbench.tsx`, `components/eval-design/EvalSheetsWorkbench.tsx`: 채널 체크박스·배지·필터, 동적 필드 보존, 버전·내용 명시 선택, 기존 production 미리보기 호환.
- `app/api/prompts/criteria/route.ts`, `app/api/prompts/route.ts`: 입력·필터 검증과 채널 오류 400 응답.
- `components/eval-design/PromptImproveWorkbench.tsx`, `lib/promptImprove.ts`: 기존 전화 Train/검수 기반 개선 화면에서도 인앱 상세가 섞이지 않도록 전화 상세만 선택·생성하고, 저장 시 전화 노출과 기존 동적 필드를 보존.
- `lib/feedbackPromptDraft.ts`, `lib/promptDefaults.ts`: 인앱 상세 변환과 1차 후보 검출/총평·점수 독립성 지침. 전화/채팅 기본 문자열은 유지.
- `lib/gemini.ts`: 설정된 동적 필드 목록을 실제 렌더링에 전달.
- `lib/checklistCoverage.ts`, `lib/textEvaluation.ts`, `lib/evaluate.ts`, `lib/evaluationItemResultStore.ts`: 실행 채널 검사, 비활성/누락/중복 출력 차단, 오류를 정상으로 저장하지 않음.
- `lib/promptChannelMigration.ts`, `scripts/run-local-ts.cjs`, `scripts/probe-prompt-channels.ts`, `scripts/migrate-prompt-channels.ts`, `scripts/verify-prompt-channels.ts`: 설정·인증 재사용, 백업, 결정적 버전 계획, 실제 등록과 읽기 검증.
- 테스트: `lib/criterionChannels.test.ts`, `lib/promptChannelMigration.test.ts`, `lib/promptStore.channels.test.ts`, `lib/textEvaluation.channels.test.ts`, `lib/evaluate.test.ts`, `app/api/prompts/criteria/route.test.ts`, 두 관리 화면의 `.test.tsx`.

기존 작업 트리의 다른 변경은 보존했다. AGENTS.md는 저장소·상위 경로에서 발견되지 않았고, `.cursor/rules/no-node-in-client.mdc`의 클라이언트/Node 모듈 분리 규칙을 준수했다.

**테스트 및 미실행 범위**

관련 15개 테스트 파일 68개 테스트를 통과했다. UI 복수 선택·빈 선택 거절·채널 필터·다른 채널 버전 배제·버전 명시 선택, 서버 저장/발행/실행 차단, 마이그레이션 결정성, 동적 필드 보존, 출력 개수 검증, 기존 JSON 파서와 검토 필요 집계를 검증했다. TypeScript `--noEmit --incremental false`도 통과했다.

BigQuery 재조회·성공 후 재실행·실제 앱 로더 렌더링은 실행 완료다. 실제 로그인 브라우저의 E2E, 전체 저장소 테스트, production build, 배포 및 유료/실제 상담 배치 평가는 실행하지 않았다. 브라우저 화면 동작은 jsdom 컴포넌트 테스트로 확인했다.

**운영 협의 사항**

- 407의 인앱 시작·종료 인사 구성과 빈도는 기존 요구를 유지했다. 비실시간 답변에서 어느 메시지를 시작/종료 시점으로 볼지는 운영 문서 보강이 필요하다.
- 408의 전화 대기 전·중·후 안내와 초/분 임계치는 제거했다. 인앱 답변 지연/추가 확인 안내의 별도 기준은 새로 만들지 않았다.
- 415는 기존 문서의 인앱 규칙인 감정 요약 재진술 + 공감 멘트를 유지했다. 사과만 있는 경우의 감안은 2차/수기 판단으로 남겼다.
- 423·424·425·426·428·429·430·652, 419·420·421은 의미와 예시가 겹친다. 특히 426의 ‘임의 추측 금지’와 좋은 예시의 ‘가능한 니즈를 추측해 선제 안내’ 사이, 419의 좋은 예시와 ‘두괄식이면 감안’ 문구 사이에 정리가 필요하다. 새 우선순위나 단일 항목 검출 제한을 추가하지 않았다. 기존 명시된 항목 간 예외만 보존했다.
- 545의 실수/의도 구분과 546의 일부 구간/상담 전반 구분은 텍스트 원문으로 확인 가능한 문제 후보와 최종 감안을 분리해서 해석해야 한다. 음성에 근거한 의도 판단은 제거했다.
- 정책 MCP가 준비되기 전까지 547·548은 비활성이다. 다른 항목의 정책 관련 예시도 실제 회사 정책 근거로 쓰거나 우회 판정하지 않도록 명시했다.

**승격 없이 검토하는 방법**

로컬 코드로 앱을 열어 평가 설계 → 평가표 → 인앱 문의 → 위 draft 라벨을 선택하면 상세 바인딩과 최종 프롬프트 미리보기를 확인할 수 있다. AI 평가 항목에서 노출 채널을 인앱 문의로 필터하면 새 상세 20개를 볼 수 있다. ‘운영 지정’이나 실제 평가 실행은 필요 없다.

읽기 검증: `node scripts/run-local-ts.cjs scripts/verify-prompt-channels.ts`

등록 계획만 확인: `node scripts/run-local-ts.cjs scripts/migrate-prompt-channels.ts`

같은 등록 재검증: `node scripts/run-local-ts.cjs scripts/migrate-prompt-channels.ts --apply`

복원 자료는 위 세 BQ 백업이다. 기존 production 내용은 바뀌지 않았으므로 내용 복원 작업은 필요 없다. 변경을 철회해야 한다면 이후 사용 여부를 확인한 뒤 등록 결과 JSON에 나열된 새 ID만 대상으로 정규화 바인딩·draft·상세를 제거하고, 새 호환/채널 메타데이터는 백업에 근거해 복구한다. 전체 테이블 교체는 이후 운영 변경을 덮을 수 있으므로 자동 복원 명령은 실행하지 않았다.

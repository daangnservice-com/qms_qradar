# 판정 모델 (검토필요 / 최종 Cold·Hot·Hold)

레퍼런스·설계조건명세 기준. 2026-09부터 helpdesk-x 콜 단위 AI 라벨은 `review_needed` / `review_not_needed` 로 정규화한다. 8월까지 저장된 `cold`/`hot` AI 라벨은 검토필요 축의 별칭으로 읽는다.

## 항목 판정 (AI)

- LLM `csChecklist[].violated=true` → **검토 필요** (사람이 한 번 더 볼 대상)
- `violated=false` → **검토 불필요**
- AI는 체크리스트 조건 해당 여부만 본다. **감안(경미·맥락 예외로 최종 적합 처리)은 수기 전용.**

## 수기 검수

1. **검토 필요 / 불필요**
   - 필요: 문제 발생 상황(AI 검토필요가 맞거나, AI가 놓친 미검출을 `+`로 추가)
   - 불필요: 문제 발생이 아님(AI 과검출 포함)
2. **최종 Cold / Hot / Hold** (검토 필요인 경우만)
   - **Cold**: 감안 불가 (부적합)
   - **Hot**: 감안 가능 (적합) — 문제 발생은 확인되나 상담 전체 흐름 상 감안 가능
   - **Hold**: 잘 모르겠음(보류) — 문제 상황은 맞지만 감안 가능 여부를 아직 정하지 못함

미터치 AI 검토필요 뱃지 = 검토필요 동의 + 최종 Cold.

## 콜 판정

helpdesk-x `ResultParseConfig`: `csChecklist` 중 `violated=true` 1개 이상 → `trueLabel`(기본 `review_needed`).

수기 콜 라벨:

- `humanResult` = 검토필요 1개 이상이면 `review_needed`
- `humanFinalLabel` = **Cold 1개 이상 → `cold`**, 아니면 **Hold 1개 이상 → `hold`**, 아니면 `hot` (매트릭스에 넣지 않음)

## Gate (AI 정확도)

- 목표: 항목별 AI–사람 **검토필요 일치율 90%**, 연속 통과 시 운영 전환
- 양성 클래스 = 검토 필요. Precision/Recall은 이 축 기준.
- 수기 최종 Cold/Hot/Hold는 이후 AI가 최종 판정까지 도전할 때의 골드. 지금은 Gate에 쓰지 않는다.

## 버전 동결

평가표·항목·AI 프롬프트는 발행 후 동결. 과거 평가 결과는 당시 버전 기준 보존.

## 커트오버

- **8월**: AI Cold/Hot = 최종 품질 판정으로 집계. 수기 `reviewNeeded`는 백필: Hot+코멘트 감안=검토필요·최종 Hot, Hot만=검토불필요, Cold=검토필요·최종 Cold.
- **9월~**: AI = 검토필요. 수기는 검토필요 + 최종 Cold/Hot(/Hold). 신규 입력부터 신정의.
